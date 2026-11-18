/**
 * @fileoverview The page's input, which a colour widget and its picker's
 * fields are typed through.
 *
 * A widget is a picture its host paints, so nothing in it takes the keyboard
 * of itself. One input stands in the page's body for every host: a press
 * released on a colour widget, or on a field of its picker, gives the input
 * the focus, placed over the box its host names on the screen. For a
 * picker's field (`'field'`) the input is shown there, styled as the field
 * it stands over (its font, colours, room, line, corners and opacity, at the
 * scale it is placed at, the caret in the accent colour), so the words are
 * typed in the browser's own field, with its caret, its selection and its
 * input method, and what is typed into it is mirrored into the field as it
 * is typed. For the colour itself (`'colour'`) the input stays out of sight
 * and read-only: it takes the keys the picker is worked by and raises no
 * keyboard. The input is hidden again as the focus goes. A selection started
 * in the input, select-all among them, is its own and goes no further than
 * it, kept from any listener on the document that refuses selections as they
 * bubble. A key pressed in the input while a host has it goes no further
 * than it: a key typed into a field is not for the host's own key listeners
 * on the window, if it has any. The host is offered every key first, Escape
 * among them, which shuts a picker or returns a field's input to the picker;
 * an Escape it leaves lets the focus go. A key an input method is composing
 * with is the method's. A press on the shown input is its own; a press
 * anywhere else takes the focus from it, but for one its host keeps the
 * focus through. The window losing the focus leaves the input the document's
 * focus, and its host keeps it.
 *
 * One host at a time: a focus on another host lets the first go first, so a
 * host is told it lost the focus before another gains it. A leaf: it touches
 * the document alone, and whatever focuses it is reached only through the
 * host it is given.
 */

import type { Font } from './layout.ts';

/** What the input stands in for: a picker's field, shown over it and typed in, or the colour itself, out of sight and worked by key. */
export type InputKind = 'field' | 'colour';

/** How the shown input is styled, as the field it stands over: lengths in the host's pixels, which `scale` turns into the screen's. */
export interface InputLook {
	/** The field's font, its size in the host's pixels. */
	font: Font;
	/** The font's families as CSS lists them, as the host's words are painted in them. */
	families: string;
	/** The field's words, its face and its accent, the caret's colour, as CSS colours. */
	color: string;
	background: string;
	accent: string;
	/** Which edge of the field the words keep to. */
	align: 'left' | 'center' | 'right';
	/** The room between the field's edge and its words, across and down, its line drawn in the outer part. */
	padX: number;
	padY: number;
	/** How round the field's corners are. */
	radius: number;
	/** How thick the field's line is, and its colour. */
	line: number;
	lineColor: string;
	/** How solid the field is drawn: its own opacity and its host's. */
	opacity: number;
	/** Screen pixels per pixel of the host, as the host is drawn this frame. */
	scale: number;
}

/** What the input tells the host that focused it, and asks of it. */
export interface InputHost {
	/** What is typed, as it is typed. */
	onInput(value: string): void;
	/** A key pressed in the input; true where the host took it, which keeps the browser from acting on it. */
	onKey(event: KeyboardEvent): boolean;
	/** The focus gone, by Escape, a press elsewhere, or the browser. */
	onBlur(): void;
	/**
	 * Puts a shown field's input away keeping the focus, back to the colour,
	 * where the host can: true where it did; false, or absent, where it
	 * cannot. The input never calls it: an embedder does, through
	 * `focusedHost`, as the page goes out of sight, as it does for VR.
	 */
	putAway?(): boolean;
}

/** Where the input is placed over the screen, in the holder's own pixels. */
export interface InputRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** The class the input carries, for a page to find it by. */
const INPUT_CLASS = 'colourPickerInput';

/** The context a font's metrics are read from, made as it is first needed; null where the page gives none. */
let metrics: CanvasRenderingContext2D | null | undefined;

/** The last font measured and its drop, let go as a face arrives: the field is placed again and again while it is shown, in one font. */
let measured: { font: string; drop: number } | null = null;

/**
 * How far below the host's line the browser sets a font's words, in screen
 * pixels: the host puts the middle of the font's em box on the middle of a
 * line, the browser the middle of its ascent and descent. 0 where nothing
 * measures.
 */
