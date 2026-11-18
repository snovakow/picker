// @vitest-environment jsdom
/**
 * @fileoverview A colour well on a page and the page's picker it joins: the
 * well's canvas laid out and sized, the picker opened beside it where the
 * screen's rule stands it, one picker moving between the page's wells, and
 * the pointer taken — a press held from the moment it goes down, a drag past
 * a drag's start, the click after a drag swallowed, a press let go as
 * cancelled, the page's input kept through a press on a well and let go by
 * one anywhere else — the value written as a script writes it, the page's
 * input placed over the picker's field, the eyedropper's view, and the
 * picker popped out into a window of its own. jsdom has no 2D context, no
 * layout, no pointer events and no windows of its own, so a canvas is given
 * a context that does nothing, every measure 0, a well's canvas a rect of
 * the page pinned by the test, a pointer event is a mouse event carrying a
 * pointer's fields, and the picker's window is a stand-in over a document
 * of its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./wheel.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./wheel.ts')>();
	return { ...actual, makeWheelRenderer: () => ({ canvas: document.createElement('canvas'), draw: () => { } }) };
});

import { ColourWell, type ColourWellOptions } from './colourWell.ts';
import { PagePicker, pagePicker } from './pagePicker.ts';
import type { Eyedropper } from './colourPicker.ts';
import { pageInput, pageInputMade, resetPageInput, type PageInput } from './input.ts';
import { DRAG_SLOP, TOUCH_SLOP } from './pointer.ts';
import type { PickerLayout } from './pickerView.ts';

/** A context every call on which does nothing, its measures all 0, and its gradients a stop that takes none. */
const inertContext = () => new Proxy<Record<string | symbol, unknown>>({ globalAlpha: 1 }, {
	get: (held, key) => (key in held ? held[key] : key === 'measureText' ? () => ({ width: 0 }) : key === 'createLinearGradient' ? () => ({ addColorStop: () => { } }) : () => { }),
	set: (held, key, value) => {
		held[key] = value;
		return true;
	},
});

const made: { dispose(): void }[] = [];

beforeEach(() => {
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => inertContext() as unknown as CanvasRenderingContext2D);
	document.body.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1024, bottom: 768, width: 1024, height: 768, x: 0, y: 0, toJSON: () => ({}) });
});

