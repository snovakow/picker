// @vitest-environment jsdom
/**
 * @fileoverview A colour well on a page: its canvas laid out and sized, its
 * picker opened beside it where the screen's rule stands it, and the pointer
 * taken — a press held from the moment it goes down, a drag past a drag's
 * start, the click after a drag swallowed, a press let go as cancelled, the
 * page's input kept through a press on the well and let go by one anywhere
 * else — the value written as a script writes it, and the page's input
 * placed over the picker's field. jsdom has no 2D context, no layout and no
 * pointer events, so a canvas is given a context that does nothing, every
 * measure 0, the well's canvas a rect of the page pinned by the test, and a
 * pointer event is a mouse event carrying a pointer's fields.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./wheel.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./wheel.ts')>();
	return { ...actual, makeWheelRenderer: () => ({ canvas: document.createElement('canvas'), draw: () => { } }) };
});

import { ColourWell, SCREEN_ONLY } from './colourWell.ts';
import type { DropperOffer } from './colourPicker.ts';
import type { ColourOptions } from './options.ts';
import { pageInput, pageInputMade, resetPageInput } from './input.ts';
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

const made: ColourWell[] = [];

/** A page with no view to pick from. */
const NO_VIEW: DropperOffer = { screen: false, view: null, note: 'The page has no view' };

beforeEach(() => {
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => inertContext() as unknown as CanvasRenderingContext2D);
	document.body.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1024, bottom: 768, width: 1024, height: 768, x: 0, y: 0, toJSON: () => ({}) });
});