const dropOf = (font: string): number => {
	if (measured?.font === font) return measured.drop;
	if (metrics === undefined) {
		metrics = document.createElement('canvas').getContext('2d');
		// A face arriving changes what its font measures.
		document.fonts?.addEventListener('loadingdone', () => {
			measured = null;
		});
	}
	if (!metrics) return 0;
	metrics.font = font;
	metrics.textBaseline = 'alphabetic';
	const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = metrics.measureText('');
	metrics.textBaseline = 'middle';
	const panel = ascent - metrics.measureText('').fontBoundingBoxAscent;
	const drop = (ascent - descent) / 2 - panel;
	measured = { font, drop: Number.isFinite(drop) ? drop : 0 };
	return measured.drop;
};

/** The input, in a holder. */
export class PageInput {
	readonly input: HTMLInputElement;
	/** The element the input stands in. */
	readonly holder: HTMLElement;
	private host: InputHost | null = null;
	private kind: InputKind | null = null;

	/**
	 * @param holder - The element to stand the input in: the body, for the page's input
	 */
	constructor(holder: HTMLElement) {
		this.holder = holder;
		this.input = document.createElement('input');
		this.input.type = 'text';
		this.wire(this.input);
	}

	/** Styles the input out of sight and off the pointer, and puts its listeners up. */
	private wire(element: HTMLInputElement): void {
		element.className = INPUT_CLASS;
		const style = element.style;
		style.position = 'absolute';
		style.left = '0';
		style.top = '0';
		style.margin = '0';
		style.boxSizing = 'border-box';
		style.outline = 'none';
		style.overflow = 'hidden';
		style.zIndex = '1';
		this.stow(element);
		// Given the focus by its host alone, never by Tab.
		element.tabIndex = -1;
		element.autocomplete = 'off';
		element.setAttribute('autocapitalize', 'off');
		element.setAttribute('autocorrect', 'off');
		element.spellcheck = false;
		element.addEventListener('input', () => this.host?.onInput(element.value));
		// A selection in the field is the field's own, select-all among them,
		// and goes no further, so a listener on the document that refuses
		// selections as they bubble does not see it.
		element.addEventListener('selectstart', (event) => event.stopPropagation());
		// No further than the element while a host has it: a key typed into a
		// field is not for the host's own key listeners on the window, if it
		// has any. The key's release goes on, so no key a listener on the
		// window saw go down is left down for it. A key an input method is
		// composing with is the method's, Enter ending the composition and
		// Escape giving it up. The host is offered any other key first, Escape
		// included, which it takes to shut a picker; an Escape the host leaves
		// lets the focus go.
		element.addEventListener('keydown', (event) => {
			if (!this.host) return;
			event.stopPropagation();
			if (event.isComposing || event.keyCode === 229) return;
			if (this.host.onKey(event)) {
				event.preventDefault();
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				this.blur();
			}
		});
		element.addEventListener('blur', () => {
			// The window going out of focus blurs the element and leaves it the
			// document's focus, which it has again as the window comes back.
			if (document.activeElement === element) return;
			const was = this.host;
			this.host = null;
			this.kind = null;
			this.stow(element);
			was?.onBlur();
		});
		this.holder.appendChild(element);
	}

	/** Takes the input out of sight and off the pointer: a clear pixel at the holder's corner. */
	private conceal(element: HTMLInputElement): void {
		const style = element.style;
		style.left = '0';
		style.top = '0';
		style.width = '1px';
		style.height = '1px';
		style.opacity = '0';
		style.pointerEvents = 'none';
		style.border = '0';
		style.padding = '0';
		style.background = 'transparent';
		style.color = 'transparent';
		style.caretColor = 'transparent';
	}

	/** Takes the input without the focus out of sight, and out of what assistive technology reads. */
	private stow(element: HTMLInputElement): void {
		this.conceal(element);
		element.setAttribute('aria-hidden', 'true');
	}

	/** The input while a host has the focus; null while none has. */
	get element(): HTMLInputElement | null {
		return this.kind ? this.input : null;
	}

	/** Whether a host has the focus. */
	get focused(): boolean {
		return this.host !== null;
	}

	/** The host that has the focus; null for none. */
	get focusedHost(): InputHost | null {
		return this.host;
	}

	/** Whether the input is one shown over its field once placed with a look: a picker field's; the colour's is never shown. */
	get shown(): boolean {
		return this.kind === 'field';
	}

