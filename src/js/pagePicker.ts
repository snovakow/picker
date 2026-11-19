/**
 * @fileoverview The picker on a page (`PagePicker`): one colour picker
 * serving the colour wells that join it (colourWell.ts), focused on one well
 * at a time, and standing either in the page, against its well's face, or in
 * a window of its own. It is the picker's host (`PickerHost`) for every well
 * it serves: its pixels are the page's, measured from the window's top-left
 * corner, and it is as large as the window.
 *
 * One well has the focus at a time. A press released unmoved on a well gives
 * it the page's input, taken from another of the picker's wells without
 * letting it go; a click on a well opens the picker on it, or shuts it where
 * it is open on that well, and moves a picker open on another well to this
 * one. The picker stays open on its well as the focus goes elsewhere, a
 * field that held the input letting it go, and a press on the picker gives
 * its well the focus back. It shuts only as its well is clicked again, as
 * its close, Escape while it has the focus or a script shuts it, as the
 * viewer shuts its window, and as its well is disabled, leaves the page or
 * is hidden there, which it looks for on every frame while it is open; its
 * well scrolled out of the window leaves it open. A page has one picker
 * (`pagePicker`) unless it makes more; one opening shuts every other.
 *
 * It takes the pointer on its wells and on itself: a primary press is held
 * from the moment it goes down, the pointer captured, and is a drag once it
 * has gone further on the screen than a drag's start, a touch's as far as a
 * touch's hold (`TOUCH_SLOP`), anything else's `DRAG_SLOP`; the click after
 * a press that moved is the drag's, and is swallowed. A press is let go as
 * cancelled where the browser cancels the pointer or takes the capture back,
 * where a mouse moves with no button down, where a window loses the focus,
 * and where its own pointer or a new first pointer goes down again. A press
 * carrying the picker in the page reads the pointer held inside the window,
 * so the point carried stays in view. A press anywhere else on the page lets
 * the input go, the input's own element aside, and leaves the picker open,
 * but while the app's own pick is armed (`CustomPick`), whose presses are
 * the app's wherever they land: the page's input keeps its focus.
 *
 * Where it stands is its docking (`Docking`). In the page, it stands by
 * `screenPopoverRect`: against the face of the well it is open on, on the
 * side its layout opens it, or the other where only that side holds it
 * inside the window, kept inside the window, and on the side it stood on as
 * the viewer began to carry it; it is stood again as the page scrolls, as
 * the window is resized and as its well moves on the page. In a window of
 * its own, the window opens beside the well as the picker opens, sized to
 * the picker, and shuts as the picker does, where it was left kept for the
 * next; the picker is carried nowhere in it, the viewer moving the window.
 * In `auto` it stands in the page with a button to pop it out
 * (`DockButton`), and in its window with one to dock it back, the viewer's
 * choice kept for the next opening. Where the browser refuses the window, as
 * it refuses one no click asked for, the picker stands in the page.
 *
 * The page's input stands over the well that has the focus, out of sight,
 * and over the picker's field that holds it, shown. In the picker's window a
 * field is typed through an input of the window's own, the well keeping the
 * page's, and a key pressed in the window while no field holds that input
 * works the picker as a key in the page's input does, its well taking the
 * focus back where it went elsewhere.
 *
 * The eyedropper is the picker's (`Eyedropper`), the browser's own unless it
 * sets another, where the well it is open on sets none of its own. While it
 * is armed on a view, the view's cursor is a crosshair, and a press on the
 * view is the eyedropper's, taken ahead of the view's own listeners: the
 * colour under the pointer is taken as the press goes down and as it moves,
 * the eyedropper put away as it is let go, and the click after it swallowed;
 * the page's input keeps its focus through it, and the picker stays open.
 *
 * Its wheel is drawn by the renderer it is set to (`Renderer`), WebGL unless
 * it is set to WebGPU, and by the other where that one cannot be had
 * (renderer.ts).
 */

import { ColourPicker, type DropperView, type Eyedropper, type PickerHost, type Uv } from './colourPicker.ts';
import { PageInput, pageInput, pageInputMade, type InputHost } from './input.ts';
import { PALETTE, fontString, loadFaces } from './paint.ts';
import { inBox, type Box, type Font, type Laid, type TextMeasure, type WidgetState } from './layout.ts';
import { cssColour, type ColourWidget, type WidgetEvent } from './options.ts';
import { DRAG_SLOP, TOUCH_SLOP, screenPopoverRect } from './pointer.ts';
import { RENDERERS, rendererOf, type Renderer } from './renderer.ts';
import type { DockButton } from './pickerView.ts';
import type { ColourWell } from './colourWell.ts';

/** Where a page's picker stands, as `Docking` names it. */
export const DOCKINGS = ['auto', 'in-view', 'popout'] as const;

/**
 * Where a page's picker stands:
 *
 * - `auto` — in the page, with a button to pop it out into a window of its
 *   own, and in that window with one to dock it back
 * - `in-view` — in the page alone
 * - `popout` — in a window of its own alone
 */
export type Docking = (typeof DOCKINGS)[number];

/** What a page's picker is made from. */
export interface PagePickerOptions {
	/** The eyedropper the picker shows for a well that sets none of its own (`Eyedropper`); the browser's own where left out. */
	eyedropper?: Eyedropper;
	/** Where the picker stands (`Docking`); `auto` where left out. */
	docking?: Docking;
	/** What the picker's wheel is drawn by (`Renderer`); WebGL where left out. */
	renderer?: Renderer;
}

