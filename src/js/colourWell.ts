/**
 * @fileoverview A colour well on a page: a colour widget made from its
 * options (`ColourWellOptions`), drawn on a canvas of its own, laid out and
 * painted on its own (`layoutWell`, `paintWell`), which opens the colour's
 * picker (colourPicker.ts) beside it, on a canvas of the picker's own that
 * stands over the page, one pixel of the picker to a pixel of the page. It
 * is the picker's host (`PickerHost`): its pixels are the page's, measured
 * from the window's top-left corner, and it is as large as the window.
 *
 * The well takes the pointer: a primary press is held from the moment it
 * goes down, the pointer captured, and is a drag once it has gone further on
 * the screen than a drag's start, a touch's as far as a touch's hold
 * (`TOUCH_SLOP`), anything else's `DRAG_SLOP`; the click after a press that
 * moved is the drag's, and is swallowed. A press is let go as cancelled
 * where the browser cancels the pointer or takes the capture back, where a
 * mouse moves with no button down, where the window loses the focus, and
 * where its own pointer or a new first pointer goes down again on the well
 * or its picker. A press carrying the picker reads the pointer held inside
 * the window, so the point carried stays in view. A press on the well or its
 * picker keeps the input this well holds where it is, taking it from any
 * other host, the browser's focus change kept off the press; a press
 * anywhere else on the page shuts the picker and lets the input go, the
 * input's own element aside.
 *
 * The picker stands on the page by `screenPopoverRect`: against the well's
 * face, on the side its layout opens it, or the other where only that side
 * holds it inside the window, kept inside the window, and on the side it
 * stood on as the viewer began to carry it; it is stood again as the page
 * scrolls or the window is resized.
 * The page's input is placed over the field of the picker that holds it, or
 * over the well's face, out of sight, while the colour itself holds it.
 *
 * At most one well's picker is open on a page: a picker opening shuts every
 * other.
 *
 * The well offers its picker's eyedropper what its page gives it
 * (`DropperOffer`): the browser's own eyedropper, and a view to pick from, or
 * the note why there is none. While the eyedropper is armed on the view, the
 * view's cursor is a crosshair, and a press on the view is the eyedropper's,
 * taken ahead of the view's own listeners: the colour under the pointer is
 * taken as the press goes down and as it moves, the eyedropper put away as it
 * is let go, and the click after it swallowed; the page's input keeps its
 * focus through it, and the picker stays open.
 */

import { ColourPicker, type DropperOffer, type PickerHost, type Uv } from './colourPicker.ts';
import { pageInput, pageInputMade, type InputHost, type InputLook } from './input.ts';
import { fontString, loadFaces, paintWell } from './paint.ts';
import { MONO_FAMILY, inBox, layoutWell, restingState, type Box, type Font, type Laid, type TextMeasure, type WidgetState } from './layout.ts';
import { readColourOptions, swatchesOf, type ColourOptions, type ColourWidget, type WidgetEvent } from './options.ts';
import { DRAG_SLOP, TOUCH_SLOP, screenPopoverRect } from './pointer.ts';
import { formatColour, parseColour } from './hex.ts';

/** What a well is made from: its colour widget's options, and what it tells and offers its eyedropper. */
export interface ColourWellOptions extends ColourOptions {
	/** Told each event the colour tells: `click` as the well is clicked, `change` as a colour is taken, `enter` and `leave` as the pointer comes onto or goes off the well or its picker, crossing from one to the other telling `leave`, then `enter`. */
	onEvent?: (event: WidgetEvent, well: ColourWell) => void;
	/** What the page offers the picker's eyedropper: the browser's own eyedropper, and a view to pick from or the note why there is none; where left out, the browser's own alone (`SCREEN_ONLY`). */
	dropper?: DropperOffer;
}

/** What a well offers its eyedropper where its options give nothing: the browser's own, where it has one, and no view, the tooltip saying why. */
export const SCREEN_ONLY: DropperOffer = { screen: true, view: null, note: 'Picking from the screen needs Chrome or Edge on a computer' };