	/**
	 * Gives the focus to a host's field or colour, the colour's read-only so no
	 * keyboard is raised for it, holding its words with the caret at their
	 * end. A focus held by another host, or for the other kind, is let go
	 * first. A field's input is shown where `place` next puts it.
	 *
	 * @param kind - A picker's field, or the colour itself
	 * @param value - Its words as they stand
	 * @param host - What the input tells as it is used
	 */
	focus(kind: InputKind, value: string, host: InputHost): void {
		if (this.host && (this.host !== host || this.kind !== kind)) this.blur();
		const element = this.input;
		this.host = host;
		this.kind = kind;
		element.readOnly = kind === 'colour';
		element.value = value;
		// Read by assistive technology while it has the focus, the colour's out
		// of sight among them: the browser refuses to hide a focused element.
		element.removeAttribute('aria-hidden');
		if (document.activeElement !== element) element.focus({ preventScroll: true });
		try {
			element.setSelectionRange(value.length, value.length);
		} catch {
			// A browser that refuses a selection on the element leaves the caret where it is.
		}
	}

	/** Lets the focus go: the input blurred wherever it has the document's focus, with or without a host, hidden, and the host told. */
	blur(): void {
		const host = this.host;
		this.host = null;
		this.kind = null;
		if (document.activeElement === this.input) this.input.blur();
		this.stow(this.input);
		host?.onBlur();
	}

	/** Writes the words the focused field holds, as a script sets them under the typing, the caret kept at their end. */
	setValue(value: string): void {
		const element = this.element;
		if (!element || element.value === value) return;
		element.value = value;
		try {
			element.setSelectionRange(value.length, value.length);
		} catch {
			// As above.
		}
	}

	/**
	 * Places the input over a box of the screen, in the holder's own pixels,
	 * and, given the field's look, shows a field's input there styled as the
	 * field: its font, colours, room, line, corners and opacity at the look's
	 * scale, the caret in the accent colour, and the pointer its own, so a
	 * press in it moves the caret and a drag selects. Without a look it is
	 * only moved, the colour's out of sight, and a mobile keyboard and an
	 * input method still attach where the widget is drawn; null leaves it a
	 * pixel at the holder's corner.
	 */
	place(rect: InputRect | null, look?: InputLook): void {
		const element = this.input;
		const style = element.style;
		if (!rect) {
			this.conceal(element);
			return;
		}
		style.left = `${rect.left}px`;
		style.top = `${rect.top}px`;
		style.width = `${Math.max(1, rect.width)}px`;
		style.height = `${Math.max(1, rect.height)}px`;
		if (!look || !this.shown) return;
		const px = (length: number) => `${Math.max(0, length * look.scale)}px`;
		style.opacity = String(look.opacity);
		style.pointerEvents = 'auto';
		style.color = look.color;
		style.background = look.background;
		style.caretColor = look.accent;
		style.border = `${px(look.line)} solid ${look.lineColor}`;
		style.borderRadius = px(look.radius);
		style.fontFamily = look.families;
		style.fontSize = px(look.font.size);
		style.fontWeight = String(look.font.weight);
		style.fontStyle = look.font.style;
		style.textAlign = look.align;
		// The line is the element's border, inside its box, so the field's room
		// stands inside it and the words fall where the host paints them. The
		// input centres its line in its height of itself, raised by as far as
		// the browser sets the font's words below the host's, by room under
		// its line.
		const across = Math.max(0, (look.padX - look.line) * look.scale);
		const drop = dropOf(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${look.families}`);
		style.padding = `${Math.max(0, -2 * drop)}px ${across}px ${Math.max(0, 2 * drop)}px`;
		style.lineHeight = 'normal';
	}

	/** Takes the input out of the holder, the focus let go first. */
	dispose(): void {
		this.blur();
		this.input.remove();
	}
}

/** The one input of the page, made as it is first needed. */
let shared: PageInput | null = null;

/** The page's input, made in the body the first time it is asked for. */
export const pageInput = (): PageInput => shared ??= new PageInput(document.body);

/** The page's input where one has been made; null before. */
export const pageInputMade = (): PageInput | null => shared;

/** Lets the page's input go, so a test or a page torn down starts without one. */
export const resetPageInput = (): void => {
	shared?.dispose();
	shared = null;
};