/** What a well gives the page's picker it joins: itself, its colour widget and canvas, and what the picker reads of it and tells it. */
export interface PickedWell {
	/** The well, as a script holds it. */
	readonly well: ColourWell;
	readonly widget: ColourWidget;
	/** The well's canvas, which the picker takes the pointer on. */
	readonly canvas: HTMLCanvasElement;
	/** What the well's colour is in now: its text is its colour. */
	readonly state: WidgetState;
	/** The eyedropper the well sets of its own; null for the picker's. */
	readonly eyedropper: Eyedropper | null;
	/** The well laid out, in the page's pixels; null where it is not on the page or is hidden there. */
	laid(): Laid | null;
	/** Tells the well's page an event of its colour. */
	tell(event: WidgetEvent): void;
	/** Paints the well again, on the next frame. */
	invalidate(): void;
}

/** The eyedropper a picker shows where nothing sets another: the browser's own, where the browser has one. */
const SCREEN: Eyedropper = { mode: 'screen' };

/** A press held on a well or on the picker: which pointer holds it, what it is on, where on the screen it went down, how far it may go before it is a drag, and whether it has. */
interface Held {
	pointerId: number;
	/** The well a press on a well is on; null for a press on the picker. */
	widget: ColourWidget | null;
	startX: number;
	startY: number;
	slop: number;
	moved: boolean;
}

/** A listener put up, to be taken down. */
interface Listened {
	target: EventTarget;
	type: string;
	listener: EventListener;
	options?: boolean | AddEventListenerOptions;
}

/** The picker's own window while it stands there: the window, the input its fields are typed through there, what is listened to on it, and the size the picker last asked of it. */
interface Popout {
	readonly window: Window;
	readonly input: PageInput;
	readonly listened: Listened[];
	fitted: { w: number; h: number };
}

/** How long after the picker's window opens its size is checked against the picker's, for a browser that opened it at a size of its own. */
const SETTLE_MS = 100;

/** Every page picker not yet let go, so one opening shuts the others. */
const pickers = new Set<PagePicker>();

/** The page's own picker, made as it is first needed. */
let shared: PagePicker | null = null;

/** How many pickers have been made, which names each one's window. */
let made = 0;

/** The page's own picker, which a well joins where its options name no other; made as it is first needed, and again after it is let go. */
export const pagePicker = (): PagePicker => {
	if (!shared || !pickers.has(shared)) shared = new PagePicker();
	return shared;
};

/** The context words are measured in, made as it is first needed. */
let measurer: CanvasRenderingContext2D | null = null;

/** How wide a run of words is in a font, as the browser sets it on a page's canvas. */
export const pageMeasure: TextMeasure = (text: string, font: Font): number => {
	measurer ??= document.createElement('canvas').getContext('2d')!;
	measurer.font = fontString(font);
	return measurer.measureText(text).width;
};

/** A point of the page held inside the window, where a carried picker's point is kept. */
const onPage = (event: { clientX: number; clientY: number }): { x: number; y: number } => ({
	x: Math.min(Math.max(event.clientX, 0), Math.max(0, window.innerWidth)),
	y: Math.min(Math.max(event.clientY, 0), Math.max(0, window.innerHeight)),
});

/** Whether a value read as a page's script may give it is a view the eyedropper picks from: an element, and the colour drawn at a point. */
const isView = (view: unknown): view is DropperView =>
	typeof view === 'object' && view !== null && (view as DropperView).element instanceof Element && typeof (view as DropperView).sample === 'function';

export class PagePicker implements PickerHost, InputHost {
	private readonly picker: ColourPicker;
	private readonly wells = new Map<ColourWidget, PickedWell>();
	/** What is listened to on each well's canvas, to be taken down as the well leaves. */
	private readonly wellListened = new Map<ColourWidget, Listened[]>();
	/** The widget the page's input is typed into: one of the wells', while it holds it. */
	private focusedWidget: ColourWidget | null = null;
	/** Where the picker stands, in the pixels its points are read in, and in the page the side of the well it stands on, with how far standing there rather than on the side its layout gives moved it; null while it stands nowhere. */
	private screen: { box: Box; side: { side: 'above' | 'below'; turn: number } | null } | null = null;
	private held: Held | null = null;
	/** Whether the last press held moved past a drag's start, so the click after it is the drag's; cleared as the next press goes down. */
	private dragged = false;
	/** The well the pointer is over, or over the picker open on it, as last told; null for none. */
	private hoveredWell: PickedWell | null = null;
	/** The eyedropper the picker shows for a well that sets none. */
	private eyedropperSet: Eyedropper;
	/** The press on the view the eyedropper holds, by its pointer; null while none is held. */
	private dropHeld: { pointerId: number } | null = null;
	/** Whether the click after the eyedropper's press on the view is yet to come, to be swallowed. */
	private dropClick = false;
	/** The view whose cursor is the eyedropper's crosshair; null while none is. */
	private crosshairOn: HTMLElement | null = null;
	private dockingSet: Docking;
	private rendererSet: Renderer;
	/** In `auto`, whether the viewer last popped the picker out, which the next opening keeps. */
	private wantsOut = false;
	/** Whether the browser refused the picker its window in `popout`, which stands it in the page until it shuts. */
	private refused = false;
	/** The picker's window while it stands in one; null while it stands in the page or nowhere. */
	private popout: Popout | null = null;
	/** Where the viewer left the picker's window on the screen, for the next to open at; null until one shut. */
	private windowAt: { x: number; y: number } | null = null;
	/** Whether the picker's window is to shut as the step ends, unless the picker opens in it again first. */
	private shutting = false;
	/** The frame the open picker's well is next looked at on (`lookAtWell`); 0 while none is asked for. */
	private watchFrame = 0;
	/** Where the open picker's well stood on the page as the picker was last stood against it; null while it is shut. */
	private watchedAt: Box | null = null;
	/** The name the picker's window is opened under, its own. */
	private readonly windowName: string;
	private disposed = false;
	private readonly listened: Listened[] = [];