/** A press held on the well or on its picker: which pointer holds it, what it is on, where on the screen it went down, how far it may go before it is a drag, and whether it has. */
interface Held {
	pointerId: number;
	on: 'well' | 'picker';
	startX: number;
	startY: number;
	slop: number;
	moved: boolean;
}

/** Every well on the page not yet let go, so a picker opening shuts the others. */
const wells = new Set<ColourWell>();

/** The context words are measured in, made as it is first needed. */
let measurer: CanvasRenderingContext2D | null = null;

/** How wide a run of words is in a font, as the browser sets it on a canvas. */
const measure: TextMeasure = (text: string, font: Font): number => {
	measurer ??= document.createElement('canvas').getContext('2d')!;
	measurer.font = fontString(font);
	return measurer.measureText(text).width;
};

/** A laid widget moved by an offset, its parts with it. */
const shifted = (laid: Laid, dx: number, dy: number): Laid => {
	const move = (box: Box): Box => ({ x: box.x + dx, y: box.y + dy, w: box.w, h: box.h });
	return {
		...laid,
		box: move(laid.box),
		face: move(laid.face),
		inner: move(laid.inner),
		title: laid.title ? move(laid.title) : null,
		swatch: move(laid.swatch),
	};
};

/** A point of the page held inside the window, where a carried picker's point is kept. */
const onPage = (event: { clientX: number; clientY: number }): { x: number; y: number } => ({
	x: Math.min(Math.max(event.clientX, 0), Math.max(0, window.innerWidth)),
	y: Math.min(Math.max(event.clientY, 0), Math.max(0, window.innerHeight)),
});

export class ColourWell implements PickerHost, InputHost {
	readonly widget: ColourWidget;
	/** The well's canvas, which the page places where it likes. */
	readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D;
	private readonly picker: ColourPicker;
	private readonly state: WidgetState;
	private readonly onEvent: ColourWellOptions['onEvent'];
	/** The well as last laid out, in its canvas's own pixels. */
	private laid: Laid;
	/** Whether something the well is painted from changed since it was last painted. */
	private dirty = true;
	/** The frame a paint is asked for on; 0 while none is. */
	private frame = 0;
	private disposed = false;
	/** The widget the page's input is typed into: the well's own, while it holds it. */
	private focusedWidget: ColourWidget | null = null;
	/** Where the picker stands on the page, in its pixels, and the side of the well it stands on, with how far standing there rather than on the side its layout gives moved it; null while it stands nowhere. */
	private screen: { box: Box; side: { side: 'above' | 'below'; turn: number } } | null = null;
	private held: Held | null = null;
	/** Whether the last press held moved past a drag's start, so the click after it is the drag's; cleared as the next press goes down. */
	private dragged = false;
	/** What the page offers the eyedropper. */
	private dropperOffer: DropperOffer;
	/** The press on the view the eyedropper holds, by its pointer; null while none is held. */
	private dropHeld: { pointerId: number } | null = null;
	/** Whether the click after the eyedropper's press on the view is yet to come, to be swallowed. */
	private dropClick = false;
	/** Whether the view's cursor is the eyedropper's crosshair. */
	private crosshair = false;
	/** Whether the pointer is over the well or its picker, as last told. */
	private over = false;
	private readonly listened: { target: EventTarget; type: string; listener: EventListener; options?: boolean | AddEventListenerOptions }[] = [];
	private readonly facesLoaded = () => this.invalidate();

