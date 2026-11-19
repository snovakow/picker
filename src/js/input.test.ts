// @vitest-environment jsdom
/**
 * @fileoverview The input a colour widget and its picker's fields are typed
 * through: the focus given to one host at a time and let go, kept through
 * the window losing the focus, what is typed mirrored to the host, a key kept
 * from the window, Escape, the caret's keys left to the browser's field, a
 * key an input method is composing with left to it, its place over the
 * screen, its showing as the field for a picker's field alone, its words
 * raised to where the host paints them, and measured again as a face arrives.
 * jsdom measures no font, so a context stands in that sets the words 5 px
 * below a line's middle where the host sets them 3.75 px below it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageInput, pageInput, pageInputMade, resetPageInput, type InputHost, type InputLook } from './input.ts';

/** A host that records what it is told, and takes the keys it is asked to. */
const hostOf = (takes: (key: string) => boolean = () => false) => {
	const told: string[] = [];
	const host: InputHost & { told: string[] } = {
		told,
		onInput: (value) => { told.push(`input:${value}`); },
		onKey: (event) => {
			told.push(`key:${event.key}`);
			return takes(event.key);
		},
		onBlur: () => { told.push('blur'); },
	};
	return host;
};

/** A field's look at twice the host's pixels. */
const LOOK: InputLook = { font: { family: 'Roboto Mono', size: 16, weight: 400, style: 'normal' }, families: '"Roboto Mono", monospace', color: 'rgba(1,2,3,1)', background: '#ffffff', accent: 'rgba(47,111,214,1)', align: 'center', padX: 11, padY: 9, radius: 6, line: 1, lineColor: 'rgba(209,213,219,1)', opacity: 0.5, scale: 2 };

beforeEach(() => {
	const metrics = {
		font: '',
		textBaseline: 'alphabetic',
		measureText: () => (metrics.textBaseline === 'middle' ? { fontBoundingBoxAscent: 10.25, fontBoundingBoxDescent: 7.75 } : { fontBoundingBoxAscent: 14, fontBoundingBoxDescent: 4 }),
	};
	// Cast to never: the spy is typed by getContext's last overload, which WebGPU's types make WebGPU's.
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(metrics as never);
});

afterEach(() => {
	resetPageInput();
	vi.restoreAllMocks();
});