	/**
	 * @param options - The eyedropper the picker shows, where it stands, and what its wheel is drawn by
	 */
	constructor(options: PagePickerOptions = {}) {
		loadFaces();
		this.eyedropperSet = options.eyedropper ?? SCREEN;
		this.dockingSet = DOCKINGS.includes(options.docking as Docking) ? options.docking! : 'auto';
		this.rendererSet = rendererOf(options.renderer);
		this.windowName = `colourPicker${++made}`;
		this.picker = new ColourPicker(this);
		const popover = this.picker.canvas;
		popover.className = 'colourWellPicker';
		// Over the page, under the page's input, which stands over the picker's fields.
		Object.assign(popover.style, { position: 'fixed', left: '0px', top: '0px', zIndex: '0', display: 'none' });
		this.listenOn(popover, null, this.listened);
		document.body.appendChild(popover);
		// A press anywhere else on the page lets the focus go, ahead of what it lands on, but a press on the view the eyedropper takes.
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
		// The page going takes the picker's window with it.
		this.listen(window, 'pagehide', () => this.shutWindow());
		pickers.add(this);
	}

	// ---------------------------------------------------------------------
	// What a script reads and does
	// ---------------------------------------------------------------------

	/** The well that has the focus; null for none, as while the focus is elsewhere, which leaves the picker open on its well (`openWell`). */
	get well(): ColourWell | null {
		return this.focusedWidget ? this.wells.get(this.focusedWidget)?.well ?? null : null;
	}

	/** The well the picker is open on; null while it is shut. */
	get openWell(): ColourWell | null {
		const widget = this.picker.openColor;
		return widget ? this.wells.get(widget)?.well ?? null : null;
	}

	/**
	 * Opens the picker on a well, giving the well the focus, as a click on it
	 * does; a picker open on another well moves to this one, and one open on
	 * this well stays as it is. Nothing for a well of another picker, one
	 * disabled, or one not on the page. Where the picker stands in a window of
	 * its own, the browser may refuse the window to a script no click called,
	 * and the picker stands in the page.
	 */
	open(well: ColourWell): void {
		const picked = this.pickedOf(well);
		if (!picked || picked.state.disabled || this.disposed || !picked.laid()) return;
		this.focus(picked.widget);
		if (this.picker.openColor !== picked.widget) this.picker.open(picked.widget);
	}

	/** Shuts the picker, where it is open; the well keeps the focus, and its colour as it was last taken. */
	close(): void {
		this.picker.close();
	}

	/** The eyedropper the picker shows for a well that sets none of its own. */
	get eyedropper(): Eyedropper {
		return this.eyedropperSet;
	}

	/** Changes the eyedropper the picker shows for a well that sets none of its own: an open picker reads it afresh, one armed on a view it no longer picks from put away. */
	setEyedropper(eyedropper: Eyedropper): void {
		this.eyedropperSet = eyedropper;
		this.eyedropperChanged();
	}

	/** Where the picker stands. */
	get docking(): Docking {
		return this.dockingSet;
	}

	/** Changes where the picker stands: an open picker is stood again there, `auto` standing it in the page. */
	setDocking(docking: Docking): void {
		if (!DOCKINGS.includes(docking) || docking === this.dockingSet) return;
		this.dockingSet = docking;
		this.wantsOut = false;
		this.refused = false;
		this.restandOpen();
	}

	/** What the picker's wheel is drawn by. */
	get renderer(): Renderer {
		return this.rendererSet;
	}

	/** Changes what the picker's wheel is drawn by: an open picker is painted again by it. */
	setRenderer(renderer: Renderer): void {
		if (!RENDERERS.includes(renderer) || renderer === this.rendererSet) return;
		this.rendererSet = renderer;
		this.picker.relay();
	}

	/** Whether the picker stands in a window of its own. */
	get poppedOut(): boolean {
		return this.popout !== null;
	}

	/** In `auto`, pops the picker out into a window of its own, as its button does, and keeps it there for the next opening; nothing in the other dockings. */
	popOut(): void {
		if (this.dockingSet !== 'auto' || this.wantsOut) return;
		this.wantsOut = true;
		this.restandOpen();
	}

	/** In `auto`, docks the picker back into the page, as its button does, and keeps it there for the next opening; nothing in the other dockings. */
	dock(): void {
		if (this.dockingSet !== 'auto' || !this.wantsOut) return;
		this.wantsOut = false;
		this.restandOpen();
	}

	/** Lets the picker go: its wells let go of it, which leaves them unable to open a picker, its window shut, and its canvas and listeners taken away. */
	dispose(): void {
		if (this.disposed) return;
		for (const widget of [...this.wells.keys()]) this.leave(widget);
		this.picker.close();
		this.shutWindow();
		this.unwatchWell();
		this.disposed = true;
		this.showCrosshair();
		for (const each of this.listened.splice(0)) each.target.removeEventListener(each.type, each.listener, each.options);
		this.picker.canvas.remove();
		pickers.delete(this);
		if (shared === this) shared = null;
	}

	// ---------------------------------------------------------------------
	// Its wells
	// ---------------------------------------------------------------------

	/** Takes a well in: the picker takes the pointer on its canvas, and opens on it. */
	join(picked: PickedWell): void {
		if (this.disposed || this.wells.has(picked.widget)) return;
		this.wells.set(picked.widget, picked);
		const listened: Listened[] = [];
		this.listenOn(picked.canvas, picked.widget, listened);
		this.wellListened.set(picked.widget, listened);
	}

	/** Lets a well go: the picker shut where it is open on it, its focus let go, a press on it dropped, and its canvas no longer listened to. */
	leave(widget: ColourWidget): void {
		const picked = this.wells.get(widget);
		if (!picked) return;
		if (this.held?.widget === widget) this.held = null;
		if (this.picker.openColor === widget) {
			this.picker.forgetPress();
			this.picker.close();
		}
		if (this.focusedWidget === widget) {
			const input = pageInputMade();
			if (input?.focusedHost === this) input.blur();
			this.focusedWidget = null;
		}
		if (this.hoveredWell === picked) this.hoveredWell = null;
		for (const each of this.wellListened.get(widget) ?? []) each.target.removeEventListener(each.type, each.listener, each.options);
		this.wellListened.delete(widget);
		this.wells.delete(widget);
	}