	/**
	 * @param options - The colour widget's options (`readColourOptions`), what the well tells, and what the page offers its eyedropper
	 */
	constructor(options: ColourWellOptions = {}) {
		loadFaces();
		this.widget = readColourOptions(options);
		this.onEvent = options.onEvent;
		this.dropperOffer = options.dropper ?? SCREEN_ONLY;
		this.state = restingState(this.widget);
		this.canvas = document.createElement('canvas');
		this.canvas.className = 'colourWell';
		this.ctx = this.canvas.getContext('2d')!;
		this.laid = layoutWell(this.widget, this.state, measure);
		this.picker = new ColourPicker(this);
		const popover = this.picker.canvas;
		popover.className = 'colourWellPicker';
		// Over the page, under the page's input, which stands over the picker's fields.
		Object.assign(popover.style, { position: 'fixed', left: '0px', top: '0px', zIndex: '0', display: 'none' });
		for (const canvas of [this.canvas, popover]) {
			Object.assign(canvas.style, { touchAction: 'none', userSelect: 'none' });
			this.listen(canvas, 'pointerdown', (event) => this.down(event as PointerEvent, canvas === popover ? 'picker' : 'well'));
			this.listen(canvas, 'pointermove', (event) => this.moved(event as PointerEvent, canvas === popover ? 'picker' : 'well'));
			this.listen(canvas, 'pointerup', (event) => this.up(event as PointerEvent));
			this.listen(canvas, 'pointercancel', (event) => this.cancelled(event as PointerEvent));
			this.listen(canvas, 'lostpointercapture', (event) => this.cancelled(event as PointerEvent));
			this.listen(canvas, 'pointerleave', () => this.left(canvas === popover ? 'picker' : 'well'));
			this.listen(canvas, 'click', (event) => this.clicked(event as MouseEvent, canvas === popover ? 'picker' : 'well'));
			// The browser's own drag and its focus change on a press stay off a press the well holds.
			this.listen(canvas, 'mousedown', (event) => event.preventDefault());
		}
		document.body.appendChild(popover);
		// A press anywhere else on the page shuts the picker, ahead of what it lands on, but a press on the view the eyedropper takes.
		this.listen(window, 'pointerdown', (event) => this.pressedElsewhere(event as PointerEvent), true);
		this.listen(window, 'pointermove', (event) => this.dropMoved(event as PointerEvent), true);
		this.listen(window, 'pointerup', (event) => this.dropEnded(event as PointerEvent, true), true);
		this.listen(window, 'pointercancel', (event) => this.dropEnded(event as PointerEvent, false), true);
		this.listen(window, 'lostpointercapture', (event) => this.dropEnded(event as PointerEvent, false), true);
		this.listen(window, 'mousedown', (event) => this.dropSwallow(event), true);
		this.listen(window, 'click', (event) => this.dropSwallow(event), true);
		this.listen(window, 'blur', () => this.letGo(null));
		this.listen(window, 'resize', () => this.restand());
		this.listen(window, 'scroll', () => this.restand(), { capture: true, passive: true });
		// Faces that arrive after the first paint have it painted again in its
		// own; where they are already in, the first paint is already in them.
		if (typeof document.fonts?.load === 'function') {
			const faces = ['400 16px Roboto', `400 16px "${MONO_FAMILY}"`];
			if (!faces.every((face) => document.fonts.check?.(face) === true)) {
				void Promise.all(faces.map((face) => document.fonts.load(face))).then(this.facesLoaded, () => { });
			}
			document.fonts.addEventListener?.('loadingdone', this.facesLoaded);
		}
		wells.add(this);
		this.update();
	}

	// ---------------------------------------------------------------------
	// What a script reads and writes
	// ---------------------------------------------------------------------

	/** The colour, as `formatColour` writes one: `#rrggbb`, or `#rrggbbaa` where it carries an alpha below 1. */
	get value(): string {
		return this.state.text;
	}

	/**
	 * Writes the colour, as a script writes one: held as `formatColour`
	 * writes a colour, its alpha dropped where the widget carries none, an
	 * open picker reading it afresh, and nothing told.
	 *
	 * @returns Whether the text reads as a colour; one that does not is refused
	 */
	setValue(text: string): boolean {
		const colour = parseColour(text);
		if (!colour) return false;
		const hex = formatColour(this.widget.alpha ? colour : { r: colour.r, g: colour.g, b: colour.b });
		if (this.state.text === hex) return true;
		this.state.text = hex;
		if (this.picker.openColor === this.widget) this.picker.sync();
		this.invalidate();
		return true;
	}