describe('PageInput', () => {
	it('is made once, in the body, and let go by the reset', () => {
		expect(pageInputMade()).toBeNull();
		const input = pageInput();
		expect(pageInput()).toBe(input);
		expect(input.holder).toBe(document.body);
		expect(document.body.contains(input.input)).toBe(true);
		expect(input.input.className).toBe('colourPickerInput');
		expect(input.input.tabIndex).toBe(-1);
		resetPageInput();
		expect(pageInputMade()).toBeNull();
		expect(document.body.contains(input.input)).toBe(false);
	});

	it('gives the focus to one host at a time, the words held with the caret at their end, and tells the first it lost it', () => {
		const input = new PageInput(document.body);
		const a = hostOf();
		const b = hostOf();
		input.focus('field', 'hello', a);
		expect(input.focused).toBe(true);
		expect(input.focusedHost).toBe(a);
		expect(input.element).toBe(input.input);
		expect(document.activeElement).toBe(input.input);
		expect(input.input.value).toBe('hello');
		expect(input.input.selectionStart).toBe(5);
		input.focus('colour', '#ff8b30', b);
		expect(a.told).toEqual(['blur']);
		expect(input.focusedHost).toBe(b);
		expect(document.activeElement).toBe(input.input);
		input.blur();
		expect(b.told).toEqual(['blur']);
		expect(input.focused).toBe(false);
		expect(input.element).toBeNull();
		input.blur();
		expect(b.told).toEqual(['blur']);
		input.dispose();
	});

	it('lets the focus go first where one host hands it between its colour and a field, and makes the colour\'s input read-only and out of sight, so no keyboard is raised for it', () => {
		const input = new PageInput(document.body);
		const host = hostOf();
		input.focus('colour', '#ff8b30', host);
		expect(input.input.readOnly).toBe(true);
		expect(input.shown).toBe(false);
		expect(input.input.value).toBe('#ff8b30');
		input.focus('field', 'ff8b30', host);
		expect(host.told).toEqual(['blur']);
		expect(input.input.readOnly).toBe(false);
		expect(input.shown).toBe(true);
		input.dispose();
	});

	it('mirrors what is typed to the host as it is typed, and writes words set under the typing', () => {
		const input = new PageInput(document.body);
		const host = hostOf();
		input.focus('field', '', host);
		input.input.value = 'w';
		input.input.dispatchEvent(new Event('input', { bubbles: true }));
		expect(host.told).toEqual(['input:w']);
		input.setValue('set');
		expect(input.input.value).toBe('set');
		expect(input.input.selectionStart).toBe(3);
		input.dispose();
	});

	it('keeps a key from the window, offers it to the host first, and lets the focus go on an Escape the host leaves', () => {
		const input = new PageInput(document.body);
		const seen = vi.fn();
		window.addEventListener('keydown', seen);
		const host = hostOf((key) => key === 'Enter');
		input.focus('field', 'w', host);
		const w = new KeyboardEvent('keydown', { key: 'w', bubbles: true, cancelable: true });
		input.input.dispatchEvent(w);
		expect(seen).not.toHaveBeenCalled();
		expect(w.defaultPrevented).toBe(false);
		const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
		input.input.dispatchEvent(enter);
		expect(enter.defaultPrevented).toBe(true);
		expect(input.focused).toBe(true);
		input.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		expect(input.focused).toBe(false);
		expect(host.told).toEqual(['key:w', 'key:Enter', 'key:Escape', 'blur']);
		expect(seen).not.toHaveBeenCalled();
		window.removeEventListener('keydown', seen);
		input.dispose();
	});

	it('leaves the keys that move the caret, and a selection of the words, to the browser\'s field, and offers the colour\'s keys to its host', () => {
		const input = new PageInput(document.body);
		const host = hostOf();
		input.focus('field', 'words', host);
		const left = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
		input.input.dispatchEvent(left);
		expect(left.defaultPrevented).toBe(false);
		const home = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true });
		input.input.dispatchEvent(home);
		expect(home.defaultPrevented).toBe(false);
		input.input.setSelectionRange(0, 5);
		input.input.dispatchEvent(new Event('select'));
		expect(input.input.selectionStart).toBe(0);
		expect(input.input.selectionEnd).toBe(5);
		expect(host.told).toEqual(['key:ArrowLeft', 'key:Home']);
		const picker = hostOf((key) => key === 'ArrowDown');
		input.focus('colour', '#ff8b30', picker);
		const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
		input.input.dispatchEvent(down);
		expect(picker.told).toEqual(['key:ArrowDown']);
		expect(down.defaultPrevented).toBe(true);
		input.dispose();
	});

	it('keeps a selection started in the field, select-all among them, from a listener on the document that refuses every other', () => {
		const input = new PageInput(document.body);
		input.focus('field', 'words', hostOf());
		const refused = vi.fn((event: Event) => event.preventDefault());
		document.addEventListener('selectstart', refused);
		const inField = new Event('selectstart', { bubbles: true, cancelable: true });
		input.input.dispatchEvent(inField);
		expect(refused).not.toHaveBeenCalled();
		expect(inField.defaultPrevented).toBe(false);
		document.body.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true }));
		expect(refused).toHaveBeenCalledTimes(1);
		document.removeEventListener('selectstart', refused);
		input.dispose();
	});

	it('leaves a key an input method is composing with to the method, not offered to the host', () => {
		const input = new PageInput(document.body);
		const host = hostOf(() => true);
		input.focus('field', 'か', host);
		const enter = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
		input.input.dispatchEvent(enter);
		input.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }));
		expect(host.told).toEqual([]);
		expect(enter.defaultPrevented).toBe(false);
		expect(input.focused).toBe(true);
		input.dispose();
	});

	it('keeps its host through the window losing the focus, and passes a key on while no host has it', () => {
		const input = new PageInput(document.body);
		const host = hostOf();
		input.focus('field', '', host);
		// The window's blur leaves the element the document's focus.
		input.input.dispatchEvent(new FocusEvent('blur'));
		expect(document.activeElement).toBe(input.input);
		expect(input.focused).toBe(true);
		expect(host.told).toEqual([]);
		input.blur();
		expect(host.told).toEqual(['blur']);
		expect(document.activeElement).not.toBe(input.input);
		input.input.focus();
		const seen = vi.fn();
		window.addEventListener('keydown', seen);
		input.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true, cancelable: true }));
		expect(seen).toHaveBeenCalledTimes(1);
		window.removeEventListener('keydown', seen);
		input.blur();
		expect(document.activeElement).not.toBe(input.input);
		input.dispose();
	});

	it('tells the host when the browser takes the focus away', () => {
		const input = new PageInput(document.body);
		const host = hostOf();
		input.focus('field', '', host);
		input.input.blur();
		expect(host.told).toEqual(['blur']);
		expect(input.focused).toBe(false);
		input.dispose();
	});

	it('is shown over its box as the field for a picker\'s field, out of sight for the colour, and hidden again as the focus goes', () => {
		const input = new PageInput(document.body);
		input.focus('field', 'words', hostOf());
		input.place({ left: 10, top: 20, width: 400, height: 76 }, LOOK);
		const field = input.input.style;
		expect(field.opacity).toBe('0.5');
		expect(field.pointerEvents).toBe('auto');
		expect(field.width).toBe('400px');
		expect(field.fontSize).toBe('32px');
		expect(field.fontFamily.replace(/\s/g, '')).toBe('"RobotoMono",monospace');
		expect(field.fontWeight).toBe('400');
		expect(field.fontStyle).toBe('normal');
		expect(field.textAlign).toBe('center');
		// The field's line is the element's border, so the room inside it is the
		// field's less the line, and the words fall where the host paints them:
		// set 1.25 px low by the browser, raised by twice that under the line.
		expect(field.padding).toBe('0px 20px 2.5px');
		expect(field.borderRadius).toBe('12px');
		expect(field.borderWidth).toBe('2px');
		expect(field.borderStyle).toBe('solid');
		expect(field.borderColor.replace(/\s/g, '')).toMatch(/^rgba?\(209,213,219(,1)?\)$/);
		// The caret alone is in the accent.
		expect(field.caretColor.replace(/\s/g, '')).toMatch(/^rgba?\(47,111,214(,1)?\)$/);
		expect(field.background).toBe('rgb(255, 255, 255)');
		expect(field.color.replace(/\s/g, '')).toMatch(/^rgba?\(1,2,3(,1)?\)$/);
		expect(field.lineHeight).toBe('normal');
		expect(input.input.hasAttribute('aria-hidden')).toBe(false);
		expect(input.shown).toBe(true);
		input.focus('colour', '#ff8b30', hostOf());
		input.place({ left: 10, top: 20, width: 400, height: 76 }, LOOK);
		expect(input.shown).toBe(false);
		expect(input.input.style.opacity).toBe('0');
		expect(input.input.style.pointerEvents).toBe('none');
		expect(input.input.style.width).toBe('400px');
		// Out of sight, but read while it has the focus, which the browser refuses to hide.
		expect(input.input.hasAttribute('aria-hidden')).toBe(false);
		input.place(null);
		expect(input.input.hasAttribute('aria-hidden')).toBe(false);
		input.focus('field', 'words', hostOf());
		input.place({ left: 10, top: 20, width: 400, height: 76 }, LOOK);
		input.blur();
		expect(input.input.style.opacity).toBe('0');
		expect(input.input.style.width).toBe('1px');
		expect(input.input.getAttribute('aria-hidden')).toBe('true');
		input.focus('field', 'words', hostOf());
		input.place({ left: 10, top: 20, width: 400, height: 76 }, LOOK);
		// The browser taking the focus hides it too.
		input.input.blur();
		expect(input.input.style.opacity).toBe('0');
		input.dispose();
	});

	it('measures its font again once a face arrives, the drop it held let go', async () => {
		// A module of its own, whose context is the one made here.
		vi.resetModules();
		const fonts = new EventTarget();
		Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
		let middle = 10.25;
		const metrics = {
			font: '',
			textBaseline: 'alphabetic',
			measureText: () => (metrics.textBaseline === 'middle' ? { fontBoundingBoxAscent: middle, fontBoundingBoxDescent: 7.75 } : { fontBoundingBoxAscent: 14, fontBoundingBoxDescent: 4 }),
		};
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(metrics as never);
		try {
			const { PageInput: Fresh } = await import('./input.ts');
			const input = new Fresh(document.body);
			const rect = { left: 10, top: 20, width: 400, height: 76 };
			input.focus('field', 'words', hostOf());
			input.place(rect, LOOK);
			expect(input.input.style.padding).toBe('0px 20px 2.5px');
			// The face's words now stand where the host's do: held until it is said to have arrived.
			middle = 9;
			input.place(rect, LOOK);
			expect(input.input.style.padding).toBe('0px 20px 2.5px');
			fonts.dispatchEvent(new Event('loadingdone'));
			input.place(rect, LOOK);
			expect(input.input.style.padding).toBe('0px 20px');
			input.dispose();
		} finally {
			delete (document as { fonts?: unknown }).fonts;
			vi.resetModules();
		}
	});

	it('is placed over a box of the screen, and back to a pixel at the corner for none', () => {
		const input = new PageInput(document.body);
		input.focus('colour', '#ff8b30', hostOf());
		input.place({ left: 10, top: 20, width: 100, height: 40 });
		expect(input.input.style.left).toBe('10px');
		expect(input.input.style.top).toBe('20px');
		expect(input.input.style.width).toBe('100px');
		expect(input.input.style.height).toBe('40px');
		input.place(null);
		expect(input.input.style.width).toBe('1px');
		expect(input.input.style.left).toBe('0px');
		input.dispose();
	});
});