	/**
	 * Hears that something of a well changed: its value written by a script,
	 * which an open picker reads afresh; it disabled, which shuts the picker on
	 * it, lets its focus go and drops a press on it; or its own eyedropper,
	 * which an open picker reads afresh.
	 */
	wellChanged(widget: ColourWidget, what: 'value' | 'disabled' | 'eyedropper'): void {
		const picked = this.wells.get(widget);
		if (!picked) return;
		const open = this.picker.openColor === widget;
		switch (what) {
			case 'value':
				if (open) this.picker.sync();
				break;
			case 'disabled':
				if (!picked.state.disabled) break;
				if (this.focusedWidget === widget) pageInputMade()?.blur();
				if (open) this.picker.close();
				if (this.held?.widget === widget) this.letGo(null);
				break;
			case 'eyedropper':
				if (open) this.eyedropperChanged();
				break;
		}
	}

	/** Hears that a well was laid out and painted: the picker open on it is laid out again and painted (`relay`), and the page's input placed over what holds it. */
	wellUpdated(widget: ColourWidget, relaid: boolean): void {
		if (relaid && this.picker.openColor === widget) this.picker.relay();
		this.placeInput();
	}

	/** The well a script holds, as it joined the picker; undefined for another picker's. */
	private pickedOf(well: ColourWell): PickedWell | undefined {
		for (const picked of this.wells.values()) {
			if (picked.well === well) return picked;
		}
		return undefined;
	}

	// ---------------------------------------------------------------------
	// The picker's host
	// ---------------------------------------------------------------------

	laidOf(widget: ColourWidget): Laid | null {
		return this.disposed ? null : this.wells.get(widget)?.laid() ?? null;
	}

	stateOf(widget: ColourWidget): WidgetState {
		return this.wells.get(widget)!.state;
	}

	/** The well whose colour changed paints again: the one the picker is open on, else the one that has the focus. */
	invalidate(): void {
		const widget = this.picker.openColor ?? this.focusedWidget;
		if (widget) this.wells.get(widget)?.invalidate();
	}

	tell(widget: ColourWidget, event: WidgetEvent): void {
		this.wells.get(widget)?.tell(event);
	}

	get width(): number {
		return window.innerWidth;
	}

	get height(): number {
		return window.innerHeight;
	}

	/** How many of the canvas's pixels make one of the page's, in the window the picker stands in. */
	get resolution(): number {
		return (this.popout ? this.popout.window.devicePixelRatio : window.devicePixelRatio) || 1;
	}

	get measure(): TextMeasure {
		return pageMeasure;
	}

	/** Stands the picker in its window or in the page, as its docking says, or hides it. */
	placePopover(box: Box | null): void {
		const stand = this.picker.stand;
		const widget = this.picker.openColor;
		const laid = widget ? this.laidOf(widget) : null;
		if (!box || !stand || !laid) {
			this.screen = null;
			this.unwatchWell();
			this.hidePicker();
			this.showCrosshair();
			return;
		}
		if (!(this.standsOut && this.standOut(box, laid))) this.standInPage(box, stand, laid);
		this.watchedAt = { ...laid.box };
		this.watchWell();
		this.placeInput();
	}

	standing(box: Box): { box: Box; side: { side: 'above' | 'below'; turn: number } | null } {
		return this.screen ? { box: this.screen.box, side: this.screen.side } : { box, side: null };
	}

	/** The picker painted again, which may have handed the input to one of its fields or back: the input is placed over what holds it now. The picker's canvas is on the page or in its window itself, so what it holds is shown as it is painted. */
	popoverPainted(_resized: boolean): void {
		this.placeInput();
		this.showCrosshair();
	}

	get focused(): ColourWidget | null {
		return this.focusedWidget;
	}

	/**
	 * Gives a well's colour the page's input: drawn focused, and worked by key
	 * through the input, out of sight. Another host's focus is let go first;
	 * another of the picker's wells hands it over, a field of the picker
	 * holding it giving it back to the colour first. Where a field of the
	 * picker on this well holds the input, it goes back to the colour's body.
	 */
	focus(widget: ColourWidget): void {
		const input = pageInput();
		if (this.focusedWidget !== widget) {
			if (input.focused && input.focusedHost !== this) input.blur();
			const was = this.focusedWidget;
			if (was && this.picker.inField(was)) this.picker.returnToBody();
			if (was) {
				const before = this.wells.get(was);
				if (before) {
					before.state.focused = false;
					before.invalidate();
				}
			}
			this.focusedWidget = widget;
			const picked = this.wells.get(widget);
			if (picked) {
				picked.state.focused = true;
				picked.invalidate();
			}
		} else if (this.picker.inField(widget)) {
			this.picker.returnToBody();
			return;
		}
		input.focus('colour', this.stateOf(widget).text, this);
		this.placeInput();
	}

	/** A page holds no order of fields for a well: Tab past the picker's last field lets the input go. */
	focusAfter(_widget: ColourWidget): boolean {
		return false;
	}

	get inputHost(): InputHost {
		return this;
	}

	/** In the picker's window, the window's own input, which its fields are typed through; the page's otherwise. */
	get fieldInput(): PageInput | null {
		return this.popout?.input ?? null;
	}

	/** Shuts every other page picker. */
	closeOther(): void {
		for (const other of pickers) {
			if (other !== this) other.close();
		}
	}

	/** The eyedropper for a well: its own, else the picker's. */
	dropperOf(widget: ColourWidget): Eyedropper {
		return this.wells.get(widget)?.eyedropper ?? this.eyedropperSet;
	}