	/** Writes the colour's own swatches, held as its options' are read (`swatchesOf`); the picker lays them out as it is painted again. */
	setSwatches(swatches: readonly string[]): void {
		this.state.swatches = swatchesOf(swatches, this.widget.alpha === true);
		this.invalidate();
	}

	/** Whether the colour can be used. */
	get disabled(): boolean {
		return this.state.disabled;
	}

	/** Enables or disables the colour; disabled, its picker shuts, its focus goes and a press on it is let go. */
	set disabled(disabled: boolean) {
		if (this.state.disabled === disabled) return;
		this.state.disabled = disabled;
		if (disabled) {
			if (this.focusedWidget) pageInputMade()?.blur();
			this.picker.close();
			if (this.held) this.letGo(null);
		}
		this.invalidate();
	}

	/** Whether the colour's picker is open. */
	get open(): boolean {
		return this.picker.openColor !== null;
	}

	/** Shuts the colour's picker, where it is open; the colour stays as it was last taken. */
	closePicker(): void {
		this.picker.close();
	}

	/** Lets the well go: its picker shut, its focus let go, its canvases and listeners taken away. */
	dispose(): void {
		if (this.disposed) return;
		this.resetInteraction();
		this.disposed = true;
		wells.delete(this);
		cancelAnimationFrame(this.frame);
		if (this.crosshair && this.dropperOffer.view) this.dropperOffer.view.element.style.cursor = '';
		for (const { target, type, listener, options } of this.listened) target.removeEventListener(type, listener, options);
		document.fonts?.removeEventListener?.('loadingdone', this.facesLoaded);
		this.picker.canvas.remove();
		this.canvas.remove();
	}

	// ---------------------------------------------------------------------
	// Painting
	// ---------------------------------------------------------------------

	/**
	 * Lays the well out and paints it where something changed since it was
	 * last painted, its canvas sized to its box at the page's resolution, then
	 * lays its open picker out again and paints it (`relay`), and places the
	 * page's input over what holds it. Called on the frame after a change;
	 * a test calls it to paint at once.
	 */
	update(): void {
		if (this.disposed) return;
		cancelAnimationFrame(this.frame);
		this.frame = 0;
		if (this.dirty) {
			this.dirty = false;
			this.laid = layoutWell(this.widget, this.state, measure);
			const resolution = this.resolution;
			const { w, h } = this.laid.box;
			const across = Math.max(1, Math.round(w * resolution));
			const down = Math.max(1, Math.round(h * resolution));
			if (this.canvas.width !== across || this.canvas.height !== down) {
				this.canvas.width = across;
				this.canvas.height = down;
			}
			this.canvas.style.width = `${w}px`;
			this.canvas.style.height = `${h}px`;
			this.ctx.setTransform(1, 0, 0, 1, 0, 0);
			this.ctx.clearRect(0, 0, across, down);
			this.ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
			paintWell(this.ctx, this.laid);
			this.picker.relay();
		}
		this.placeInput();
	}

	invalidate(): void {
		this.dirty = true;
		if (this.disposed || this.frame) return;
		this.frame = requestAnimationFrame(() => this.update());
	}

	// ---------------------------------------------------------------------
	// The picker's host
	// ---------------------------------------------------------------------

	/** The well laid out, in the page's pixels: where its canvas stands in the window. */
	laidOf(widget: ColourWidget): Laid | null {
		if (widget !== this.widget || this.disposed || !this.canvas.isConnected) return null;
		const rect = this.canvas.getBoundingClientRect();
		return shifted(this.laid, rect.left, rect.top);
	}

	stateOf(_widget: ColourWidget): WidgetState {
		return this.state;
	}

	tell(_widget: ColourWidget, event: WidgetEvent): void {
		this.onEvent?.(event, this);
	}

	get width(): number {
		return window.innerWidth;
	}