afterEach(() => {
	for (const well of made.splice(0)) well.dispose();
	resetPageInput();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

/** A well made from its options, orange unless they say otherwise, its canvas on the page with its top-left corner at a point of the window, painted, and what it tells recorded. */
const wellAt = (options: ColourOptions, at: [number, number] = [100, 50], dropper: DropperOffer = NO_VIEW) => {
	const told: string[] = [];
	const well = new ColourWell({ value: '#ff8b30', ...options, onEvent: (event) => { told.push(event); }, dropper });
	made.push(well);
	document.body.appendChild(well.canvas);
	const size = () => ({ w: parseFloat(well.canvas.style.width), h: parseFloat(well.canvas.style.height) });
	well.canvas.getBoundingClientRect = () => {
		const { w, h } = size();
		return { left: at[0], top: at[1], right: at[0] + w, bottom: at[1] + h, width: w, height: h, x: at[0], y: at[1], toJSON: () => ({}) };
	};
	well.update();
	const popover = (well as unknown as { picker: { canvas: HTMLCanvasElement } }).picker.canvas;
	const layout = () => (well as unknown as { picker: { popover: { layout: PickerLayout } | null } }).picker.popover!.layout;
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

/** A press let go where it went down, and the click the browser sends after it. */
const tap = (target: EventTarget, at: [number, number], pointerType = 'mouse') => {
	target.dispatchEvent(pointer('pointerdown', at, 1, pointerType));
	target.dispatchEvent(pointer('pointerup', at, 1, pointerType));
	target.dispatchEvent(mouse('click', at));
};

/** A point of the page over a point of the picker, in its own pixels. */
const onPicker = (popover: HTMLCanvasElement, [x, y]: [number, number]): [number, number] => [parseFloat(popover.style.left) + x, parseFloat(popover.style.top) + y];

/** A point of the picker's wheel: the centre moved by a distance along an angle, clockwise from the right in screen axes. */
const onWheel = (layout: PickerLayout, radius: number, degrees: number): [number, number] => {
	const wheel = layout.wheel!;
	const mid = wheel.w / 2;
	return [wheel.x + mid + radius * Math.cos(degrees * Math.PI / 180), wheel.y + mid + radius * Math.sin(degrees * Math.PI / 180)];
};

describe('a colour well', () => {
	it('lays its colour out on a canvas its box\'s size, out of the browser\'s touch gestures and selection, its picker shut, and is black with the browser\'s eyedropper alone where its options give nothing', () => {
		const { well, popover } = wellAt({});
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
		// Made from nothing, it is black, and offers the browser's own eyedropper alone.
		const bare = new ColourWell();
		made.push(bare);
		expect(bare.value).toBe('#000000');
		expect(bare.dropper).toBe(SCREEN_ONLY);
	});

	it('opens its picker against its face on a click and shuts it on a second, telling click, the picker below it, or above it where only that side holds it inside the window', () => {
		const { well, told, popover } = wellAt({});
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
		const { well, told, popover, layout } = wellAt({});
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
		const { well } = wellAt({});
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
			const { well, popover, layout } = wellAt({});
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
		const { well, popover } = wellAt({});
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

	it('opens one picker at a time across the page\'s wells, a press on another well shutting the first\'s', () => {
		const one = wellAt({});
		const two = wellAt({}, [400, 50]);
		tap(one.well.canvas, [150, 70]);
		tap(two.well.canvas, [450, 70]);
		expect(two.well.open).toBe(true);
		expect(one.well.open).toBe(false);
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
		const open = (well as unknown as { picker: { popover: { colour: number[]; terms: { alpha: number } } } }).picker.popover;
		expect(open.colour).toEqual([0x11, 0x22, 0x33]);
		expect(open.terms.alpha).toBeCloseTo(0x80 / 255, 9);
		expect(told).toEqual([]);
		well.setSwatches(['#445566', 'none', '#7788']);
		well.update();
		expect(layout().swatchHexes).toEqual(['#445566', '#77778888']);
	});

	it('shuts its picker and lets its focus go as it is disabled, and opens none while it is', () => {
		const { well, told } = wellAt({});
		tap(well.canvas, [150, 70]);
		well.disabled = true;
		expect(well.open).toBe(false);
		expect(pageInput().focused).toBe(false);
		told.length = 0;
		tap(well.canvas, [150, 70]);
		expect(well.open).toBe(false);
		expect(told).toEqual([]);
		well.disabled = false;
		tap(well.canvas, [150, 70]);
		expect(well.open).toBe(true);
	});

	it('places the page\'s input over the picker\'s field that holds it, and out of sight as the field gives it back', () => {
		const { well, popover, layout } = wellAt({});
		tap(well.canvas, [150, 70]);
		const hex = layout().hex;
		const at = onPicker(popover, [hex.x + hex.w / 2, hex.y + hex.h / 2]);
		popover.dispatchEvent(pointer('pointerdown', at));
		popover.dispatchEvent(pointer('pointerup', at));
		const input = pageInput();
		expect(input.shown).toBe(true);
		expect([input.input.style.left, input.input.style.top, input.input.style.width, input.input.style.height]).toEqual([`${100 + hex.x}px`, `${92 + hex.y}px`, `${hex.w}px`, `${hex.h}px`]);
		input.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		expect(input.shown).toBe(false);
		expect(well.open).toBe(true);
		expect(pageInputMade()?.focusedHost).toBe(well);
	});

	it('lets its canvases go as it is disposed, its picker shut and its focus let go', () => {
		const { well, popover } = wellAt({});
		tap(well.canvas, [150, 70]);
		well.dispose();
		expect(well.canvas.isConnected).toBe(false);
		expect(popover.isConnected).toBe(false);
		expect(pageInput().focused).toBe(false);
		document.body.dispatchEvent(pointer('pointerdown', [600, 600]));
		tap(well.canvas, [150, 70]);
		expect(well.open).toBe(false);
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
			const box = layout().dropper;
			tap(popover, onPicker(popover, [box.x + box.w / 2, box.y + box.h / 2]));
		};

		it('takes a press on the view while armed, ahead of the view\'s own listeners, the colour under the pointer taken as it goes down and moves and the eyedropper put away as it is let go, the click after it swallowed and the picker and the page\'s input kept', () => {
			const { element, seen, sampled, view } = viewOf();
			const { well, told, popover, layout } = wellAt({}, [100, 50], { screen: false, view });
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

		it('takes none as its press on the view is cancelled, puts itself away, and leaves the view\'s cursor its own as it is put away by Escape, by the picker shutting and as the offer changes', () => {
			const { element, view } = viewOf();
			const { well, popover, layout } = wellAt({}, [100, 50], { screen: false, view });
			tap(well.canvas, [150, 70]);
			clickDropper(popover, layout);
			element.dispatchEvent(pointer('pointerdown', [600, 500]));
			const first = well.value;
			element.dispatchEvent(pointer('pointercancel', [610, 520]));
			expect(well.value).toBe(first);
			expect(element.style.cursor).toBe('');
			clickDropper(popover, layout);
			pageInput().input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
			expect(element.style.cursor).toBe('');
			expect(well.open).toBe(true);
			clickDropper(popover, layout);
			well.closePicker();
			expect(element.style.cursor).toBe('');
			tap(well.canvas, [150, 70]);
			clickDropper(popover, layout);
			well.setDropper({ screen: false, view: null, note: 'The page has no view to pick colours from' });
			expect(element.style.cursor).toBe('');
			const tip = (well as unknown as { picker: { popover: { layout: PickerLayout } } }).picker.popover.layout.tip!;
			expect(tip.lines).toEqual(['Eyedropper not available', 'The page has no view to pick colours from']);
		});
	});
});