	/** In `auto`, the button that pops the picker out, or, in its window, docks it back; none in the other dockings. */
	get dockButton(): DockButton | null {
		if (this.dockingSet !== 'auto') return null;
		return this.standsOut ? 'dock' : 'popout';
	}

	/** The dock button clicked: the picker popped out, or docked back. */
	dockClicked(): void {
		if (this.wantsOut) this.dock();
		else this.popOut();
	}

	// ---------------------------------------------------------------------
	// Where it stands
	// ---------------------------------------------------------------------

	/** Whether the picker is to stand in a window of its own: always in `popout` unless the browser refused it the window, and in `auto` once the viewer popped it out. */
	private get standsOut(): boolean {
		return this.dockingSet === 'popout' ? !this.refused : this.dockingSet === 'auto' && this.wantsOut;
	}

	/** Stands the open picker again where its docking now says, a field holding the input giving it back to the colour first: it is laid out again, with its dock button, and placed. */
	private restandOpen(): void {
		const widget = this.focusedWidget;
		if (widget && this.picker.inField(widget)) this.picker.returnToBody();
		if (this.picker.openColor) this.picker.relay();
		else this.shutWindow();
	}

	/** Stands the picker in the page by `screenPopoverRect`, against its well's face, its window shut where it stood in one. */
	private standInPage(box: Box, stand: NonNullable<ColourPicker['stand']>, laid: Laid): void {
		this.shutWindow();
		const popover = this.picker.canvas;
		if (popover.parentNode !== document.body) document.body.appendChild(popover);
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
		Object.assign(popover.style, { position: 'fixed', left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px`, height: `${at.height}px`, display: 'block' });
	}

	/**
	 * Stands the picker in its window, at the window's corner, the window
	 * opened where none is and sized to the picker. Where the browser refuses
	 * the window, the picker is laid out again to stand in the page, in `auto`
	 * as though the viewer had docked it.
	 *
	 * @returns Whether the picker was placed, in its window or, refused, in the page
	 */
	private standOut(box: Box, laid: Laid): boolean {
		this.shutting = false;
		const popout = this.popout ?? this.openWindow(box, laid);
		if (!popout) {
			if (this.dockingSet === 'auto') this.wantsOut = false;
			else this.refused = true;
			this.picker.relay();
			return true;
		}
		const popover = this.picker.canvas;
		const body = popout.window.document.body;
		if (popover.parentNode !== body) body.appendChild(popover);
		this.screen = { box: { x: 0, y: 0, w: box.w, h: box.h }, side: null };
		Object.assign(popover.style, { position: 'absolute', left: '0px', top: '0px', width: `${box.w}px`, height: `${box.h}px`, display: 'block' });
		this.fitWindow(popout, box);
		return true;
	}

	/** Opens the picker's window beside its well, or where the viewer left the last, sized to the picker, its document made bare for it with the picker's faces and an input of its own; null where the browser refuses it. */
	private openWindow(box: Box, laid: Laid): Popout | null {
		const chrome = Math.max(0, window.outerHeight - window.innerHeight);
		const at = this.windowAt ?? { x: Math.round(window.screenX + laid.face.x), y: Math.round(window.screenY + chrome + laid.face.y + laid.face.h) };
		let opened: Window | null = null;
		try {
			opened = window.open('', this.windowName, `popup,width=${Math.ceil(box.w)},height=${Math.ceil(box.h)},left=${at.x},top=${at.y}`);
		} catch {
			opened = null;
		}
		if (!opened) return null;
		const doc = opened.document;
		doc.title = 'Color Picker';
		const body = doc.body ?? doc.documentElement.appendChild(doc.createElement('body'));
		body.replaceChildren();
		Object.assign(body.style, { margin: '0', overflow: 'hidden', position: 'relative', background: laid.style.background ? cssColour(laid.style.background) : PALETTE.field });
		loadFaces(doc);
		const popout: Popout = { window: opened, input: new PageInput(body), listened: [], fitted: { w: Math.ceil(box.w), h: Math.ceil(box.h) } };
		// A key in the window while no field holds its input works the picker, as one in the page's input does.
		this.listen(opened, 'keydown', (event) => this.windowKey(event as KeyboardEvent), undefined, popout.listened);
		this.listen(opened, 'blur', () => this.letGo(null), undefined, popout.listened);
		this.listen(opened, 'pagehide', () => this.windowGone(popout), undefined, popout.listened);
		this.popout = popout;
		// The window's size reads true only once the browser has made it.
		setTimeout(() => this.settleWindow(popout), SETTLE_MS);
		return popout;
	}

	/**
	 * Sizes the picker's window to the picker as the picker's size changes, by
	 * the change, the window's own size read nowhere: a window just opened
	 * reads no true size yet, and one the viewer resized keeps what they gave
	 * it beyond the picker.
	 */
	private fitWindow(popout: Popout, box: Box): void {
		const w = Math.ceil(box.w);
		const h = Math.ceil(box.h);
		const { fitted } = popout;
		if (w === fitted.w && h === fitted.h) return;
		popout.fitted = { w, h };
		this.resizeWindow(popout, w - fitted.w, h - fitted.h);
	}

	/** Sizes the picker's window to the picker once it is made, where the browser opened it at a size of its own rather than the one asked for. */
	private settleWindow(popout: Popout): void {
		if (this.popout !== popout || popout.window.closed) return;
		const { innerWidth, innerHeight } = popout.window;
		if (!innerWidth || !innerHeight) return;
		this.resizeWindow(popout, popout.fitted.w - innerWidth, popout.fitted.h - innerHeight);
	}

	/** Resizes the picker's window by a change of its size. */
	private resizeWindow(popout: Popout, across: number, down: number): void {
		if (!across && !down) return;
		try {
			popout.window.resizeBy(across, down);
		} catch {
			// A browser that refuses the resize leaves the window as the viewer has it.
		}
	}

	/** Hides the shut picker: in the page at once; in its window as the step ends, unless the picker opens in it again first, as it does moving to another well. */
	private hidePicker(): void {
		this.refused = false;
		if (!this.popout) {
			this.picker.canvas.style.display = 'none';
			return;
		}
		if (this.shutting) return;
		this.shutting = true;
		queueMicrotask(() => {
			if (!this.shutting) return;
			this.shutting = false;
			if (!this.picker.openColor) this.shutWindow();
		});
	}

	/** Shuts the picker's window, where it stands in one: a field holding the window's input gives it back to the colour first, where the window stood is kept for the next, and the picker's canvas comes back to the page, hidden. */
	private shutWindow(): void {
		const popout = this.popout;
		if (!popout) return;
		const widget = this.focusedWidget;
		if (widget && this.picker.inField(widget)) this.picker.returnToBody();
		this.popout = null;
		this.shutting = false;
		try {
			this.windowAt = { x: popout.window.screenX, y: popout.window.screenY };
		} catch {
			// A window gone keeps where the last stood.
		}
		for (const each of popout.listened) each.target.removeEventListener(each.type, each.listener, each.options);
		popout.input.dispose();
		const popover = this.picker.canvas;
		popover.style.display = 'none';
		document.body.appendChild(popover);
		try {
			if (!popout.window.closed) popout.window.close();
		} catch {
			// Shut already.
		}
	}

	/** The viewer shut the picker's window, or it went: the picker shuts with it, its well keeping the focus. */
	private windowGone(popout: Popout): void {
		if (this.popout !== popout) return;
		this.picker.close();
		this.shutWindow();
	}

	/** A key pressed in the picker's window while no field holds its input, which keeps its own keys: worked as one in the page's input, the window's keys being its picker's, the well the picker is open on taking the focus back where it went elsewhere. */
	private windowKey(event: KeyboardEvent): void {
		const open = this.picker.openColor;
		if (event.defaultPrevented || !open || event.isComposing) return;
		if (this.focusedWidget !== open) this.focus(open);
		if (this.onKey(event)) event.preventDefault();
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
	 * A key pressed in the page's input, or in the picker's window: one of the
	 * picker's fields holding the input takes its keys; Tab on an open picker
	 * enters its hex field, and Shift+Tab, or Tab on a shut picker, lets the
	 * input go; the rest work the picker (`key`).
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
	 * The focus gone from an input the picker gave it to. While the input is
	 * handed between the picker's body and one of its fields, the blur is the
	 * hand-off's, and leaves both. The window's own input going while the well
	 * keeps the page's gives a field's input back to the colour. Otherwise the
	 * well has lost the focus: its colour is drawn resting, and the picker
	 * stays open on it, a field that held an input letting it go.
	 */
	onBlur(): void {
		if (this.picker.handing) return;
		const widget = this.focusedWidget;
		if (!widget) return;
		if (pageInputMade()?.focusedHost === this) {
			if (this.picker.inField(widget)) this.picker.returnToBody();
			return;
		}
		this.focusedWidget = null;
		const picked = this.wells.get(widget);
		if (picked) {
			picked.state.focused = false;
			picked.invalidate();
		}
		if (this.picker.inField(widget)) this.picker.dropField();
	}

	/** Puts a picker field's shown input away, back to the colour's body, keeping the focus, where an embedder takes the page out of sight, as it does for VR; whether it did. */
	putAway(): boolean {
		if (!this.focusedWidget || !this.picker.inField(this.focusedWidget)) return false;
		this.picker.returnToBody();
		return true;
	}

	/**
	 * Places the inputs over what holds them, where this picker holds the
	 * page's: a field of the picker's own window holds the window's input,
	 * placed over the field there; a field of the picker in the page holds the
	 * page's, shown in the field's look while the picker stands on the page;
	 * the colour itself holds the page's, out of sight over its face. Lets the
	 * focus go where the well is not laid out.
	 */
	private placeInput(): void {
		const input = pageInputMade();
		if (!input?.focused || input.focusedHost !== this) return;
		const widget = this.focusedWidget;
		const laid = widget ? this.laidOf(widget) : null;
		if (!widget || !laid) {
			input.blur();
			return;
		}
		const holder = input.holder.getBoundingClientRect();
		const field = this.picker.placement(widget, laid.style.opacity);
		if (field && !this.popout) {
			if (!this.screen) {
				input.place(null);
				return;
			}
			const { box, field: at, look } = field;
			input.place({ left: box.x + at.x - holder.left, top: box.y + at.y - holder.top, width: at.w, height: at.h }, { ...look, scale: 1 });
			return;
		}
		if (field && this.popout) {
			const { box, field: at, look } = field;
			this.popout.input.place({ left: box.x + at.x, top: box.y + at.y, width: at.w, height: at.h }, { ...look, scale: 1 });
		}
		const face = laid.face;
		input.place({ left: face.x - holder.left, top: face.y - holder.top, width: face.w, height: face.h });
	}

	// ---------------------------------------------------------------------
	// The pointer
	// ---------------------------------------------------------------------

	/** Puts up the pointer's listeners on a canvas: a well's, by its widget, or the picker's own, for null. */
	private listenOn(canvas: HTMLCanvasElement, widget: ColourWidget | null, into: Listened[]): void {
		Object.assign(canvas.style, { touchAction: 'none', userSelect: 'none' });
		this.listen(canvas, 'pointerdown', (event) => this.down(event as PointerEvent, widget), undefined, into);
		this.listen(canvas, 'pointermove', (event) => this.moved(event as PointerEvent, widget), undefined, into);
		this.listen(canvas, 'pointerup', (event) => this.up(event as PointerEvent), undefined, into);
		this.listen(canvas, 'pointercancel', (event) => this.cancelled(event as PointerEvent), undefined, into);
		this.listen(canvas, 'lostpointercapture', (event) => this.cancelled(event as PointerEvent), undefined, into);
		this.listen(canvas, 'pointerleave', () => this.left(widget), undefined, into);
		this.listen(canvas, 'click', (event) => this.clicked(event as MouseEvent, widget), undefined, into);
		// The browser's own drag and its focus change on a press stay off a press the picker holds.
		this.listen(canvas, 'mousedown', (event) => event.preventDefault(), undefined, into);
	}

	/** A point of the picker's plane under a point of the page or its window, from its left and up from its foot. */
	private uvOf(event: { clientX: number; clientY: number }): Uv | null {
		const box = this.screen?.box;
		if (!box || box.w <= 0 || box.h <= 0) return null;
		return { x: (event.clientX - box.x) / box.w, y: 1 - (event.clientY - box.y) / box.h };
	}

	/** A press going down on a well (by its widget) or on the picker (null). */
	private down(event: PointerEvent, widget: ColourWidget | null): void {
		this.dragged = false;
		if (this.held) {
			// Its own pointer down again, or a new first one, means its release
			// was never seen; another finger beside it leaves it held.
			if (event.pointerId !== this.held.pointerId && !event.isPrimary) return;
			this.letGo(null, true);
		}
		if (event.button !== 0 || this.disposed) return;
		if (widget === null) {
			const uv = this.uvOf(event);
			if (!uv || !this.picker.press(uv)) return;
			// The focus gone elsewhere comes back to the picker's well, so the picker's keys, Escape among them, are its own again.
			const open = this.picker.openColor;
			if (open && this.focusedWidget !== open) this.focus(open);
		} else {
			// A press on a well is a field's: it takes the focus as it is released on it unmoved.
			this.picker.forgetPress();
			this.letOthersFocusGo();
		}
		this.held = { pointerId: event.pointerId, widget, startX: event.clientX, startY: event.clientY, slop: event.pointerType === 'touch' ? TOUCH_SLOP : DRAG_SLOP, moved: false };
		try {
			(event.currentTarget as Element).setPointerCapture(event.pointerId);
		} catch {
			// A pointer already gone cannot be captured; the press is let go as
			// stale by the next press.
		}
	}

	private moved(event: PointerEvent, widget: ColourWidget | null): void {
		const held = this.held;
		if (!held) {
			this.hovered(event, widget);
			return;
		}
		if (event.pointerId !== held.pointerId) return;
		// A mouse moving with no button down was let go where the page did not see it.
		if (event.pointerType === 'mouse' && event.buttons === 0) {
			this.letGo(null);
			return;
		}
		if (!held.moved && Math.hypot(event.clientX - held.startX, event.clientY - held.startY) > held.slop) held.moved = true;
		if (held.widget !== null) return;
		// In its own window the picker is carried nowhere: the viewer moves the window.
		if (this.picker.carrying && this.popout) return;
		const at = this.picker.carrying ? onPage(event) : { x: event.clientX, y: event.clientY };
		this.picker.move(at.x, at.y, held.moved);
	}

	private up(event: PointerEvent): void {
		if (!this.held || event.pointerId !== this.held.pointerId) return;
		this.letGo({ x: event.clientX, y: event.clientY });
	}

	private cancelled(event: PointerEvent): void {
		if (this.held && event.pointerId === this.held.pointerId) this.letGo(null);
	}

	/**
	 * Lets the held press go: released at a point, or cancelled where there is
	 * none. A press on a well released on it unmoved gives it the focus. A
	 * press that moved leaves the click after it to the drag, unless it is let
	 * go as stale, its click long gone.
	 */
	private letGo(at: { x: number; y: number } | null, stale = false): void {
		const was = this.held;
		if (!was) return;
		this.held = null;
		const picked = was.widget !== null ? this.wells.get(was.widget) : undefined;
		if (was.widget === null) {
			if (at) this.picker.release(at.x, at.y);
			else this.picker.cancel();
		} else {
			this.picker.forgetPress();
			const laid = at && !was.moved && picked ? picked.laid() : null;
			if (at && laid && picked && !picked.state.disabled && inBox(laid.box, at.x, at.y)) this.focus(picked.widget);
		}
		if (was.moved && !stale) this.dragged = true;
		for (const canvas of [picked?.canvas, this.picker.canvas]) {
			try {
				canvas?.releasePointerCapture(was.pointerId);
			} catch {
				// The capture went with the pointer.
			}
		}
	}

	/**
	 * Hands a click to what it landed on: the picker's region under it
	 * (`click`), or a well, which opens the picker on itself or shuts it,
	 * takes the focus, and tells `click`; a disabled well answers nothing. The
	 * click after a press that moved is the drag's.
	 */
	private clicked(event: MouseEvent, widget: ColourWidget | null): void {
		if (this.dragged) {
			this.dragged = false;
			return;
		}
		if (this.disposed) return;
		if (widget === null) {
			const uv = this.uvOf(event);
			if (uv) this.picker.click(uv);
			return;
		}
		const picked = this.wells.get(widget);
		if (!picked) return;
		this.picker.forgetPress();
		this.letOthersFocusGo();
		if (picked.state.disabled) return;
		if (this.picker.openColor === widget) this.picker.close();
		else this.picker.open(widget);
		this.focus(widget);
		picked.tell('click');
	}

	/** The pointer over a well or the picker, with no press held: the picker's region under it lit, and the well, or the one the picker is open on, drawn hovered. */
	private hovered(event: PointerEvent, widget: ColourWidget | null): void {
		this.picker.hover(widget === null ? this.uvOf(event) : null);
		const over = widget ?? this.picker.openColor;
		this.pointAt(over ? this.wells.get(over) ?? null : null);
	}

	/** The pointer gone off a well's canvas or the picker's. */
	private left(widget: ColourWidget | null): void {
		if (this.held) return;
		if (widget === null) this.picker.hover(null);
		this.pointAt(null);
	}

	/** Draws the well the pointer is over hovered, and the one it left resting, telling `leave` and `enter` as the pointer goes off one and comes onto another, or onto the picker open on it. */
	private pointAt(picked: PickedWell | null): void {
		const was = this.hoveredWell;
		if (was === picked) return;
		this.hoveredWell = picked;
		for (const [each, over] of [[was, false], [picked, true]] as const) {
			if (!each) continue;
			if (!each.state.disabled) {
				each.state.hovered = over;
				each.invalidate();
			}
			each.tell(over ? 'enter' : 'leave');
		}
	}

	/** A press anywhere off the picker's wells, the picker and the page's input lets the input go, the picker staying open, but a press on the view the armed eyedropper takes (`dropDown`), and any press while the app's own pick is armed, which is the app's. */
	private pressedElsewhere(event: PointerEvent): void {
		// A click after this press is its own: none is the eyedropper's any more.
		this.dropClick = false;
		const target = event.target as Node | null;
		if (target && (this.picker.canvas.contains(target) || [...this.wells.values()].some((picked) => picked.canvas.contains(target)))) return;
		if (this.picker.picking()) return;
		const view = this.viewOf();
		if (view && target && view.element.contains(target) && this.picker.dropping()) {
			if (event.button !== 0) return;
			this.dropDown(event, view.element);
			return;
		}
		const input = pageInputMade();
		if (input && target && input.input === target) return;
		if (input?.focused && input.focusedHost === this) input.blur();
	}

	/** Takes the focus from another host that has it; another of the picker's own wells hands it over as a press is released on one. */
	private letOthersFocusGo(): void {
		const input = pageInputMade();
		if (input?.focused && input.focusedHost !== this) input.blur();
	}

	/** Stands the open picker again as its well moves on the page: the page scrolled, or the window resized. */
	private restand(): void {
		if (this.picker.openColor) this.picker.relay();
		else this.placeInput();
	}

	/** Asks for the open picker's well to be looked at on the next frame (`lookAtWell`), where it is not already. */
	private watchWell(): void {
		if (this.watchFrame || this.disposed) return;
		this.watchFrame = requestAnimationFrame(() => {
			this.watchFrame = 0;
			this.lookAtWell();
		});
	}

	/** Stops looking at the well, as the picker shuts. */
	private unwatchWell(): void {
		if (this.watchFrame) cancelAnimationFrame(this.watchFrame);
		this.watchFrame = 0;
		this.watchedAt = null;
	}

	/**
	 * Looks at the open picker's well, on every frame while it is open: gone
	 * from the page or hidden there, as a page takes it away or hides what
	 * holds it, it shuts the picker and lets its focus go; moved on the page
	 * with no scroll or resize to say so, as what stands before it changes,
	 * it has the picker stood against it again. Scrolled out of the window,
	 * it leaves the picker open.
	 */
	private lookAtWell(): void {
		const widget = this.picker.openColor;
		if (!widget || this.disposed) return;
		const laid = this.laidOf(widget);
		if (!laid) {
			this.picker.close();
			this.placeInput();
			return;
		}
		const was = this.watchedAt;
		const { x, y, w, h } = laid.box;
		if (!was || was.x !== x || was.y !== y || was.w !== w || was.h !== h) this.picker.relay();
		this.watchWell();
	}

	// ---------------------------------------------------------------------
	// The eyedropper's view
	// ---------------------------------------------------------------------

	/** The view the open well's eyedropper picks from where it picks from one: the view set, or beside the screen, the view it falls back to; null for none. */
	private viewOf(): DropperView | null {
		const widget = this.picker.openColor;
		const set = (widget ? this.dropperOf(widget) : this.eyedropperSet) as { mode?: unknown; view?: unknown } | null;
		return (set?.mode === 'view' || set?.mode === 'screen') && isView(set.view) ? set.view : null;
	}

	/** The open picker reads its eyedropper afresh, and the view's cursor follows. */
	private eyedropperChanged(): void {
		this.picker.dropperChanged();
		this.showCrosshair();
	}

	/** The view's cursor the eyedropper's crosshair while it is armed on the view, and the view's own otherwise. */
	private showCrosshair(): void {
		const view = this.disposed ? null : this.viewOf();
		const on = view && this.picker.dropping() ? view.element : null;
		if (on === this.crosshairOn) return;
		if (this.crosshairOn) this.crosshairOn.style.cursor = '';
		this.crosshairOn = on;
		if (on) on.style.cursor = 'crosshair';
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

	/** The mouse's own press and the click that follow the eyedropper's press on the view are the eyedropper's: kept from the view, and from the browser's focus change. A mouse press while the app's own pick is armed goes on to the app, kept from the browser's focus change alone, so the page's input keeps its focus. */
	private dropSwallow(event: Event): void {
		if (event.type === 'mousedown' && !this.dropHeld && this.picker.picking()) {
			event.preventDefault();
			return;
		}
		if (event.type === 'mousedown' ? !this.dropHeld : !this.dropClick) return;
		if (event.type === 'click') this.dropClick = false;
		event.stopPropagation();
		event.preventDefault();
	}

	/** The colour the view draws under a pointer; null off the view, or where the eyedropper picks from none. */
	private sampleAt(event: { clientX: number; clientY: number }) {
		return this.viewOf()?.sample(event.clientX, event.clientY) ?? null;
	}

	private listen(target: EventTarget, type: string, listener: EventListener, options?: boolean | AddEventListenerOptions, into: Listened[] = this.listened): void {
		target.addEventListener(type, listener, options);
		into.push({ target, type, listener, options });
	}
}
