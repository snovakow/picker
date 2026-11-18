/**
 * @fileoverview A colour well on a page: a colour widget made from its
 * options (`ColourWellOptions`), drawn on a canvas of its own, laid out and
 * painted on its own (`layoutWell`, `paintWell`), which a page places where
 * it likes. Its picker is the page's (`PagePicker`, pagePicker.ts), which the
 * well joins as it is made: the page's own unless its options name another.
 * The picker takes the pointer on the well, gives the well the page's input,
 * and opens on it, one well at a time.
 *
 * The eyedropper the picker shows for the well is the picker's, unless the
 * well sets its own (`Eyedropper`).
 */

import type { Eyedropper } from './colourPicker.ts';
import { loadFaces, paintWell } from './paint.ts';
import { MONO_FAMILY, layoutWell, restingState, type Box, type Laid, type WidgetState } from './layout.ts';
import { readColourOptions, swatchesOf, type ColourOptions, type ColourWidget, type WidgetEvent } from './options.ts';
import { PagePicker, pageMeasure, pagePicker } from './pagePicker.ts';
import { formatColour, parseColour } from './hex.ts';

/** What a well is made from: its colour widget's options, what it tells, its own eyedropper, and the picker it joins. */
export interface ColourWellOptions extends ColourOptions {
	/** Told each event the colour tells: `click` as the well is clicked, `change` as a colour is taken, `enter` and `leave` as the pointer comes onto or goes off the well or its picker, crossing from one to the other telling `leave`, then `enter`. */
	onEvent?: (event: WidgetEvent, well: ColourWell) => void;
	/** The eyedropper the picker shows for this well (`Eyedropper`), over the picker's own; the picker's where left out. */
	eyedropper?: Eyedropper;
	/** The page's picker the well joins; the page's own (`pagePicker`) where left out. */
	picker?: PagePicker;
}

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

export class ColourWell {
	readonly widget: ColourWidget;
	/** The well's canvas, which the page places where it likes. */
	readonly canvas: HTMLCanvasElement;
	/** The page's picker the well joined, which opens on it. */
	readonly picker: PagePicker;
	private readonly ctx: CanvasRenderingContext2D;
	private readonly state: WidgetState;
	private readonly onEvent: ColourWellOptions['onEvent'];
	/** The well as last laid out, in its canvas's own pixels. */
	private laid: Laid;
	/** Whether something the well is painted from changed since it was last painted. */
	private dirty = true;
	/** The frame a paint is asked for on; 0 while none is. */
	private frame = 0;
	private disposed = false;
	/** The eyedropper the well sets of its own; null for the picker's. */
	private ownEyedropper: Eyedropper | null;
	private readonly facesLoaded = () => this.invalidate();

	/**
	 * @param options - The colour widget's options (`readColourOptions`), what the well tells, its own eyedropper, and the picker it joins
	 */
	constructor(options: ColourWellOptions = {}) {
		loadFaces();
		this.widget = readColourOptions(options);
		this.onEvent = options.onEvent;
		this.ownEyedropper = options.eyedropper ?? null;
		this.state = restingState(this.widget);
		this.canvas = document.createElement('canvas');
		this.canvas.className = 'colourWell';
		this.ctx = this.canvas.getContext('2d')!;
		this.laid = layoutWell(this.widget, this.state, pageMeasure);
		this.picker = options.picker ?? pagePicker();
		// Faces that arrive after the first paint have it painted again in its
		// own; where they are already in, the first paint is already in them.
		if (typeof document.fonts?.load === 'function') {
			const faces = ['400 16px Roboto', `400 16px "${MONO_FAMILY}"`];
			if (!faces.every((face) => document.fonts.check?.(face) === true)) {
				void Promise.all(faces.map((face) => document.fonts.load(face))).then(this.facesLoaded, () => { });
			}
			document.fonts.addEventListener?.('loadingdone', this.facesLoaded);
		}
		const well = this;
		this.picker.join({
			well: this,
			widget: this.widget,
			canvas: this.canvas,
			state: this.state,
			get eyedropper() {
				return well.ownEyedropper;
			},
			laid: () => this.laidOnPage(),
			tell: (event) => this.onEvent?.(event, this),
			invalidate: () => this.invalidate(),
		});
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
		this.picker.wellChanged(this.widget, 'value');
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

	/** Enables or disables the colour; disabled, the picker on it shuts, its focus goes and a press on it is let go. */
	set disabled(disabled: boolean) {
		if (this.state.disabled === disabled) return;
		this.state.disabled = disabled;
		this.picker.wellChanged(this.widget, 'disabled');
		this.invalidate();
	}

	/** Whether the picker is open on the well. */
	get open(): boolean {
		return this.picker.openWell === this;
	}

	/** Opens the picker on the well, giving it the focus, as a click on it does (`PagePicker.open`). */
	openPicker(): void {
		this.picker.open(this);
	}

	/** Shuts the picker, where it is open on the well; the colour stays as it was last taken. */
	closePicker(): void {
		if (this.open) this.picker.close();
	}

	/** The eyedropper the well sets of its own; null where it shows the picker's. */
	get eyedropper(): Eyedropper | null {
		return this.ownEyedropper;
	}

	/** Sets the well's own eyedropper, over the picker's, or null for the picker's: an open picker reads it afresh, one armed on a view it no longer picks from put away. */
	setEyedropper(eyedropper: Eyedropper | null): void {
		this.ownEyedropper = eyedropper;
		this.picker.wellChanged(this.widget, 'eyedropper');
	}

	/** Lets the well go: the picker shut where it is open on it, its focus let go, its canvas and listeners taken away. */
	dispose(): void {
		if (this.disposed) return;
		this.picker.leave(this.widget);
		this.disposed = true;
		cancelAnimationFrame(this.frame);
		document.fonts?.removeEventListener?.('loadingdone', this.facesLoaded);
		this.canvas.remove();
	}

	// ---------------------------------------------------------------------
	// Painting
	// ---------------------------------------------------------------------

	/**
	 * Lays the well out and paints it where something changed since it was
	 * last painted, its canvas sized to its box at the page's resolution, then
	 * has the picker open on it laid out again and painted, and the page's
	 * input placed over what holds it. Called on the frame after a change; a
	 * test calls it to paint at once.
	 */
	update(): void {
		if (this.disposed) return;
		cancelAnimationFrame(this.frame);
		this.frame = 0;
		const relaid = this.dirty;
		if (relaid) {
			this.dirty = false;
			this.laid = layoutWell(this.widget, this.state, pageMeasure);
			const resolution = window.devicePixelRatio || 1;
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
		}
		this.picker.wellUpdated(this.widget, relaid);
	}

	/** Has the well painted again on the next frame. */
	invalidate(): void {
		this.dirty = true;
		if (this.disposed || this.frame) return;
		this.frame = requestAnimationFrame(() => this.update());
	}

	/** The well laid out in the page's pixels, where its canvas stands in the window; null where it is not on the page. */
	private laidOnPage(): Laid | null {
		if (this.disposed || !this.canvas.isConnected) return null;
		const rect = this.canvas.getBoundingClientRect();
		return shifted(this.laid, rect.left, rect.top);
	}
}