	get height(): number {
		return window.innerHeight;
	}

	get resolution(): number {
		return window.devicePixelRatio || 1;
	}

	get measure(): TextMeasure {
		return measure;
	}

	/** Stands the picker against the well's face on the page (`screenPopoverRect`), or hides it. */
	placePopover(box: Box | null): void {
		const popover = this.picker.canvas;
		const stand = this.picker.stand;
		const laid = this.laidOf(this.widget);
		if (!box || !stand || !laid) {
			this.screen = null;
			popover.style.display = 'none';
			this.showCrosshair();
			return;
		}
		const field = laid.face;
		const anchor = { x: field.x, y: field.y + field.h / 2, z: 0, top: field.y, foot: field.y + field.h };
		const bounds = { minX: 0, minY: 0, maxX: window.innerWidth, maxY: window.innerHeight };
		const at = screenPopoverRect(anchor, field, box, bounds, stand.offset, 1, stand.side);
		if (!at) {
			this.screen = null;
			popover.style.display = 'none';
			return;
		}
		this.screen = { box: { x: at.left, y: at.top, w: at.width, h: at.height }, side: { side: at.side, turn: at.turn } };
		Object.assign(popover.style, { left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px`, height: `${at.height}px`, display: 'block' });
		this.placeInput();
	}

	standing(box: Box): { box: Box; side: { side: 'above' | 'below'; turn: number } | null } {
		return this.screen ? { box: this.screen.box, side: this.screen.side } : { box, side: null };
	}

	/** The picker painted again, which may have handed the page's input to one of its fields or back: the input is placed over what holds it now. The picker's canvas is on the page itself, so what it holds is shown as it is painted. */
	popoverPainted(_resized: boolean): void {
		this.placeInput();
		this.showCrosshair();
	}

	/** The view's cursor the eyedropper's crosshair while it is armed on the view, and the view's own otherwise. */
	private showCrosshair(): void {
		const view = this.dropperOffer.view;
		const armed = view !== null && this.picker.dropping();
		if (!view || armed === this.crosshair) return;
		this.crosshair = armed;
		view.element.style.cursor = armed ? 'crosshair' : '';
	}

	get focused(): ColourWidget | null {
		return this.focusedWidget;
	}

	/** Gives the colour the page's input: drawn focused, and worked by key through the input, out of sight; where a field of its picker holds the input, back to the colour's body. */
	focus(widget: ColourWidget): void {
		const input = pageInput();
		if (this.focusedWidget !== widget) {
			if (input.focused) input.blur();
			this.focusedWidget = widget;
			this.state.focused = true;
			this.invalidate();
		} else if (this.picker.inField(widget)) {
			this.picker.returnToBody();
			return;
		}
		input.focus('colour', this.state.text, this);
		this.placeInput();
	}

	/** A page holds no order of fields for a well: Tab past the picker's last field lets the input go. */
	focusAfter(_widget: ColourWidget): boolean {
		return false;
	}

	get inputHost(): InputHost {
		return this;
	}

	get dropper(): DropperOffer {
		return this.dropperOffer;
	}

	/** Changes what the page offers the eyedropper: the picker reads it afresh, an eyedropper armed in a tier it no longer holds put away. */
	setDropper(offer: DropperOffer): void {
		if (this.crosshair && this.dropperOffer.view) this.dropperOffer.view.element.style.cursor = '';
		this.crosshair = false;
		this.dropperOffer = offer;
		this.picker.dropperChanged();
		this.showCrosshair();
	}

	/** Shuts every other well's picker. */
	closeOther(): void {
		for (const well of wells) {
			if (well !== this) well.closePicker();
		}
	}

	// ---------------------------------------------------------------------
	// The page's input
	// ---------------------------------------------------------------------

	onInput(value: string): void {
		const widget = this.focusedWidget;
		if (!widget || this.disposed) return;
		this.picker.input(widget, value);
	}

	/**
	 * A key pressed in the page's input: one of the picker's fields holding
	 * it takes its keys; Tab on an open picker enters its hex field, and
	 * Shift+Tab, or Tab on a shut picker, lets the input go; the rest work
	 * the picker (`key`).
	 */
	onKey(event: KeyboardEvent): boolean {
		const widget = this.focusedWidget;
		if (!widget || this.disposed) return false;
		if (this.picker.inField(widget)) return this.picker.fieldKeyOf(widget, event);
		if (event.key === 'Tab') {
			if (!event.shiftKey && this.picker.openColor === widget) {
				this.picker.enterHex();
				return true;
			}
			pageInput().blur();
			return true;
		}
		return this.picker.key(widget, event);
	}

	/**
	 * The focus gone from the page's input: the colour is drawn resting, and
	 * its picker shut; while the input is being handed between the picker's
	 * body and one of its fields the blur is the hand-off's, and leaves both.
	 */
	onBlur(): void {
		if (this.picker.handing) return;
		const widget = this.focusedWidget;
		if (!widget) return;
		this.focusedWidget = null;
		this.state.focused = false;
		if (this.picker.openColor === widget) this.picker.close();
		this.invalidate();
	}

	/** Puts a picker field's shown input away, back to the colour's body, keeping the focus, where an embedder takes the page out of sight, as it does for VR; whether it did. */
	putAway(): boolean {
		if (!this.focusedWidget || !this.picker.inField(this.focusedWidget)) return false;
		this.picker.returnToBody();
		return true;
	}

	/** Where the page's input stands, in the page's pixels: over the field of the picker that holds it, shown in the field's look while the picker stands on the page; or over the well's face, out of sight. Null where the colour is not laid out. */
	private placement(): { visible: boolean; box: Box; look: Omit<InputLook, 'scale'> | null } | null {
		const widget = this.focusedWidget;
		const laid = widget ? this.laidOf(widget) : null;
		if (!widget || !laid) return null;
		const field = this.picker.placement(widget, laid.style.opacity);
		if (field) return { visible: this.screen !== null, box: { x: field.box.x + field.field.x, y: field.box.y + field.field.y, w: field.field.w, h: field.field.h }, look: field.look };
		return { visible: true, box: laid.face, look: null };
	}

	/** Places the page's input over what holds it, in its holder's own pixels, where this well holds it; lets it go where the colour is not laid out, and hides it while the picker its field is on stands nowhere. */
	private placeInput(): void {
		const input = pageInputMade();
		if (!input?.focused || input.focusedHost !== this) return;
		const place = this.placement();
		if (!place) {
			input.blur();
			return;
		}
		if (!place.visible) {
			input.place(null);
			return;
		}
		const holder = input.holder.getBoundingClientRect();
		const { box, look } = place;
		input.place({ left: box.x - holder.left, top: box.y - holder.top, width: box.w, height: box.h }, look ? { ...look, scale: 1 } : undefined);
	}

	// ---------------------------------------------------------------------
	// The pointer
	// ---------------------------------------------------------------------

	/** A point of the picker's plane under a point of the page, from its left and up from its foot. */
	private uvOf(event: { clientX: number; clientY: number }): Uv | null {
		const box = this.screen?.box;
		if (!box || box.w <= 0 || box.h <= 0) return null;
		return { x: (event.clientX - box.x) / box.w, y: 1 - (event.clientY - box.y) / box.h };
	}

	private down(event: PointerEvent, on: 'well' | 'picker'): void {
		this.dragged = false;
		if (this.held) {
			// Its own pointer down again, or a new first one, means its release
			// was never seen; another finger beside it leaves it held.
			if (event.pointerId !== this.held.pointerId && !event.isPrimary) return;
			this.letGo(null, true);
		}
		if (event.button !== 0 || this.disposed) return;
		if (on === 'picker') {
			const uv = this.uvOf(event);
			if (!uv || !this.picker.press(uv)) return;
		} else {
			// A press on the colour is a field's: it takes the focus as it is released on it unmoved.
			this.picker.forgetPress();
			this.letFocusGo(this.widget);
		}
		this.held = { pointerId: event.pointerId, on, startX: event.clientX, startY: event.clientY, slop: event.pointerType === 'touch' ? TOUCH_SLOP : DRAG_SLOP, moved: false };
		try {
			(event.currentTarget as Element).setPointerCapture(event.pointerId);
		} catch {
			// A pointer already gone cannot be captured; the press is let go as
			// stale by the next press.
		}
	}

	private moved(event: PointerEvent, on: 'well' | 'picker'): void {
		const held = this.held;
		if (!held) {
			this.hovered(event, on);
			return;
		}
		if (event.pointerId !== held.pointerId) return;
		// A mouse moving with no button down was let go where the page did not see it.
		if (event.pointerType === 'mouse' && event.buttons === 0) {
			this.letGo(null);
			return;
		}
		if (!held.moved && Math.hypot(event.clientX - held.startX, event.clientY - held.startY) > held.slop) held.moved = true;
		if (held.on === 'picker') {
			const at = this.picker.carrying ? onPage(event) : { x: event.clientX, y: event.clientY };
			this.picker.move(at.x, at.y, held.moved);
		}
	}

	private up(event: PointerEvent): void {
		if (!this.held || event.pointerId !== this.held.pointerId) return;
		this.letGo({ x: event.clientX, y: event.clientY });
	}

	private cancelled(event: PointerEvent): void {
		if (this.held && event.pointerId === this.held.pointerId) this.letGo(null);
	}

	/**
	 * Lets the held press go: released at a point of the page, or cancelled
	 * where there is none. A press that moved leaves the click after it to the
	 * drag, unless it is let go as stale, its click long gone.
	 */
	private letGo(at: { x: number; y: number } | null, stale = false): void {
		const was = this.held;
		if (!was) return;
		this.held = null;
		if (was.on === 'picker') {
			if (at) this.picker.release(at.x, at.y);
			else this.picker.cancel();
		} else {
			this.picker.forgetPress();
			const laid = at && !was.moved ? this.laidOf(this.widget) : null;
			if (at && laid && !this.state.disabled && inBox(laid.box, at.x, at.y)) this.focus(this.widget);
		}
		if (was.moved && !stale) this.dragged = true;
		for (const canvas of [this.canvas, this.picker.canvas]) {
			try {
				canvas.releasePointerCapture(was.pointerId);
			} catch {
				// The capture went with the pointer.
			}
		}
	}

	/**
	 * Hands a click to what it landed on: the picker's region under it
	 * (`click`), or the colour itself, which opens its picker or shuts it, takes
	 * the focus, and tells `click`; a disabled colour answers nothing. The
	 * click after a press that moved is the drag's.
	 */
	private clicked(event: MouseEvent, on: 'well' | 'picker'): void {
		if (this.dragged) {
			this.dragged = false;
			return;
		}
		if (this.disposed) return;
		if (on === 'picker') {
			const uv = this.uvOf(event);
			if (uv) this.picker.click(uv);
			return;
		}
		this.picker.forgetPress();
		this.letFocusGo(this.widget);
		if (this.state.disabled) return;
		if (this.picker.openColor === this.widget) this.picker.close();
		else this.picker.open(this.widget);
		this.focus(this.widget);
		this.tell(this.widget, 'click');
	}

	/** The pointer over the well or its picker, with no press held: the picker's region under it lit, and the colour drawn hovered. */
	private hovered(event: PointerEvent, on: 'well' | 'picker'): void {
		this.picker.hover(on === 'picker' ? this.uvOf(event) : null);
		this.pointedAt(true);
	}

	/** The pointer gone off one of the canvases. */
	private left(on: 'well' | 'picker'): void {
		if (this.held) return;
		if (on === 'picker') this.picker.hover(null);
		this.pointedAt(false);
	}

	/** Draws the colour hovered or not, telling `enter` and `leave` as the pointer comes onto or goes off the well or its picker. */
	private pointedAt(over: boolean): void {
		if (over === this.over) return;
		this.over = over;
		if (!this.state.disabled) {
			this.state.hovered = over;
			this.invalidate();
		}
		this.tell(this.widget, over ? 'enter' : 'leave');
	}

	/** A press anywhere off the well, its picker and the page's input shuts the picker and lets the input go, but a press on the view the armed eyedropper takes (`dropDown`). */
	private pressedElsewhere(event: PointerEvent): void {
		// A click after this press is its own: none is the eyedropper's any more.
		this.dropClick = false;
		const target = event.target as Node | null;
		if (target && (this.canvas.contains(target) || this.picker.canvas.contains(target))) return;
		const view = this.dropperOffer.view;
		if (view && target && view.element.contains(target) && this.picker.dropping()) {
			if (event.button !== 0) return;
			this.dropDown(event, view.element);
			return;
		}
		const input = pageInputMade();
		if (input && target && input.input === target) return;
		this.picker.close();
		if (input?.focused && input.focusedHost === this) input.blur();
	}

	/** The eyedropper's press on the view: held, the pointer captured, kept from the view's own listeners and from the browser's focus change, and the colour under it taken. */
	private dropDown(event: PointerEvent, element: HTMLElement): void {
		event.stopPropagation();
		event.preventDefault();
		this.dropHeld = { pointerId: event.pointerId };
		this.dropClick = true;
		try {
			element.setPointerCapture(event.pointerId);
		} catch {
			// A pointer already gone cannot be captured; its release ends the press where it lands.
		}
		this.picker.takeDropped(this.sampleAt(event), false);
	}

	/** The eyedropper's press moved: the colour under the pointer taken. */
	private dropMoved(event: PointerEvent): void {
		if (!this.dropHeld || event.pointerId !== this.dropHeld.pointerId) return;
		event.stopPropagation();
		this.picker.takeDropped(this.sampleAt(event), false);
	}

	/** The eyedropper's press let go, the colour under the pointer taken as it goes, or cancelled, taking none, and followed by no click; the eyedropper put away either way. */
	private dropEnded(event: PointerEvent, released: boolean): void {
		if (!this.dropHeld || event.pointerId !== this.dropHeld.pointerId) return;
		event.stopPropagation();
		this.dropHeld = null;
		if (!released) this.dropClick = false;
		this.picker.takeDropped(released ? this.sampleAt(event) : null, true);
	}

	/** The mouse's own press and the click that follow the eyedropper's press on the view are the eyedropper's: kept from the view, and from the browser's focus change. */
	private dropSwallow(event: Event): void {
		if (event.type === 'mousedown' ? !this.dropHeld : !this.dropClick) return;
		if (event.type === 'click') this.dropClick = false;
		event.stopPropagation();
		event.preventDefault();
	}

	/** The colour the view draws under a pointer; null off the view, or where the page offers no view. */
	private sampleAt(event: { clientX: number; clientY: number }) {
		return this.dropperOffer.view?.sample(event.clientX, event.clientY) ?? null;
	}

	/** Takes the focus away from whatever has it, unless that is the well itself. */
	private letFocusGo(except: ColourWidget | null): void {
		const input = pageInputMade();
		if (!input?.focused) return;
		if (except !== null && input.focusedHost === this && this.focusedWidget === except) return;
		input.blur();
	}

	/** Stands the open picker again as the well moves on the page: the page scrolled, or the window resized. */
	private restand(): void {
		if (this.picker.openColor) this.picker.relay();
		else this.placeInput();
	}

	/** Lets go whatever was pressed, focused or open. */
	private resetInteraction(): void {
		this.held = null;
		this.picker.forgetPress();
		this.picker.close();
		if (this.focusedWidget) {
			const input = pageInputMade();
			if (input?.focusedHost === this) input.blur();
			else this.focusedWidget = null;
		}
	}

	private listen(target: EventTarget, type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void {
		target.addEventListener(type, listener, options);
		this.listened.push({ target, type, listener, options });
	}
}