afterEach(() => {
	for (const each of made.splice(0)) each.dispose();
	pagePicker().dispose();
	resetPageInput();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

/** A page's picker of the case's own, let go as the case ends. */
const pickerOf = (options: ConstructorParameters<typeof PagePicker>[0] = {}): PagePicker => {
	const picker = new PagePicker(options);
	made.push(picker);
	return picker;
};

/** What a page's picker holds, as the cases read it: its colour picker, with the canvas it is painted into and the picker while it is open, and its window. */
const insideOf = (picker: PagePicker) => picker as unknown as {
	picker: { canvas: HTMLCanvasElement; popover: { layout: PickerLayout; colour: number[]; terms: { alpha: number } } | null };
	popout: { window: Window; input: PageInput } | null;
};

/** A well made from its options, orange unless they say otherwise, joining the page's own picker unless they name another, its canvas on the page with its top-left corner at a point of the window, painted, and what it tells recorded. */
const wellAt = (options: ColourWellOptions = {}, at: [number, number] = [100, 50]) => {
	const told: string[] = [];
	const well = new ColourWell({ value: '#ff8b30', ...options, onEvent: (event) => { told.push(event); } });
	made.push(well);
	document.body.appendChild(well.canvas);
	const size = () => ({ w: parseFloat(well.canvas.style.width), h: parseFloat(well.canvas.style.height) });
	well.canvas.getBoundingClientRect = () => {
		const { w, h } = size();
		return { left: at[0], top: at[1], right: at[0] + w, bottom: at[1] + h, width: w, height: h, x: at[0], y: at[1], toJSON: () => ({}) };
	};
	well.update();
	const popover = insideOf(well.picker).picker.canvas;
	const layout = () => insideOf(well.picker).picker.popover!.layout;
	return { well, told, popover, layout };
};

/** A pointer event of a type at a point of the window, as jsdom can make one. */
const pointer = (type: string, at: [number, number], pointerId = 1, pointerType = 'mouse', buttons = type === 'pointerup' ? 0 : 1) => {
	const event = new MouseEvent(type, { button: 0, buttons, clientX: at[0], clientY: at[1], bubbles: true, cancelable: true });
	Object.defineProperty(event, 'pointerId', { value: pointerId });
	Object.defineProperty(event, 'pointerType', { value: pointerType });
	Object.defineProperty(event, 'isPrimary', { value: pointerId === 1 });
	return event;
};

const mouse = (type: string, at: [number, number]) => new MouseEvent(type, { button: 0, clientX: at[0], clientY: at[1], bubbles: true, cancelable: true });

const key = (target: EventTarget, k: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

/** A press let go where it went down, and the click the browser sends after it. */
const tap = (target: EventTarget, at: [number, number], pointerType = 'mouse') => {
	target.dispatchEvent(pointer('pointerdown', at, 1, pointerType));
	target.dispatchEvent(pointer('pointerup', at, 1, pointerType));
	target.dispatchEvent(mouse('click', at));
};

/** A point of the page over a point of the picker, in its own pixels. */
const onPicker = (popover: HTMLCanvasElement, [x, y]: [number, number]): [number, number] => [parseFloat(popover.style.left) + x, parseFloat(popover.style.top) + y];

/** The middle of a box. */
const centre = (box: { x: number; y: number; w: number; h: number }): [number, number] => [box.x + box.w / 2, box.y + box.h / 2];

/** A point of the picker's wheel: the centre moved by a distance along an angle, clockwise from the right in screen axes. */
const onWheel = (layout: PickerLayout, radius: number, degrees: number): [number, number] => {
	const wheel = layout.wheel!;
	const mid = wheel.w / 2;
	return [wheel.x + mid + radius * Math.cos(degrees * Math.PI / 180), wheel.y + mid + radius * Math.sin(degrees * Math.PI / 180)];
};

describe('a colour well', () => {
	it('lays its colour out on a canvas its box\'s size, out of the browser\'s touch gestures and selection, its picker shut, joining the page\'s own picker, which shows the browser\'s eyedropper where nothing sets another', () => {
		const { well, popover } = wellAt();
		expect(well.canvas.style.width).toBe('200px');
		expect(well.canvas.style.height).toBe('42px');
		expect([well.canvas.width, well.canvas.height]).toEqual([200 * window.devicePixelRatio, 42 * window.devicePixelRatio]);
		expect(well.value).toBe('#ff8b30');
		expect(well.open).toBe(false);
		expect(popover.style.display).toBe('none');
		for (const canvas of [well.canvas, popover]) {
			expect(canvas.style.touchAction).toBe('none');
			expect(canvas.style.userSelect).toBe('none');
		}
		expect(well.picker).toBe(pagePicker());
		expect(well.picker.eyedropper).toEqual({ mode: 'screen' });
		expect(well.picker.docking).toBe('auto');
		// Made from nothing, it is black, and sets no eyedropper of its own.
		const bare = new ColourWell();
		made.push(bare);
		expect(bare.value).toBe('#000000');
		expect(bare.eyedropper).toBeNull();
	});

	it('opens its picker against its face on a click and shuts it on a second, telling click, the picker below it, or above it where only that side holds it inside the window', () => {
		const { well, told, popover } = wellAt();
		tap(well.canvas, [150, 70]);
		expect(well.open).toBe(true);
		expect(told).toEqual(['click']);
		expect(pageInput().focused).toBe(true);
		expect(popover.style.display).toBe('block');
		expect([popover.style.left, popover.style.top, popover.style.width, popover.style.height]).toEqual(['100px', '92px', '288px', '308px']);
		tap(well.canvas, [150, 70]);
		expect(well.open).toBe(false);
		expect(popover.style.display).toBe('none');
		expect(told).toEqual(['click', 'click']);
		// At the window's foot the picker opens above the face, its foot on the face's top.
		const low = wellAt({}, [100, 700]);
		tap(low.well.canvas, [150, 720]);
		expect([low.popover.style.left, low.popover.style.top]).toEqual(['100px', `${700 - 308}px`]);
		// At its right edge it is pulled left to stay inside it.
		const right = wellAt({}, [900, 50]);
		tap(right.well.canvas, [950, 70]);
		expect(right.popover.style.left).toBe(`${1024 - 288}px`);
	});

	it('sets the colour by a press on the wheel and follows the drag, telling change for each colour, and a click after the press let go unmoved sets nothing again', () => {
		const { well, told, popover, layout } = wellAt();
		tap(well.canvas, [150, 70]);
		told.length = 0;
		const at = onPicker(popover, onWheel(layout(), 81, 120));
		popover.dispatchEvent(pointer('pointerdown', at));
		const first = well.value;
		expect(first).not.toBe('#ff8b30');
		popover.dispatchEvent(pointer('pointermove', onPicker(popover, onWheel(layout(), 81, 60))));
		expect(well.value).not.toBe(first);
		popover.dispatchEvent(pointer('pointerup', onPicker(popover, onWheel(layout(), 81, 60))));
		expect(told).toEqual(['change', 'change']);
		// Let go unmoved, the click after it sets nothing again; a click alone does.
		const still = onPicker(popover, onWheel(layout(), 81, 20));
		popover.dispatchEvent(pointer('pointerdown', still));
		popover.dispatchEvent(pointer('pointerup', still));
		const pressed = well.value;
		popover.dispatchEvent(mouse('click', [still[0] + 0.4, still[1]]));
		expect(well.value).toBe(pressed);
		popover.dispatchEvent(mouse('click', onPicker(popover, onWheel(layout(), 81, 90))));
		expect(well.value).not.toBe(pressed);
	});

	it('takes a press as a drag once it has gone past a drag\'s start on the screen, a touch\'s further than a mouse\'s, and swallows the click after a drag, once', () => {
		const { well } = wellAt();
		const from: [number, number] = [150, 70];
		const past: [number, number] = [150 + DRAG_SLOP + 1, 70];
		well.canvas.dispatchEvent(pointer('pointerdown', from));
		well.canvas.dispatchEvent(pointer('pointermove', past));
		well.canvas.dispatchEvent(pointer('pointerup', past));
		well.canvas.dispatchEvent(mouse('click', past));
		expect(well.open).toBe(false);
		// The next click is its own.
		well.canvas.dispatchEvent(mouse('click', past));
		expect(well.open).toBe(true);
		well.closePicker();
		// A touch moved as far is not yet a drag; past its hold radius it is.
		well.canvas.dispatchEvent(pointer('pointerdown', from, 1, 'touch'));
		well.canvas.dispatchEvent(pointer('pointermove', past, 1, 'touch'));
		well.canvas.dispatchEvent(pointer('pointerup', past, 1, 'touch'));
		well.canvas.dispatchEvent(mouse('click', past));
		expect(well.open).toBe(true);
		well.closePicker();
		const far: [number, number] = [150 + TOUCH_SLOP + 1, 70];
		well.canvas.dispatchEvent(pointer('pointerdown', from, 1, 'touch'));
		well.canvas.dispatchEvent(pointer('pointermove', far, 1, 'touch'));
		well.canvas.dispatchEvent(pointer('pointerup', far, 1, 'touch'));
		well.canvas.dispatchEvent(mouse('click', far));
		expect(well.open).toBe(false);
	});

	it('lets a press on the picker go where a mouse moves with no button down, the pointer is cancelled, the capture taken back or the window loses the focus, its moves setting nothing after', () => {
		const ends: ((target: EventTarget, at: [number, number]) => void)[] = [
			(target, at) => target.dispatchEvent(pointer('pointermove', at, 1, 'mouse', 0)),
			(target, at) => target.dispatchEvent(pointer('pointercancel', at)),
			(target, at) => target.dispatchEvent(pointer('lostpointercapture', at)),
			() => window.dispatchEvent(new Event('blur')),
		];
		for (const end of ends) {
			const { well, popover, layout } = wellAt();
			tap(well.canvas, [150, 70]);
			popover.dispatchEvent(pointer('pointerdown', onPicker(popover, onWheel(layout(), 81, 120))));
			end(popover, onPicker(popover, onWheel(layout(), 81, 120)));
			const held = well.value;
			popover.dispatchEvent(pointer('pointermove', onPicker(popover, onWheel(layout(), 81, 30))));
			expect(well.value).toBe(held);
			well.dispose();
		}
	});

	it('keeps the browser\'s focus change off a press on the well or its picker, and shuts the picker and lets the input go on a press anywhere else on the page, the input\'s own element aside', () => {
		const { well, popover } = wellAt();
		tap(well.canvas, [150, 70]);
		for (const canvas of [well.canvas, popover]) {
			const down = mouse('mousedown', [150, 70]);
			canvas.dispatchEvent(down);
			expect(down.defaultPrevented).toBe(true);
		}
		pageInput().input.dispatchEvent(pointer('pointerdown', [0, 0]));
		expect(well.open).toBe(true);
		document.body.dispatchEvent(pointer('pointerdown', [600, 600]));
		expect(well.open).toBe(false);
		expect(pageInput().focused).toBe(false);
	});

	it('writes its value as a script writes it, held as #rrggbb or #rrggbbaa and refusing what does not read, an open picker reading it afresh, and writes its swatches as its options\' are read', () => {
		const { well, told, layout } = wellAt({ alpha: true });
		expect(well.setValue('#ABC')).toBe(true);
		expect(well.value).toBe('#aabbcc');
		expect(well.setValue('reddish')).toBe(false);
		expect(well.value).toBe('#aabbcc');
		tap(well.canvas, [150, 70]);
		told.length = 0;
		expect(well.setValue('#11223380')).toBe(true);
		expect(well.value).toBe('#11223380');
		const open = insideOf(well.picker).picker.popover!;
		expect(open.colour).toEqual([0x11, 0x22, 0x33]);
		expect(open.terms.alpha).toBeCloseTo(0x80 / 255, 9);
		expect(told).toEqual([]);
		well.setSwatches(['#445566', 'none', '#7788']);
		well.update();
		expect(layout().swatchHexes).toEqual(['#445566', '#77778888']);
	});

	it('shuts its picker and lets its focus go as it is disabled, and opens none while it is', () => {
		const { well, told } = wellAt();
		tap(well.canvas, [150, 70]);
		well.disabled = true;
		expect(well.open).toBe(false);
		expect(pageInput().focused).toBe(false);
		told.length = 0;
		tap(well.canvas, [150, 70]);
		expect(well.open).toBe(false);
		expect(told).toEqual([]);
		well.openPicker();
		expect(well.open).toBe(false);
		well.disabled = false;
		tap(well.canvas, [150, 70]);
		expect(well.open).toBe(true);
	});

	it('places the page\'s input over the picker\'s field that holds it, and out of sight as the field gives it back', () => {
		const { well, popover, layout } = wellAt();
		tap(well.canvas, [150, 70]);
		const hex = layout().hex;
		const at = onPicker(popover, centre(hex));
		popover.dispatchEvent(pointer('pointerdown', at));
		popover.dispatchEvent(pointer('pointerup', at));
		const input = pageInput();
		expect(input.shown).toBe(true);
		expect([input.input.style.left, input.input.style.top, input.input.style.width, input.input.style.height]).toEqual([`${100 + hex.x}px`, `${92 + hex.y}px`, `${hex.w}px`, `${hex.h}px`]);
		key(input.input, 'Escape');
		expect(input.shown).toBe(false);
		expect(well.open).toBe(true);
		expect(pageInputMade()?.focusedHost).toBe(well.picker);
	});

	it('lets its canvas go as it is disposed, the picker shut and the focus let go, and a disposed picker lets its wells go', () => {
		const { well, popover } = wellAt();
		tap(well.canvas, [150, 70]);
		well.dispose();
		expect(well.canvas.isConnected).toBe(false);
		expect(popover.style.display).toBe('none');
		expect(pageInput().focused).toBe(false);
		document.body.dispatchEvent(pointer('pointerdown', [600, 600]));
		tap(well.canvas, [150, 70]);
		expect(well.open).toBe(false);
		// A picker let go takes its canvas and leaves its wells unable to open one.
		const picker = pickerOf();
		const other = wellAt({ picker }, [400, 50]);
		tap(other.well.canvas, [450, 70]);
		expect(other.well.open).toBe(true);
		picker.dispose();
		expect(other.well.open).toBe(false);
		expect(insideOf(picker).picker.canvas.isConnected).toBe(false);
		tap(other.well.canvas, [450, 70]);
		expect(other.well.open).toBe(false);
	});

	describe('its picker, the page\'s', () => {
		it('serves every well of the page, opened on one at a time: a click on another well moves it there, the focus handed over without being let go', () => {
			const one = wellAt();
			const two = wellAt({}, [400, 50]);
			expect(two.popover).toBe(one.popover);
			tap(one.well.canvas, [150, 70]);
			const input = pageInput();
			const blurred = vi.fn();
			input.input.addEventListener('blur', blurred);
			tap(two.well.canvas, [450, 70]);
			expect(two.well.open).toBe(true);
			expect(one.well.open).toBe(false);
			expect(one.well.picker.well).toBe(two.well);
			expect(one.well.picker.openWell).toBe(two.well);
			expect(input.focused).toBe(true);
			expect(blurred).not.toHaveBeenCalled();
			expect(one.told).toEqual(['click']);
			expect(two.told).toEqual(['click']);
			expect(two.popover.style.left).toBe('400px');
		});

		it('gives a field\'s input back to its colour as the focus moves to another well', () => {
			const one = wellAt();
			const two = wellAt({}, [400, 50]);
			tap(one.well.canvas, [150, 70]);
			const at = onPicker(one.popover, centre(one.layout().hex));
			one.popover.dispatchEvent(pointer('pointerdown', at));
			one.popover.dispatchEvent(pointer('pointerup', at));
			expect(pageInput().shown).toBe(true);
			tap(two.well.canvas, [450, 70]);
			expect(pageInput().shown).toBe(false);
			expect(pageInput().focused).toBe(true);
			expect(two.well.open).toBe(true);
		});

		it('is opened and shut by a script, on a well of its own alone', () => {
			const picker = pickerOf();
			const one = wellAt({ picker });
			const stranger = wellAt({}, [400, 50]);
			picker.open(one.well);
			expect(one.well.open).toBe(true);
			expect(picker.well).toBe(one.well);
			expect(pageInput().focusedHost).toBe(picker);
			picker.open(stranger.well);
			expect(stranger.well.open).toBe(false);
			expect(picker.openWell).toBe(one.well);
			picker.close();
			expect(one.well.open).toBe(false);
			expect(picker.well).toBe(one.well);
			one.well.openPicker();
			expect(one.well.open).toBe(true);
		});

		it('shuts every other picker on the page as one opens', () => {
			const picker = pickerOf();
			const one = wellAt({ picker });
			const two = wellAt({}, [400, 50]);
			tap(one.well.canvas, [150, 70]);
			tap(two.well.canvas, [450, 70]);
			expect(two.well.open).toBe(true);
			expect(one.well.open).toBe(false);
			expect(pageInput().focusedHost).toBe(two.well.picker);
		});
	});

	describe('its eyedropper', () => {
		/** A view on the page whose colour at a point the test gives: its x and y as two channels, and blue. */
		const viewOf = () => {
			const element = document.createElement('div');
			document.body.appendChild(element);
			const seen: string[] = [];
			for (const type of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'click']) element.addEventListener(type, () => seen.push(type));
			const sampled: [number, number][] = [];
			const view = { element, sample: (x: number, y: number): [number, number, number] => { sampled.push([x, y]); return [x % 256, y % 256, 255]; } };
			return { element, seen, sampled, view };
		};
		/** A click on the eyedropper of an open picker. */
		const clickDropper = (popover: HTMLCanvasElement, layout: () => PickerLayout) => {
			tap(popover, onPicker(popover, centre(layout().dropper!)));
		};

		it('takes a press on the view while armed, ahead of the view\'s own listeners, the colour under the pointer taken as it goes down and moves and the eyedropper put away as it is let go, the click after it swallowed and the picker and the page\'s input kept', () => {
			const { element, seen, sampled, view } = viewOf();
			const { well, told, popover, layout } = wellAt({ eyedropper: { mode: 'view', view } });
			tap(well.canvas, [150, 70]);
			clickDropper(popover, layout);
			expect(element.style.cursor).toBe('crosshair');
			told.length = 0;
			const down = pointer('pointerdown', [600, 500]);
			element.dispatchEvent(down);
			expect(down.defaultPrevented).toBe(true);
			expect(well.value).toBe('#58f4ff');
			element.dispatchEvent(mouse('mousedown', [600, 500]));
			element.dispatchEvent(pointer('pointermove', [610, 520]));
			expect(well.value).toBe('#6208ff');
			element.dispatchEvent(pointer('pointerup', [620, 530]));
			element.dispatchEvent(mouse('click', [620, 530]));
			expect(well.value).toBe('#6c12ff');
			expect(sampled).toEqual([[600, 500], [610, 520], [620, 530]]);
			expect(told).toEqual(['change', 'change', 'change']);
			expect(seen).toEqual([]);
			expect(well.open).toBe(true);
			expect(pageInput().focused).toBe(true);
			expect(element.style.cursor).toBe('');
			// Put away, a press on the view is any press elsewhere: the view's own, and it shuts the picker.
			element.dispatchEvent(pointer('pointerdown', [600, 500]));
			expect(seen).toEqual(['pointerdown']);
			expect(well.open).toBe(false);
		});

		it('takes none as its press on the view is cancelled, puts itself away, and leaves the view\'s cursor its own as it is put away by Escape, by the picker shutting and as the eyedropper changes', () => {
			const { element, view } = viewOf();
			const { well, popover, layout } = wellAt({ eyedropper: { mode: 'view', view } });
			tap(well.canvas, [150, 70]);
			clickDropper(popover, layout);
			element.dispatchEvent(pointer('pointerdown', [600, 500]));
			const first = well.value;
			element.dispatchEvent(pointer('pointercancel', [610, 520]));
			expect(well.value).toBe(first);
			expect(element.style.cursor).toBe('');
			clickDropper(popover, layout);
			key(pageInput().input, 'Escape');
			expect(element.style.cursor).toBe('');
			expect(well.open).toBe(true);
			clickDropper(popover, layout);
			well.closePicker();
			expect(element.style.cursor).toBe('');
			tap(well.canvas, [150, 70]);
			clickDropper(popover, layout);
			expect(element.style.cursor).toBe('crosshair');
			well.setEyedropper({ mode: 'disabled' });
			expect(element.style.cursor).toBe('');
			expect(layout().dropper).toBeNull();
		});

		it('shows the picker\'s eyedropper for a well that sets none, and the well\'s own over it, the picker reading either afresh as it changes', () => {
			const { view } = viewOf();
			const picker = pickerOf({ eyedropper: { mode: 'disabled' } });
			const plain = wellAt({ picker });
			const own = wellAt({ picker, eyedropper: { mode: 'view', view, tip: 'Pick a colour from the feed' } }, [400, 50]);
			tap(plain.well.canvas, [150, 70]);
			expect(plain.layout().dropper).toBeNull();
			tap(own.well.canvas, [450, 70]);
			expect(own.layout().tip!.lines.join(' ')).toBe('Pick a colour from the feed');
			// Its own let go, the picker's; the picker's changed, read afresh.
			own.well.setEyedropper(null);
			expect(own.well.eyedropper).toBeNull();
			expect(own.layout().dropper).toBeNull();
			picker.setEyedropper({ mode: 'view', view });
			expect(own.layout().tip!.lines.join(' ')).toBe('Pick a colour from the view');
			expect(picker.eyedropper).toEqual({ mode: 'view', view });
		});

		it('hands the app\'s own pick its take where the eyedropper is custom, each colour it takes telling change, leaves a press anywhere on the page to the pick, the picker open and the input kept, and aborts it as the picker shuts', () => {
			const picks: { take: (colour: string | null, done?: boolean) => void; signal: AbortSignal }[] = [];
			const eyedropper: Eyedropper = { mode: 'custom', pick: (take, signal) => { picks.push({ take, signal }); } };
			const { well, told, popover, layout } = wellAt({ eyedropper });
			tap(well.canvas, [150, 70]);
			clickDropper(popover, layout);
			told.length = 0;
			picks[0].take('#336699');
			expect(well.value).toBe('#336699');
			expect(told).toEqual(['change']);
			// The app's press, wherever it lands: seen by the page, kept from the browser's focus change alone.
			const seen = vi.fn();
			document.body.addEventListener('pointerdown', seen);
			document.body.dispatchEvent(pointer('pointerdown', [600, 600]));
			const down = mouse('mousedown', [600, 600]);
			document.body.dispatchEvent(down);
			expect(seen).toHaveBeenCalledTimes(1);
			expect(down.defaultPrevented).toBe(true);
			expect(well.open).toBe(true);
			expect(pageInput().focused).toBe(true);
			picks[0].take('#663399', true);
			expect(well.value).toBe('#663399');
			// Done, a press elsewhere is any press elsewhere again, and the browser's own.
			const after = mouse('mousedown', [600, 600]);
			document.body.dispatchEvent(after);
			expect(after.defaultPrevented).toBe(false);
			clickDropper(popover, layout);
			well.closePicker();
			expect(picks[1].signal.aborted).toBe(true);
			picks[1].take('#000000', true);
			expect(well.value).toBe('#663399');
			document.body.dispatchEvent(pointer('pointerdown', [600, 600]));
			expect(pageInput().focused).toBe(false);
		});
	});

	describe('its docking', () => {
		/** A window of the picker's own, a stand-in over a document of its own, opened at the size asked for unless the case has the browser give one of its own: what it was opened with, its size, and whether it is shut. */
		const windows = () => {
			const opened: { name: string; features: string; window: Window & { closed: boolean; innerWidth: number; innerHeight: number; screenX: number; screenY: number } }[] = [];
			let refuse = false;
			let ownSize: { w: number; h: number } | null = null;
			vi.spyOn(window, 'open').mockImplementation((_url?: string | URL, name?: string, features?: string) => {
				if (refuse) return null;
				const asked = Object.fromEntries((features ?? '').split(',').map((part) => part.split('=')));
				const size = ownSize ?? { w: Number(asked.width) || 0, h: Number(asked.height) || 0 };
				const doc = document.implementation.createHTMLDocument('');
				const own = Object.assign(new EventTarget(), {
					document: doc,
					closed: false,
					innerWidth: size.w,
					innerHeight: size.h,
					devicePixelRatio: 2,
					screenX: 30,
					screenY: 40,
					close() {
						own.closed = true;
					},
					resizeBy(across: number, down: number) {
						own.innerWidth += across;
						own.innerHeight += down;
					},
				});
				const shown = own as unknown as (typeof opened)[number]['window'];
				opened.push({ name: name ?? '', features: features ?? '', window: shown });
				return shown;
			});
			return { opened, refuse: (refused: boolean) => { refuse = refused; }, openAt: (size: { w: number; h: number } | null) => { ownSize = size; } };
		};
		/** The step's end, where a shut picker's window shuts. */
		const stepEnds = () => Promise.resolve();

		it('stands in the page alone in-view, with no dock button', () => {
			const { opened } = windows();
			const picker = pickerOf({ docking: 'in-view' });
			const { well, layout } = wellAt({ picker });
			tap(well.canvas, [150, 70]);
			expect(layout().dock).toBeNull();
			picker.popOut();
			expect(picker.poppedOut).toBe(false);
			expect(opened).toHaveLength(0);
		});

		it('pops out in auto by its button into a window of its own beside the well, sized to the picker, with a button to dock it back, kept for the next opening', async () => {
			const { opened } = windows();
			const picker = pickerOf();
			const { well, popover, layout } = wellAt({ picker });
			tap(well.canvas, [150, 70]);
			expect(layout().dock!.kind).toBe('popout');
			tap(popover, onPicker(popover, centre(layout().dock!.box)));
			expect(picker.poppedOut).toBe(true);
			expect(opened).toHaveLength(1);
			expect(opened[0].features).toMatch(/^popup,width=288,height=308,left=\d+,top=\d+$/);
			const shown = opened[0].window;
			expect(popover.ownerDocument).toBe(shown.document);
			expect(shown.document.title).toBe('Color Picker');
			expect(shown.document.getElementById('colourPickerFaces')).not.toBeNull();
			expect([shown.innerWidth, shown.innerHeight]).toEqual([288, 308]);
			expect([popover.style.left, popover.style.top, popover.style.display]).toEqual(['0px', '0px', 'block']);
			expect(layout().dock!.kind).toBe('dock');
			expect(well.open).toBe(true);
			// Shut, it shuts its window as the step ends; opened again, it pops out again where the last was left.
			tap(well.canvas, [150, 70]);
			expect(shown.closed).toBe(false);
			await stepEnds();
			expect(shown.closed).toBe(true);
			expect(popover.ownerDocument).toBe(document);
			tap(well.canvas, [150, 70]);
			expect(opened).toHaveLength(2);
			expect(opened[1].features).toContain('left=30,top=40');
			// Docked back by its button, in the page again.
			const again = opened[1].window;
			tap(popover, centre(layout().dock!.box));
			expect(picker.poppedOut).toBe(false);
			expect(again.closed).toBe(true);
			expect(popover.ownerDocument).toBe(document);
			expect(popover.style.left).toBe('100px');
			expect(layout().dock!.kind).toBe('popout');
		});

		it('stands in a window of its own alone in popout, which stays as the picker moves to another well, shuts as the focus leaves the wells, and shuts the picker as the viewer shuts it', async () => {
			const { opened } = windows();
			const picker = pickerOf({ docking: 'popout' });
			const one = wellAt({ picker });
			const two = wellAt({ picker }, [400, 50]);
			tap(one.well.canvas, [150, 70]);
			expect(picker.poppedOut).toBe(true);
			expect(one.layout().dock).toBeNull();
			tap(two.well.canvas, [450, 70]);
			await stepEnds();
			expect(opened).toHaveLength(1);
			expect(opened[0].window.closed).toBe(false);
			expect(two.well.open).toBe(true);
			// A press elsewhere on the page lets the focus go, and the window with it.
			document.body.dispatchEvent(pointer('pointerdown', [900, 700]));
			expect(two.well.open).toBe(false);
			await stepEnds();
			expect(opened[0].window.closed).toBe(true);
			expect(pageInput().focused).toBe(false);
			// The viewer shutting its window shuts the picker, the well keeping the focus.
			tap(one.well.canvas, [150, 70]);
			const shown = opened[1].window;
			shown.dispatchEvent(new Event('pagehide'));
			expect(one.well.open).toBe(false);
			expect(picker.poppedOut).toBe(false);
			expect(picker.well).toBe(one.well);
			expect(pageInput().focused).toBe(true);
		});

		it('sizes its window to the picker as the picker grows, by the change alone, and once made where the browser opened it at a size of its own', async () => {
			const { opened, openAt } = windows();
			const picker = pickerOf({ docking: 'popout' });
			const { well } = wellAt({ picker });
			tap(well.canvas, [150, 70]);
			const shown = opened[0].window;
			expect([shown.innerWidth, shown.innerHeight]).toEqual([288, 308]);
			// A row of swatches makes it taller by a gap and a swatch.
			well.setSwatches(['#112233']);
			well.update();
			expect([shown.innerWidth, shown.innerHeight]).toEqual([288, 344]);
			// What the viewer gave the window beyond the picker is kept, the window growing by the change alone.
			shown.innerWidth = 400;
			well.setSwatches(Array.from({ length: 8 }, () => '#112233'));
			well.update();
			expect([shown.innerWidth, shown.innerHeight]).toEqual([400, 378]);
			// A browser that opens the window at a size of its own: sized to the picker once it is made.
			tap(well.canvas, [150, 70]);
			await stepEnds();
			openAt({ w: 800, h: 533 });
			tap(well.canvas, [150, 70]);
			const own = opened[1].window;
			expect([own.innerWidth, own.innerHeight]).toEqual([800, 533]);
			await new Promise((resolve) => setTimeout(resolve, 150));
			expect([own.innerWidth, own.innerHeight]).toEqual([288, 378]);
		});

		it('stands in the page where the browser refuses the window, in auto as though docked, in popout until it shuts', () => {
			const { opened, refuse } = windows();
			refuse(true);
			const auto = pickerOf();
			const one = wellAt({ picker: auto });
			tap(one.well.canvas, [150, 70]);
			tap(one.popover, onPicker(one.popover, centre(one.layout().dock!.box)));
			expect(auto.poppedOut).toBe(false);
			expect(one.layout().dock!.kind).toBe('popout');
			expect(one.popover.style.display).toBe('block');
			auto.close();
			const popout = pickerOf({ docking: 'popout' });
			const two = wellAt({ picker: popout }, [400, 50]);
			tap(two.well.canvas, [450, 70]);
			expect(popout.poppedOut).toBe(false);
			expect(two.popover.style.left).toBe('400px');
			tap(two.well.canvas, [450, 70]);
			refuse(false);
			tap(two.well.canvas, [450, 70]);
			expect(popout.poppedOut).toBe(true);
			expect(opened).toHaveLength(1);
		});

		it('types a field in its window through the window\'s own input, the well keeping the page\'s, and takes the window\'s keys while no field holds it', async () => {
			const { opened } = windows();
			const picker = pickerOf({ docking: 'popout' });
			const { well, popover, layout } = wellAt({ picker });
			tap(well.canvas, [150, 70]);
			const own = insideOf(picker).popout!.input;
			const hex = layout().hex;
			popover.dispatchEvent(pointer('pointerdown', centre(hex)));
			popover.dispatchEvent(pointer('pointerup', centre(hex)));
			expect(own.focused).toBe(true);
			expect(own.shown).toBe(true);
			expect(own.input.ownerDocument).toBe(opened[0].window.document);
			expect([own.input.style.left, own.input.style.top, own.input.style.width]).toEqual([`${hex.x}px`, `${hex.y}px`, `${hex.w}px`]);
			expect(pageInput().focusedHost).toBe(picker);
			expect(pageInput().shown).toBe(false);
			own.input.value = '#123456';
			own.input.dispatchEvent(new Event('input', { bubbles: true }));
			expect(well.value).toBe('#123456');
			key(own.input, 'Enter');
			expect(own.focused).toBe(false);
			expect(pageInput().focusedHost).toBe(picker);
			// A key in the window with no field holding its input works the picker: Escape puts the colour back and shuts it.
			key(opened[0].window, 'Escape');
			expect(well.open).toBe(false);
			expect(well.value).toBe('#ff8b30');
			await stepEnds();
			expect(opened[0].window.closed).toBe(true);
		});

		it('changes its docking from a script, an open picker stood again where it now says', async () => {
			const { opened } = windows();
			const picker = pickerOf({ docking: 'in-view' });
			const { well, popover } = wellAt({ picker });
			tap(well.canvas, [150, 70]);
			picker.setDocking('popout');
			expect(picker.docking).toBe('popout');
			expect(picker.poppedOut).toBe(true);
			expect(popover.ownerDocument).toBe(opened[0].window.document);
			picker.setDocking('auto');
			expect(picker.poppedOut).toBe(false);
			expect(opened[0].window.closed).toBe(true);
			picker.popOut();
			expect(picker.poppedOut).toBe(true);
			picker.dock();
			expect(picker.poppedOut).toBe(false);
			picker.setDocking('sideways' as unknown as 'auto');
			expect(picker.docking).toBe('auto');
			expect(well.open).toBe(true);
		});
	});
});
