/**
 * @fileoverview A colour widget's picker as it runs, apart from what holds
 * the widget, so any host can show it, as the page's picker does for a
 * page's colour wells (pagePicker.ts). The picker holds what is open and
 * what a press on it holds, paints itself into a canvas of its own, and
 * works the colour through its host (`PickerHost`), which owns the widget's
 * state, the page's input, where the picker stands and what it is drawn on.
 * Its layout and maths are pickerView.ts's.
 *
 * A host keeps this order, which the picker's behaviour rests on:
 * - `forgetPress` wherever a press that set the colour at its point is
 *   forgotten before its click: on every press, click, release and cancel
 *   the host does not hand to the picker, and on a reset of the host's
 *   interaction (the picker's own press, hover, click and cancel forget it);
 * - `relay` as the host paints, after the widget is laid out and before the
 *   host lets the input go from a widget no longer laid out;
 * - `close` as the host shuts its popover: the widget no longer open, the
 *   picker gone, the plane stood back and hidden, a press held on it then
 *   holding nothing more, and a field holding the input giving it back to
 *   the colour's body;
 * - a press held on the picker outlives the picker until its release;
 * - where a colour taken changes the widget's text, the picker is painted
 *   again by the host's next paint (`relay`), not at once.
 *
 * Points on the picker reach it as a host has them: a press, a click and
 * the pointer over it as a point of the picker's plane from its left and
 * its foot, each 0 to 1 (`Uv`), and a held press's moves and release in the
 * host's pixels, read through the box the picker stands at.
 *
 * The eyedropper takes a colour from outside the picker by the mode its host
 * sets (`Eyedropper`): the browser's own eyedropper, which picks from
 * anywhere on the screen, falling back to a view where the browser has
 * none, and with no view either drawn unavailable, its tooltip saying where
 * it works; a view the app provides, whose press while the eyedropper is
 * armed is the eyedropper's, the colour under the pointer taken through the
 * press and the eyedropper put away as it is released; the app's own pick,
 * which hands the picker each colour it takes (`CustomPick`); or none, the
 * picker showing no eyedropper. A colour it takes is taken as a named cell's
 * is, the alpha kept, and tells `change` where it changes the colour, as
 * every colour taken does. A press on the picker anywhere but the eyedropper
 * puts an armed one away, and the tooltip a click on an unavailable one
 * pinned open, as do Escape while no field holds the input, the picker
 * shutting, and the host's eyedropper changing, unless from one view to
 * another.
 *
 * A host that can pop the picker out of its page into a window of its own
 * has the picker show a button for it (`dockButton`), whose click the host
 * answers (`dockClicked`).
 */

import { CHANNELS, COLOUR_SPACES, SWATCHES, readChannel, type ColourSpace, type Hsv } from './colour.ts';
import { DROPPER_TIPS, DRAGGED_REGIONS, channelsOf, colourAtRegion, fieldBox, fieldChain, fieldText, layoutPicker, paintPicker, pickerMono, pickerRegionAt, sameRegion, squareColour, termsAtSquare, termsColour, termsKeeping, termsOf, termsWithChannel, wheelGeometryOf, withSquare, type DockButton, type DropperTier, type PickerLayout, type PickerTerms, type Region } from './pickerView.ts';
import { hueOfAngle, makeWheelRenderer, type Rgb, type WheelGeometry, type WheelRenderer, type WheelTerms } from './wheel.ts';
import { pageInput, pageInputMade, type InputHost, type InputKind, type InputLook, type PageInput } from './input.ts';
import { PALETTE, fieldLine, fieldRadius, fontFamilies } from './paint.ts';
import { CONTROL, inBox, type Box, type Laid, type TextMeasure, type WidgetState } from './layout.ts';
import { cssColour, type PickerMode, type ColourWidget, type WidgetEvent } from './options.ts';
import { formatColour, parseColour } from './hex.ts';

/** A point of the picker's plane: across from its left and up from its foot, each 0 to 1, as a ray's hit on the plane gives it in a 3D scene or in VR, and as a page's point is read through the box the picker stands at. */
export interface Uv {
	x: number;
	y: number;
}

/**
 * What a picker asks of its host, which holds the colour widget and shows
 * the picker: on a page, the page's picker (`PagePicker`), serving the
 * page's colour wells; in a 3D scene or in VR, a host that draws the widget
 * and the picker on planes and hits them with rays.
 */
export interface PickerHost {
	/** The widget as laid out, in the host's pixels; null where it is not, which shuts the picker. */
	laidOf(widget: ColourWidget): Laid | null;
	/** What the widget is in now: its text is its colour. */
	stateOf(widget: ColourWidget): WidgetState;
	/** Something of the widget changed: the host paints it again, and calls `relay` as it does. */
	invalidate(): void;
	/** Tells an event the widget tells (`WidgetEvent`), which the host passes on as it chooses. */
	tell(widget: ColourWidget, event: WidgetEvent): void;
	/** The host's size in its own pixels, which the picker is laid out in, and how many of the canvas's pixels make one of them. */
	readonly width: number;
	readonly height: number;
	readonly resolution: number;
	/** How wide a run of words is in a font. */
	readonly measure: TextMeasure;
	/** Stands the picker's plane at a box, in the host's pixels, and shows it; null hides it, the picker shut. */
	placePopover(box: Box | null): void;
	/** Where the picker stands, which a point of its plane is read through: the box given, or where the host's rule moved it, and the side of its colour it stands on there with how far down standing there rather than on the side its layout gives took it; null for a host that moves it nowhere. */
	standing(box: Box): { box: Box; side: { side: 'above' | 'below'; turn: number } | null };
	/** The picker's canvas painted again, resized where `resized` says so. */
	popoverPainted(resized: boolean): void;
	/** The widget the page's input is typed into; null while none has it. */
	readonly focused: ColourWidget | null;
	/** Gives the widget the page's input. */
	focus(widget: ColourWidget): void;
	/** Gives the page's input to the field after the widget in the host's own order, as Tab past the picker's last field does; false where the host has none, and the input is let go. */
	focusAfter(widget: ColourWidget): boolean;
	/** What the page's input tells: the host itself, which a hand-off is made to and a take-back is checked against. */
	readonly inputHost: InputHost;
	/** The input the picker's fields are typed through where it is not the page's (`pageInput`): a host that shows the picker in another document, as a window of its own, gives one standing there, and places it over the field that holds it. The colour itself keeps the page's input. Null or left out for the page's. */
	readonly fieldInput?: PageInput | null;
	/** Shuts every other popover the host and its kind show, as a picker opens. */
	closeOther(): void;
	/** The eyedropper the host sets for a widget's picker (`Eyedropper`), read as the picker opens and as the host says it changed (`dropperChanged`). */
	dropperOf(widget: ColourWidget): Eyedropper<object>;
	/** The button the picker shows left of its close to pop it out of the host's page into a window of its own, or to dock it back (`DockButton`); null or left out for none, as on a host that shows the picker nowhere else. Read as the picker is laid out, which the host asks for (`relay`) as it changes. */
	readonly dockButton?: DockButton | null;
	/** The dock button clicked: the host pops the picker out or docks it back, and lays it out again (`relay`). */
	dockClicked?(): void;
}

/** The eyedropper's modes, as `Eyedropper` names them. */
export const EYEDROPPER_MODES = ['screen', 'view', 'custom', 'disabled'] as const;

export type EyedropperMode = (typeof EYEDROPPER_MODES)[number];

/**
 * The eyedropper as a host sets it, by its mode:
 *
 * - `screen` — the browser's own eyedropper, which picks from anywhere on the
 *   screen; where the browser has none, as every browser but Chromium's on a
 *   computer, it falls back to picking from `view`, and where no view is
 *   given it is unavailable: drawn half as solid, its tooltip saying it
 *   needs Chrome or Edge on a computer, which a click on it shows as well
 * - `view` — picks from a surface the app provides, such as a video feed: a
 *   page's `DropperView`, whose presses a page's picker takes, or another
 *   host's own, which takes the presses on itself and hands the colour under
 *   them to the picker (`takeDropped`)
 * - `custom` — the app picks the colour by its own means, where the picker
 *   cannot reach what is picked from (`CustomPick`)
 * - `disabled` — no eyedropper: the picker shows none
 *
 * `tip` gives the tooltip's words in `view` and `custom`; left out, the
 * mode's own (`DROPPER_TIPS`).
 */
export type Eyedropper<View extends object = DropperView> =
	| { mode: 'screen'; view?: View | null }
	| { mode: 'view'; view: View; tip?: string }
	| { mode: 'custom'; pick: CustomPick; tip?: string }
	| { mode: 'disabled' };

/**
 * The app's own pick, called as the eyedropper is clicked in `custom`: the
 * eyedropper is drawn armed while the app picks, and each colour the app
 * hands to `take`, as hex, is taken as a named cell's is, its bytes with the
 * alpha the colour carries kept, telling `change` where it changes the
 * colour; `take(colour, true)` takes the last and puts the eyedropper away,
 * and `take(null, true)` puts it away taking nothing. `signal` aborts where
 * the eyedropper is put away before the app is done: a second click on it, a
 * press anywhere else on the picker, Escape, the eyedropper changed, or the
 * picker shutting; a take after that does nothing.
 */
export type CustomPick = (take: (colour: string | null, done?: boolean) => void, signal: AbortSignal) => void;

/** What a host's view gives the eyedropper: the element a press on which, while the eyedropper is armed, is the eyedropper's, and the colour drawn at a point of the page. */
export interface DropperView {
	readonly element: HTMLElement;
	/** The colour drawn at a point of the page, in its CSS pixels from the window's corner; null off the view. */
	sample(clientX: number, clientY: number): Rgb | null;
}

/** The browser's own eyedropper, which lib.dom does not declare. */
type EyeDropperConstructor = new () => { open(options?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }> };

/** The browser's own eyedropper; null where the browser has none: every browser but Chromium's on a computer. */
const eyeDropperOf = (): EyeDropperConstructor | null => (window as unknown as { EyeDropper?: EyeDropperConstructor }).EyeDropper ?? null;

/**
 * The mode the viewer last chose on a picker's tabs, which every colour's
 * picker opens in from then on; null until one is chosen, each picker
 * opening in the mode its options name. Forgotten with `forgetChosenMode`.
 */
let chosenMode: PickerMode | null = null;

/** Forgets the mode the viewer last chose on a picker's tabs. */
export const forgetChosenMode = (): void => {
	chosenMode = null;
};

/**
 * A colour's picker while it is open: its layout, the mode it shows, the
 * colour's terms as the wheel, the square and the HSL channels hold them,
 * the colour's bytes now, the colour and alpha it opened on, the region
 * under the pointer, the named cell the keys point at, the channel bar they
 * act on, the colour space its channel fields and bars read the colour in,
 * the field holding the page's input with what is typed in it and the
 * colour it was entered on, and how far the viewer has carried it.
 */
interface OpenPicker {
	layout: PickerLayout;
	mode: PickerMode;
	terms: PickerTerms;
	/** The colour's bytes now: the triangle's or the square's for the terms, a bar's channel set, a named cell's or a swatch's, or the colour as it stood, opened or was written by a script, as an alpha bar and keys, the old half, Escape and a write leave it. */
	colour: Rgb;
	old: Rgb;
	oldAlpha: number;
	lit: Region | null;
	/** The named cell the keys point at, the one equal to the colour; -1 for none. */
	name: number;
	/** The channel bar the keys act on in sliders, by index: the one last pressed or stepped to, red as the picker opens. */
	bar: number;
	/** The colour space the channel fields and the bars read the colour in, cycled by the space word; RGB as the picker opens. */
	space: ColourSpace;
	/** The field holding the page's input, the hex, a channel or the alpha; null while the picker's body holds it. */
	field: Region | null;
	/** The words in the field's input, as typed; empty while no field holds it. */
	typed: string;
	/** The colour and terms the field was entered on, or as last moved from outside the field, which Escape puts back; null while no field holds the input. */
	entered: { colour: Rgb; terms: PickerTerms } | null;
	/** How far the viewer has carried the picker from where its layout stands it, in the host's pixels: none as it opens, and kept as it is laid out again. */
	offset: { x: number; y: number };
	/** The side of its colour the host stood the picker on as the viewer began to carry it, which it keeps while it is open; null until it is carried, and on a host that stands it on no side. */
	side: 'above' | 'below' | null;
	/** The eyedropper: whether it is armed, on a view or in the app's own pick; the browser's eyedropper or the app's pick while it is open, by what aborts it; and whether a click on it pinned its tooltip open where it is unavailable, which a touch has no pointer over to show it. */
	dropper: { armed: boolean; abort: AbortController | null; pinned: boolean };
}

/**
 * What a held press on the picker does as the pointer moves: a press on a
 * region that sets the colour at its point follows the pointer, one on a
 * field gives the field the page's input as it is released unmoved, one
 * anywhere else carries the picker once it moves past a drag's start and
 * otherwise acts on its click, and one held as the picker shut does nothing
 * more.
 */
type PressKind = 'picker' | 'field' | 'carry' | 'hold';

/** A press held on the picker: what it is on and does, where it began in the host's pixels, whether it has moved past a drag's start, where a carried picker stood as it began, and the part of the picker it is on. */
interface Press {
	widget: ColourWidget;
	kind: PressKind;
	x: number;
	y: number;
	moved: boolean;
	fromX: number;
	fromY: number;
	region?: Region;
}

/** A picker's layout moved as far as the viewer has carried it, its parts kept in its own pixels. */
const carriedBy = (layout: PickerLayout, offset: { x: number; y: number }): PickerLayout =>
	offset.x === 0 && offset.y === 0 ? layout : { ...layout, box: { ...layout.box, x: layout.box.x + offset.x, y: layout.box.y + offset.y } };

/**
 * The one wheel renderer every picker draws with, made as the first wheel is
 * painted, with the wheel's context parameters (`WHEEL_CONTEXT`), as the
 * dialog's wheel is, and let go as its context is lost, so the next paint
 * makes it again; null while there is none, and where the page gives no
 * context.
 */
let wheelRenderer: WheelRenderer | null = null;

/** Whether the page refused the renderer its context, so no paint asks again. */
let wheelRefused = false;

/** The wheel drawn for a geometry and a colour's terms, on the shared renderer's canvas, to be copied in the same step; null where no renderer can be made. */
const wheelImage = (geometry: WheelGeometry, terms: WheelTerms): HTMLCanvasElement | null => {
	if (!wheelRenderer) {
		if (wheelRefused) return null;
		try {
			const made = makeWheelRenderer();
			made.canvas.addEventListener('webglcontextlost', () => {
				if (wheelRenderer === made) wheelRenderer = null;
			});
			wheelRenderer = made;
		} catch {
			wheelRefused = true;
			return null;
		}
	}
	wheelRenderer.draw(geometry, terms);
	return wheelRenderer.canvas;
};

/** A number held between two bounds. */
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

export class ColourPicker {
	private readonly host: PickerHost;
	/** The open picker; null while none is. */
	private popover: OpenPicker | null = null;
	/** The press held on the picker, if any. */
	private held: Press | null = null;
	/**
	 * Whether the page's input is being handed between the picker's body and
	 * one of its own fields: the input blurs its host as it is focused again
	 * with another kind, and a blur the host hears under the mark leaves the
	 * picker open and the widget focused (`handOff`).
	 */
	private handingOff = false;
	/**
	 * Whether the press last let go, unmoved, was on a part of the picker that
	 * set the colour at its point: the click that follows it sets nothing
	 * again, since it lands where the release did, within a drag's start of
	 * the press, whose moves set the colour there already; a click with no
	 * press before it sets the colour by the click alone. A mark no click
	 * took is cleared by the next hover, press or cancel, or by `forgetPress`.
	 */
	private pickerPressed = false;
	/** The canvas the picker is painted into, a box of the host's pixels at its resolution. */
	readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D;

	constructor(host: PickerHost) {
		this.host = host;
		this.canvas = document.createElement('canvas');
		this.ctx = this.canvas.getContext('2d')!;
	}

	/** Whether a press is held on the picker, or was held on it as it shut. */
	get pressing(): boolean {
		return this.held !== null;
	}

	/** Whether the held press carries the picker, whose pointer a host keeps on the page so the point carried stays in view. */
	get carrying(): boolean {
		return this.held?.kind === 'carry';
	}

	/** The open picker's box, how far the viewer has carried it and the side of its colour it keeps while carried, for a host to stand it by; null while none is open. */
	get stand(): { box: Box; offset: { x: number; y: number }; side: 'above' | 'below' | null } | null {
		return this.popover ? { box: this.popover.layout.box, offset: this.popover.offset, side: this.popover.side } : null;
	}

	/** Opens the widget's picker; nothing for a colour not laid out or disabled. */
	open(widget: ColourWidget): void {
		this.openPicker(widget);
	}

	/**
	 * Shuts the picker, where one is open: the widget no longer open, the
	 * picker gone, its plane stood back and hidden, a press held on it then
	 * holding nothing more, so its moves set nothing, and a field holding the
	 * page's input giving it back to the colour's body, where the colour keeps
	 * the focus. The colour stays as it was last taken.
	 */
	close(): void {
		const popover = this.popover;
		if (!popover) return;
		const widget = popover.layout.widget;
		this.dropperOff(popover);
		this.host.stateOf(widget).open = false;
		this.popover = null;
		this.host.placePopover(null);
		if (this.held) this.held.kind = 'hold';
		if (popover.field) this.takeBack(widget);
	}

	/**
	 * Lays the open picker out again from its widget as the host just laid
	 * the widget out, and paints it, as far from where its layout stands it
	 * as the viewer carried it; a widget no longer laid out, hidden among
	 * them, has no picker to open from, so the picker is shut.
	 */
	relay(): void {
		const popover = this.popover;
		if (!popover) return;
		const laid = this.host.laidOf(popover.layout.widget);
		if (!laid) {
			this.close();
			return;
		}
		popover.layout = carriedBy(this.layoutOf(laid, popover.mode), popover.offset);
		this.host.placePopover(popover.layout.box);
		this.paintThePicker();
	}

	/** A widget's picker laid out in a mode, with its eyedropper and the host's dock button. */
	private layoutOf(laid: Laid, mode: PickerMode): PickerLayout {
		return layoutPicker(laid, this.host.width, this.host.height, this.host.measure, mode, this.tipWords(laid.widget), this.dockButton());
	}

	/** Reads the open picker's colour and terms afresh from what the widget holds, as a script writes its value. */
	sync(): void {
		this.syncPicker();
	}

	/** Forgets a press that set the colour at its point, so the click after it, if any comes, sets the colour as a click does. */
	forgetPress(): void {
		this.pickerPressed = false;
	}

	/**
	 * Takes a press on the open picker at a point of its plane: one on the
	 * ring, the triangle, the square, the hue strip or a bar sets the colour
	 * at the point and follows the pointer; one on a field gives the field the
	 * page's input as it is released unmoved; one anywhere else on the picker,
	 * a tab, the close, a cell, a swatch, the preview, the space word or
	 * between them, carries the picker from where it stands once it moves
	 * past a drag's start, and otherwise acts on the click.
	 *
	 * @returns Where the press went down, in the host's pixels; null where no picker is open
	 */
	press(uv: Uv): { x: number; y: number } | null {
		this.pickerPressed = false;
		const popover = this.popover;
		if (!popover) return null;
		// In the host's pixels, as every move is, through the box the picker stands at.
		const standing = this.host.standing(popover.layout.box);
		const box = standing.box;
		const px = box.x + uv.x * box.w;
		const py = box.y + (1 - uv.y) * box.h;
		const widget = popover.layout.widget;
		const region = pickerRegionAt(popover.layout, px - box.x, py - box.y, popover.terms.unit, this.tipShown(popover));
		// A press anywhere on the picker but the eyedropper and its tooltip puts an armed one away, or the tooltip a click pinned open, and then works as ever; one on the tooltip leaves it standing for its click, which a touch has no pointer over to find it by.
		if ((popover.dropper.armed || popover.dropper.pinned) && region?.kind !== 'dropper' && region?.kind !== 'tip') this.putDropperAway();
		const dragged = region !== null && DRAGGED_REGIONS.includes(region.kind);
		const field = region !== null && fieldBox(popover.layout, region) !== null;
		// A carry starts from where the picker stands, less its standing on the colour's other side, which the side it keeps carries.
		const turn = standing.side?.turn ?? 0;
		this.held = { widget, kind: dragged ? 'picker' : field ? 'field' : 'carry', x: px, y: py, moved: false, fromX: box.x, fromY: box.y - turn, region: region ?? undefined };
		if (region && dragged && !this.host.stateOf(widget).disabled) this.setPickerAt(region, px - box.x, py - box.y);
		return { x: px, y: py };
	}

	/**
	 * Moves the held press to a point, in the host's pixels: a press on a
	 * region that sets the colour sets it at the point, the region pressed
	 * kept wherever the pointer goes, and a press carrying the picker, once
	 * it has moved past a drag's start, which the host decides, carries it
	 * with the pointer.
	 *
	 * @param moved - Whether the press has moved past a drag's start
	 * @returns Whether the press has moved past a drag's start
	 */
	move(x: number, y: number, moved: boolean): boolean {
		const press = this.held;
		if (!press) return false;
		if (moved) press.moved = true;
		const dx = x - press.x;
		const dy = y - press.y;
		switch (press.kind) {
			case 'picker':
				// The region pressed is kept for the drag, wherever the pointer goes.
				if (press.region && this.popover) {
					const box = this.standingBox(this.popover);
					this.setPickerAt(press.region, x - box.x, y - box.y);
				}
				break;
			case 'carry':
				if (press.moved) this.carryPicker(press.fromX + dx, press.fromY + dy);
				break;
		}
		return press.moved;
	}

	/**
	 * Lets the held press go at a point, in the host's pixels: a field pressed
	 * and released on itself without a move takes the page's input, and a
	 * press on a region that set the colour, let go unmoved, marks the click
	 * that follows as one that sets nothing again.
	 *
	 * @returns Whether the press had moved past a drag's start
	 */
	release(x: number, y: number): boolean {
		const press = this.held;
		this.held = null;
		if (!press) return false;
		this.pickerPressed = press.kind === 'picker' && !press.moved;
		const laid = this.host.laidOf(press.widget);
		if (press.kind === 'field' && !press.moved && laid && !laid.state.disabled) {
			const popover = this.popover;
			const field = press.region && popover?.layout.widget === press.widget ? fieldBox(popover.layout, press.region) : null;
			const box = popover ? this.standingBox(popover) : null;
			if (field && box && inBox(field, x - box.x, y - box.y)) this.focusField(press.region!);
		}
		return press.moved;
	}

	/**
	 * Drops the held press, as the browser takes the pointer away: as a
	 * release, but nothing takes the input.
	 *
	 * @returns Whether the press had moved past a drag's start
	 */
	cancel(): boolean {
		const press = this.held;
		this.held = null;
		this.pickerPressed = false;
		return press?.moved ?? false;
	}

	/** Hands a click on the open picker at a point of its plane to the region under it (`clickPicker`), a press that set the colour there unmoved before it setting nothing again. */
	click(uv: Uv): void {
		const pressed = this.pickerPressed;
		this.pickerPressed = false;
		if (this.popover) this.clickPicker(uv, pressed);
	}

	/** Lights the region of the open picker under the pointer, at a point of its plane; null for the pointer off it. Nothing while a press is held, whose pointer it is. */
	hover(uv: Uv | null): void {
		if (this.held) return;
		this.pickerPressed = false;
		const popover = this.popover;
		if (!popover || !uv) {
			this.lightPicker(null);
			return;
		}
		const box = this.standingBox(popover);
		this.lightPicker(pickerRegionAt(popover.layout, uv.x * box.w, (1 - uv.y) * box.h, popover.terms.unit, this.tipShown(popover)));
	}

	/** Whether one of the widget's open picker's fields holds the page's input. */
	inField(widget: ColourWidget): boolean {
		return this.fieldPicker(widget) !== null;
	}

	/** A key in the field of the widget's open picker that holds the page's input (`fieldKey`); false where none holds it. */
	fieldKeyOf(widget: ColourWidget, event: KeyboardEvent): boolean {
		const picker = this.fieldPicker(widget);
		return picker ? this.fieldKey(picker, event) : false;
	}

	/** Gives the open picker's hex field the page's input, as Tab on the colour does. */
	enterHex(): void {
		this.focusField({ kind: 'hex', index: -1 });
	}

	/** A key on the focused colour, the picker shut or open (`pickerKey`). */
	key(widget: ColourWidget, event: KeyboardEvent): boolean {
		return this.pickerKey(widget, event);
	}

	/** What is typed into the field of the widget's open picker that holds the page's input, applied to the colour where it reads (`applyField`); false where no field holds it. */
	input(widget: ColourWidget, value: string): boolean {
		const picker = this.fieldPicker(widget);
		if (!picker) return false;
		picker.typed = value;
		this.applyField(picker, value, false);
		return true;
	}

	/** Whether the page's input is being handed between the picker's body and one of its fields, whose blur the host leaves be. */
	get handing(): boolean {
		return this.handingOff;
	}

	/** Returns the page's input from a field to the picker's body. */
	returnToBody(): void {
		this.focusBody();
	}

	/**
	 * Where the field of the widget's open picker that holds the page's input
	 * stands, for the input to be placed over it, and how it is drawn: the
	 * picker's box in the host's pixels, the field's box in the picker's own,
	 * and the field's look: its words centred in the picker's font, rounded
	 * and lined as the picker paints its fields, as the widget's field is.
	 * Null where no field holds the input.
	 *
	 * @param opacity - How solid the widget is drawn, the host's own opacity counted
	 */
	placement(widget: ColourWidget, opacity: number): { box: Box; field: Box; look: Omit<InputLook, 'scale'> } | null {
		const picker = this.fieldPicker(widget);
		const laid = this.host.laidOf(widget);
		if (!picker || !laid) return null;
		const { style } = laid;
		const font = pickerMono(picker.layout);
		const look: Omit<InputLook, 'scale'> = {
			font,
			families: fontFamilies(font),
			color: cssColour(style.color),
			background: style.background ? cssColour(style.background) : PALETTE.field,
			accent: cssColour(style.accent),
			align: 'center',
			padX: CONTROL.padX,
			padY: CONTROL.padY,
			// Rounded and lined as the picker paints its fields, as the widget's field is.
			radius: fieldRadius(picker.layout),
			line: fieldLine(picker.layout).width,
			lineColor: fieldLine(picker.layout).colour,
			opacity,
		};
		return { box: this.standingBox(picker), field: fieldBox(picker.layout, picker.field!)!, look };
	}

	/** Where the open picker stands, in the host's pixels, which a point of its plane is read through. */
	private standingBox(popover: OpenPicker): Box {
		return this.host.standing(popover.layout.box).box;
	}

	// ---------------------------------------------------------------------
	// The eyedropper
	// ---------------------------------------------------------------------

	/** Whether the open picker's eyedropper is armed on a view, whose next press, its moves and its release take the colour under the pointer (`takeDropped`). */
	dropping(): boolean {
		const picker = this.popover;
		return picker?.dropper.armed === true && this.eyedropperOf(picker.layout.widget)?.tier === 'view';
	}

	/** Whether the open picker's eyedropper is armed in the app's own pick (`CustomPick`), whose presses, wherever they land, a host leaves to the app. */
	picking(): boolean {
		const picker = this.popover;
		return picker?.dropper.armed === true && picker.dropper.abort !== null && this.eyedropperOf(picker.layout.widget)?.tier === 'custom';
	}

	/**
	 * Takes a colour the host read off its view under the eyedropper's press,
	 * as a named cell's is taken, the alpha kept; a press the host let go
	 * puts the eyedropper away. Nothing where it is not armed.
	 *
	 * @param rgb - The colour drawn under the pointer; null for a point off the view, which takes none
	 * @param done - Whether the press has been let go
	 */
	takeDropped(rgb: Rgb | null, done: boolean): void {
		if (!this.dropping()) return;
		const picker = this.popover!;
		if (rgb) this.takeSampled(rgb);
		if (done) {
			picker.dropper.armed = false;
			this.paintThePicker();
		}
	}

	/** Puts the eyedropper away: disarmed, the browser's open one or the app's pick aborted, and the tooltip a click pinned open let go. */
	putDropperAway(): void {
		const picker = this.popover;
		if (picker && this.dropperOff(picker)) this.paintThePicker();
	}

	/** Reads the host's eyedropper afresh, as it has changed: one armed on a view stays armed where the eyedropper still picks from a view, any other and a tooltip a click pinned open are put away, and the picker is laid out again, with an eyedropper or without, and painted. */
	dropperChanged(): void {
		const picker = this.popover;
		if (!picker) return;
		const viewArmed = picker.dropper.armed && picker.dropper.abort === null;
		if (!(viewArmed && this.eyedropperOf(picker.layout.widget)?.tier === 'view')) this.dropperOff(picker);
		this.relay();
	}

	/**
	 * What a widget's eyedropper picks from, and its tooltip's words, by the
	 * mode its host sets (`Eyedropper`): the screen where the browser has its
	 * own eyedropper, else the view given beside it, else nothing, the
	 * eyedropper unavailable; a view; or the app's own pick. Null where there
	 * is none: disabled, or a mode that does not read.
	 */
	private eyedropperOf(widget: ColourWidget): { tier: DropperTier; tip: string } | null {
		// Read as a page's script may give it, without types.
		const set = this.host.dropperOf(widget) as { mode?: unknown; view?: unknown; pick?: unknown; tip?: unknown } | null;
		const tip = (own: string): string => (typeof set?.tip === 'string' && set.tip.trim() ? set.tip : own);
		const view = typeof set?.view === 'object' && set.view !== null;
		switch (set?.mode) {
			case 'screen':
				if (eyeDropperOf()) return { tier: 'screen', tip: DROPPER_TIPS.screen };
				return view ? { tier: 'view', tip: DROPPER_TIPS.fallback } : { tier: 'unavailable', tip: DROPPER_TIPS.unavailable };
			case 'view':
				return view ? { tier: 'view', tip: tip(DROPPER_TIPS.view) } : null;
			case 'custom':
				return typeof set.pick === 'function' ? { tier: 'custom', tip: tip(DROPPER_TIPS.custom) } : null;
			default:
				return null;
		}
	}

	/** The open widget's eyedropper's tooltip words, which lay it out; null for no eyedropper. */
	private tipWords(widget: ColourWidget): string | null {
		return this.eyedropperOf(widget)?.tip ?? null;
	}

	/** The dock button the host shows, which lays it out; null for none. */
	private dockButton(): DockButton | null {
		const dock = this.host.dockButton;
		return dock === 'popout' || dock === 'dock' ? dock : null;
	}

	/** Whether the eyedropper's tooltip shows: while the pointer is over the eyedropper or the tooltip, while it is armed, on a view or in the app's own pick, and while a click on it pinned it open where it is unavailable, the last two showing it to a touch, which has no pointer over it. */
	private tipShown(picker: OpenPicker): boolean {
		const lit = picker.lit?.kind;
		return lit === 'dropper' || lit === 'tip' || picker.dropper.armed || picker.dropper.pinned;
	}

	/** A click on the eyedropper, by what it picks from: the browser's own opened; the eyedropper armed on the view, or put away; the app's own pick begun, or put away; or where it is unavailable, its tooltip pinned open, or let go. */
	private dropperClicked(picker: OpenPicker): void {
		const widget = picker.layout.widget;
		const tier = this.eyedropperOf(widget)?.tier;
		if (picker.dropper.armed) {
			this.putDropperAway();
			return;
		}
		switch (tier) {
			case 'screen':
				this.openEyeDropper(picker);
				break;
			case 'view':
				picker.dropper.armed = true;
				this.paintThePicker();
				break;
			case 'custom':
				this.openCustomPick(picker, this.host.dropperOf(widget) as Extract<Eyedropper<object>, { mode: 'custom' }>);
				break;
			case 'unavailable':
				picker.dropper.pinned = !picker.dropper.pinned;
				this.paintThePicker();
				break;
		}
	}

	/**
	 * Begins the app's own pick (`CustomPick`): the eyedropper drawn armed and
	 * its tooltip shown while the app picks, each colour the app takes taken
	 * as a named cell's is, until the app is done or the eyedropper is put
	 * away first, which aborts the pick's signal. A pick that throws as it
	 * begins puts the eyedropper away and throws on.
	 */
	private openCustomPick(picker: OpenPicker, set: Extract<Eyedropper<object>, { mode: 'custom' }>): void {
		const abort = new AbortController();
		picker.dropper.armed = true;
		picker.dropper.abort = abort;
		this.paintThePicker();
		const take = (colour: string | null, done = false): void => {
			if (picker.dropper.abort !== abort || this.popover !== picker) return;
			const read = typeof colour === 'string' ? parseColour(colour) : null;
			if (read) this.takeSampled([Math.round(read.r * 255), Math.round(read.g * 255), Math.round(read.b * 255)]);
			if (done) {
				picker.dropper.armed = false;
				picker.dropper.abort = null;
				this.paintThePicker();
			}
		};
		try {
			set.pick(take, abort.signal);
		} catch (error) {
			if (picker.dropper.abort === abort) this.putDropperAway();
			throw error;
		}
	}

	/**
	 * Opens the browser's own eyedropper, inside the click that asked for it,
	 * which the browser needs: the eyedropper drawn armed while it is open,
	 * and the colour it picks taken, unless the picker shut or the eyedropper
	 * was put away first, which aborts it. The browser's Escape takes
	 * nothing; any other refusal is thrown with the browser's cause.
	 */
	private openEyeDropper(picker: OpenPicker): void {
		const EyeDropper = eyeDropperOf();
		if (!EyeDropper) throw new Error('the eyedropper picks from the screen, but the browser has no EyeDropper');
		if (picker.dropper.abort) return;
		const abort = new AbortController();
		picker.dropper.abort = abort;
		this.paintThePicker();
		new EyeDropper().open({ signal: abort.signal }).then((result) => {
			if (picker.dropper.abort !== abort) return;
			picker.dropper.abort = null;
			const colour = parseColour(result.sRGBHex);
			if (!colour) throw new Error(`the browser's eyedropper answered ${result.sRGBHex}, which reads as no colour`);
			this.takeSampled([Math.round(colour.r * 255), Math.round(colour.g * 255), Math.round(colour.b * 255)]);
			this.paintThePicker();
		}, (error: unknown) => {
			if (picker.dropper.abort === abort) {
				picker.dropper.abort = null;
				this.paintThePicker();
			}
			if (error instanceof DOMException && error.name === 'AbortError') return;
			throw error;
		});
	}

	/** Takes a colour the eyedropper picked onto the open picker's colour, as a named cell's is taken: its bytes, the alpha kept, the hues of the terms kept for a grey. */
	private takeSampled(rgb: Rgb): void {
		const picker = this.popover;
		if (!picker) return;
		picker.terms = termsKeeping(rgb, picker.terms.alpha, picker.terms);
		this.takeColour(picker.layout.widget, rgb, picker.terms.alpha);
	}

	/** Puts a picker's eyedropper away, and the tooltip a click pinned open; whether anything of it was out. The browser's open one, or the app's pick, is let go of before it is aborted, so its answer finds it gone. */
	private dropperOff(picker: OpenPicker): boolean {
		const { dropper } = picker;
		const was = dropper.armed || dropper.abort !== null || dropper.pinned;
		dropper.armed = false;
		dropper.pinned = false;
		const abort = dropper.abort;
		dropper.abort = null;
		abort?.abort();
		return was;
	}

	/** The colour whose picker is open; null while none is. */
	get openColor(): ColourWidget | null {
		return this.popover?.layout.widget ?? null;
	}

	/**
	 * The picker's context, its canvas sized to a box at the host's
	 * resolution and its transform set to the host's pixels, and whether the
	 * size changed, which the host is told as the picker is painted
	 * (`popoverPainted`).
	 */
	private popoverContext(box: Box): { ctx: CanvasRenderingContext2D; resized: boolean } {
		const resolution = this.host.resolution;
		const across = Math.max(1, Math.round(box.w * resolution));
		const down = Math.max(1, Math.round(box.h * resolution));
		const resized = this.canvas.width !== across || this.canvas.height !== down;
		if (resized) {
			this.canvas.width = across;
			this.canvas.height = down;
		}
		this.ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
		return { ctx: this.ctx, resized };
	}

	// ---------------------------------------------------------------------
	// A colour's picker on the popover
	// ---------------------------------------------------------------------

	/** A colour widget's colour as it holds it: its bytes and its alpha, 1 where it carries none. */
	private colourOf(widget: ColourWidget): { rgb: Rgb; alpha: number } {
		const colour = parseColour(this.host.stateOf(widget).text) ?? { r: 0, g: 0, b: 0, a: 1 };
		return { rgb: [Math.round(colour.r * 255), Math.round(colour.g * 255), Math.round(colour.b * 255)], alpha: widget.alpha ? colour.a : 1 };
	}

	/** The standard colour whose bytes are a colour's, by index; -1 for none. */
	private static namedIndex(rgb: Rgb): number {
		return SWATCHES.findIndex((swatch) => swatch.rgb[0] === rgb[0] && swatch.rgb[1] === rgb[1] && swatch.rgb[2] === rgb[2]);
	}

	/** Opens a colour's picker on the popover where its layout stands it, in the mode the viewer last chose on a picker's tabs, or until one is chosen the mode its options name, holding the colour it opens on; nothing for a colour not laid out or disabled. */
	private openPicker(widget: ColourWidget): void {
		const laid = this.host.laidOf(widget);
		if (!laid || laid.state.disabled) return;
		this.close();
		this.host.closeOther();
		const { rgb, alpha } = this.colourOf(widget);
		const mode: PickerMode = chosenMode ?? widget.mode ?? 'wheel';
		const picker: OpenPicker = { layout: this.layoutOf(laid, mode), mode, terms: termsOf(rgb, alpha), colour: rgb, old: rgb, oldAlpha: alpha, lit: null, name: ColourPicker.namedIndex(rgb), bar: 0, space: 'RGB', field: null, typed: '', entered: null, offset: { x: 0, y: 0 }, side: null, dropper: { armed: false, abort: null, pinned: false } };
		this.popover = picker;
		laid.state.open = true;
		this.host.placePopover(picker.layout.box);
		this.paintThePicker();
	}

	/**
	 * Paints the open picker into its canvas, and tells the host. In wheel the
	 * wheel is drawn first by the shared renderer, at the wheel's square times
	 * the host's resolution, and copied in the same step, since the
	 * renderer's canvas keeps no drawing between tasks.
	 */
	private paintThePicker(): void {
		const picker = this.popover;
		if (!picker) return;
		const { layout } = picker;
		const { ctx, resized } = this.popoverContext(layout.box);
		const { terms } = picker;
		const wheel = layout.wheel ? wheelImage(wheelGeometryOf(layout.wheel, this.host.resolution), { unit: terms.unit, hue: terms.hue, base: picker.colour, saturation: terms.saturation, intensity: terms.intensity }) : null;
		const dropper = { armed: picker.dropper.armed || picker.dropper.abort !== null, tip: this.tipShown(picker), unavailable: this.eyedropperOf(layout.widget)?.tier === 'unavailable' };
		paintPicker(ctx, layout, { colour: picker.colour, hex: this.host.stateOf(layout.widget).text, old: picker.old, oldAlpha: picker.oldAlpha, lit: picker.lit, name: picker.name, terms, bar: picker.bar, space: picker.space, field: picker.field, dropper }, wheel);
		this.host.popoverPainted(resized);
	}

	/**
	 * Takes a colour onto a colour widget, from its picker or its keys: the
	 * value is written as `formatColour` writes a colour, its alpha held to a
	 * byte first, so one within half a byte of 1 is written as none. Where
	 * the text changed, `change` is told and the host paints the widget again,
	 * the open picker with it as it is laid out again (`relay`); where it
	 * did not, the open picker alone is painted again, since its terms can
	 * move where the bytes do not, as a grey's hue does. A field of the picker
	 * holding the page's input shows the colour as it now stands, unless the
	 * colour is the field's own typing.
	 *
	 * @param typed - Whether the colour comes from the field holding the input
	 */
	private takeColour(widget: ColourWidget, rgb: Rgb, alpha: number, typed = false): void {
		const state = this.host.stateOf(widget);
		const hex = formatColour({ r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255, a: widget.alpha ? Math.round(alpha * 255) / 255 : 1 });
		const changed = state.text !== hex;
		if (changed) {
			state.text = hex;
			this.host.invalidate();
		}
		const picker = this.popover;
		if (picker && picker.layout.widget === widget) {
			picker.colour = rgb;
			picker.name = ColourPicker.namedIndex(rgb);
			if (!changed) this.paintThePicker();
			if (!typed) this.showField(picker);
		}
		if (changed) this.host.tell(widget, 'change');
	}

	/** Sets the colour at a point of a region a press follows, in the popover's own pixels, through the picker's maths; false for a region that sets none there. */
	private setPickerAt(region: Region, x: number, y: number): boolean {
		const picker = this.popover;
		if (!picker) return false;
		const at = colourAtRegion(picker.layout, region, x, y, picker.terms, picker.colour, picker.space);
		if (!at) return false;
		picker.terms = at.terms;
		if (region.kind === 'bar') picker.bar = region.index;
		this.takeColour(picker.layout.widget, at.colour, at.terms.alpha);
		return true;
	}

	/**
	 * Hands a click on the open picker to the region under it: the
	 * eyedropper acts by what it picks from (`dropperClicked`), and a click
	 * anywhere else puts an armed one away, and the tooltip a click pinned
	 * open, the tooltip's own click doing nothing more; the ring, the
	 * triangle, the square, the hue strip and the bars set the colour at the
	 * point, as a press does, so a click alone sets it, unless the click
	 * follows a press that set it there already; a tab switches the mode,
	 * the terms read afresh from the colour, and is the mode every picker on
	 * every host opens in from then on; the dock button is the host's, which
	 * pops the picker out or docks it back; the close shuts the picker, the
	 * colour kept as it stands; a named cell and a swatch take their colour;
	 * the old half restores the colour the picker opened on; the space word
	 * cycles the colour space the channel fields and the bars read the
	 * colour in, a channel field holding the page's input rewritten in the
	 * space's units, the colour Escape puts back kept. A field does nothing
	 * on a click: it takes the page's input as a press on it is released.
	 *
	 * @param uv - Where the click landed on the popover's plane
	 * @param pressed - Whether the click follows a press that set the colour at its point
	 */
	private clickPicker(uv: Uv, pressed: boolean): void {
		const picker = this.popover;
		if (!picker) return;
		const { box, widget } = picker.layout;
		if (this.host.stateOf(widget).disabled) return;
		const x = uv.x * box.w;
		const y = (1 - uv.y) * box.h;
		const region = pickerRegionAt(picker.layout, x, y, picker.terms.unit, this.tipShown(picker));
		// A click anywhere on the picker but the eyedropper puts an armed one away, or the tooltip a click pinned open, as a press there does, and then works as ever: one on the tooltip, which its press left standing, or from a host that clicks without pressing.
		if ((picker.dropper.armed || picker.dropper.pinned) && region?.kind !== 'dropper') this.putDropperAway();
		if (!region) return;
		switch (region.kind) {
			case 'dropper':
				this.dropperClicked(picker);
				return;
			case 'tip':
				return;
			case 'tab':
				chosenMode = picker.layout.tabs[region.index].mode;
				this.switchMode(chosenMode);
				break;
			case 'dock':
				this.host.dockClicked?.();
				break;
			case 'close':
				this.close();
				break;
			case 'old':
				picker.terms = termsKeeping(picker.old, picker.oldAlpha, picker.terms);
				this.takeColour(widget, picker.old, picker.oldAlpha);
				break;
			case 'space':
				picker.space = COLOUR_SPACES[(COLOUR_SPACES.indexOf(picker.space) + 1) % COLOUR_SPACES.length];
				if (picker.field?.kind === 'channel') this.rewriteField(picker);
				this.paintThePicker();
				break;
			default:
				if (!pressed) this.setPickerAt(region, x, y);
		}
	}

	/** Switches the open picker to a mode, the colour's terms read afresh from the colour, a grey keeping the hue, and lays it out and paints it again, as far from where its layout stands it as it was carried. */
	private switchMode(mode: PickerMode): void {
		const picker = this.popover;
		if (!picker || picker.mode === mode) return;
		const laid = this.host.laidOf(picker.layout.widget);
		if (!laid) return;
		picker.mode = mode;
		picker.terms = termsKeeping(picker.colour, picker.terms.alpha, picker.terms);
		picker.layout = carriedBy(this.layoutOf(laid, mode), picker.offset);
		this.host.placePopover(picker.layout.box);
		this.paintThePicker();
	}

	/**
	 * Carries the open picker to stand with its top-left corner at a point,
	 * in the host's pixels, kept as far from where its layout stands it as
	 * it is laid out again, until it shuts: the host places its plane there
	 * at once, on the side of its colour it stood on as the carry began.
	 */
	private carryPicker(x: number, y: number): void {
		const picker = this.popover;
		if (!picker) return;
		const stood = this.host.standing(picker.layout.box).side;
		if (!picker.side && stood) picker.side = stood.side;
		const { box } = picker.layout;
		picker.offset = { x: picker.offset.x + x - box.x, y: picker.offset.y + y - box.y };
		picker.layout = { ...picker.layout, box: { ...box, x, y } };
		this.host.placePopover(picker.layout.box);
	}

	/** Reads the open picker's colour and terms afresh from what its widget holds, as a script writes the value, a grey keeping the hue; the write paints the widget again, and the picker with it as it is laid out again (`relay`). */
	private syncPicker(): void {
		const picker = this.popover;
		if (!picker) return;
		const { rgb, alpha } = this.colourOf(picker.layout.widget);
		picker.colour = rgb;
		picker.terms = termsKeeping(rgb, alpha, picker.terms);
		picker.name = ColourPicker.namedIndex(rgb);
		this.showField(picker);
	}

	/** Lights the region of the open picker under the pointer, painted again only where that changed. */
	private lightPicker(region: Region | null): void {
		const picker = this.popover;
		if (!picker || sameRegion(picker.lit, region)) return;
		picker.lit = region;
		this.paintThePicker();
	}

	/**
	 * What a key does on a focused colour: shut, Enter and Space open the
	 * picker; open, Enter and Space shut it keeping the colour, Escape puts
	 * an armed eyedropper away, or the browser's open one, and otherwise
	 * restores the colour it opened on and shuts it, Shift with Page Up or
	 * Page Down steps the alpha by a twentieth where the colour carries one,
	 * and the rest follow the mode. In wheel Left and Right turn the hue a
	 * degree round the ring, Up and Down move the intensity a hundredth, Page
	 * Up and Page Down the saturation a tenth, Home and End to none and full,
	 * Shift making an arrow's step ten. In square Left and Right move the
	 * saturation a hundredth, Up and Down the value, Page Up and Page Down
	 * turn the hue ten degrees, Home and End set the saturation to none and
	 * full, Shift making an arrow's step ten. In sliders Left and Right move
	 * to the bar before or after, Up and Down step its channel by 1, Page Up
	 * and Page Down by 16, Home and End set it to its least and most, the
	 * alpha's bar stepping a hundredth and a tenth, Shift making an arrow's
	 * step ten. In names the arrows move through the cells, Up and Down along
	 * a column and Left and Right between the two, Home and End to the first
	 * and the last, each taking its colour at once.
	 * An Escape on a shut picker is left to the input, which lets the focus
	 * go.
	 */
	private pickerKey(widget: ColourWidget, event: KeyboardEvent): boolean {
		const picker = this.openColor === widget ? this.popover as OpenPicker : null;
		const { key } = event;
		if (!picker) {
			if (key !== 'Enter' && key !== ' ') return false;
			this.openPicker(widget);
			return true;
		}
		if (key === 'Enter' || key === ' ') {
			this.close();
			return true;
		}
		// Escape puts an armed eyedropper, the browser's open one, or the tooltip a click pinned open, away, and leaves the picker and its colour as they stand.
		if (key === 'Escape' && (picker.dropper.armed || picker.dropper.abort || picker.dropper.pinned)) {
			this.putDropperAway();
			return true;
		}
		if (key === 'Escape') {
			picker.terms = termsKeeping(picker.old, picker.oldAlpha, picker.terms);
			this.takeColour(widget, picker.old, picker.oldAlpha);
			this.close();
			return true;
		}
		if (event.shiftKey && (key === 'PageUp' || key === 'PageDown') && widget.alpha) {
			// On the twentieths, so the steps do not drift.
			picker.terms = { ...picker.terms, alpha: clamp(Math.round(picker.terms.alpha * 20 + (key === 'PageUp' ? 1 : -1)) / 20, 0, 1) };
			this.takeColour(widget, picker.colour, picker.terms.alpha);
			return true;
		}
		const by = event.shiftKey ? 10 : 1;
		switch (picker.mode) {
			case 'names': return this.namesKey(picker, key);
			case 'square': return this.squareKey(picker, key, by);
			case 'sliders': return this.slidersKey(picker, key, by);
			default: return this.wheelKey(picker, key, by);
		}
	}

	/** The wheel's keys: the hue turned, the intensity and the saturation stepped, the colour the triangle gives taken; false for a key that is none of them. */
	private wheelKey(picker: OpenPicker, key: string, by: number): boolean {
		const was = picker.terms;
		let terms: PickerTerms;
		switch (key) {
			case 'ArrowLeft':
			case 'ArrowRight': {
				// Round the ring in degrees, clockwise in screen axes, wrapped into
				// -180 to 180 at the ring's leftmost point, which reads as -180.
				const degree = Math.atan2(was.unit[1], was.unit[0]) * 180 / Math.PI + (key === 'ArrowRight' ? by : -by);
				const wrapped = ((degree + 180) % 360 + 360) % 360 - 180;
				const radians = wrapped * Math.PI / 180;
				terms = { ...was, unit: [Math.cos(radians), Math.sin(radians)], hue: hueOfAngle(wrapped) };
				break;
			}
			case 'ArrowUp':
			case 'ArrowDown':
				terms = { ...was, intensity: clamp(was.intensity + (key === 'ArrowUp' ? by : -by) / 100, 0, 1) };
				break;
			case 'PageUp':
			case 'PageDown':
				terms = { ...was, saturation: clamp(was.saturation + (key === 'PageUp' ? 1 : -1) / 10, 0, 1) };
				break;
			case 'Home':
			case 'End':
				terms = { ...was, saturation: key === 'Home' ? 0 : 1 };
				break;
			default:
				return false;
		}
		const moved = withSquare(terms);
		picker.terms = moved;
		this.takeColour(picker.layout.widget, termsColour(moved), moved.alpha);
		return true;
	}

	/** The square's keys: the saturation and the value stepped, the hue turned, the colour the square gives taken; false for a key that is none of them. */
	private squareKey(picker: OpenPicker, key: string, by: number): boolean {
		const was = picker.terms.square;
		let square: Hsv;
		switch (key) {
			case 'ArrowLeft':
			case 'ArrowRight':
				square = { ...was, s: clamp(was.s + (key === 'ArrowRight' ? by : -by) / 100, 0, 1) };
				break;
			case 'ArrowUp':
			case 'ArrowDown':
				square = { ...was, v: clamp(was.v + (key === 'ArrowUp' ? by : -by) / 100, 0, 1) };
				break;
			case 'PageUp':
			case 'PageDown':
				// Round the strip, wrapped from its top to its foot.
				square = { ...was, h: ((was.h + (key === 'PageUp' ? 10 : -10)) % 360 + 360) % 360 };
				break;
			case 'Home':
			case 'End':
				square = { ...was, s: key === 'Home' ? 0 : 1 };
				break;
			default:
				return false;
		}
		picker.terms = termsAtSquare(picker.terms, square);
		this.takeColour(picker.layout.widget, squareColour(square), picker.terms.alpha);
		return true;
	}

	/**
	 * The sliders' keys: Left and Right move to the bar before or after,
	 * painted as the one acted on; the rest step the bar's channel in the
	 * space's units, held to its range, or the alpha's, on the hundredths
	 * held to 0..1, and take the colour. False for a key that is none of
	 * them.
	 */
	private slidersKey(picker: OpenPicker, key: string, by: number): boolean {
		const count = picker.layout.bars.length;
		if (key === 'ArrowLeft' || key === 'ArrowRight') {
			const to = clamp(picker.bar + (key === 'ArrowRight' ? 1 : -1), 0, count - 1);
			if (to !== picker.bar) {
				picker.bar = to;
				this.paintThePicker();
			}
			return true;
		}
		let step: number;
		switch (key) {
			case 'ArrowUp': step = by; break;
			case 'ArrowDown': step = -by; break;
			case 'PageUp': step = 16; break;
			case 'PageDown': step = -16; break;
			case 'Home': step = -Infinity; break;
			case 'End': step = Infinity; break;
			default: return false;
		}
		const widget = picker.layout.widget;
		if (picker.bar === 3) {
			// In hundredths, a page a tenth, so the steps do not drift.
			const pages = key === 'PageUp' || key === 'PageDown' ? Math.sign(step) * 10 : step;
			const alpha = clamp(Math.round(picker.terms.alpha * 100 + pages) / 100, 0, 1);
			picker.terms = { ...picker.terms, alpha };
			this.takeColour(widget, picker.colour, alpha);
			return true;
		}
		const now = channelsOf(picker.space, picker.colour, picker.terms)[picker.bar];
		const at = termsWithChannel(picker.space, picker.bar, clamp(now + step, 0, CHANNELS[picker.space][picker.bar]), picker.terms, picker.colour);
		picker.terms = at.terms;
		this.takeColour(widget, at.colour, at.terms.alpha);
		return true;
	}

	/**
	 * The names' keys: the cell pointed at moved along its column, across to
	 * the other column, or to either end, its colour taken at once; where the
	 * colour is none of the cells, an arrow takes the first, as a list's
	 * arrows point at its first choice where none is pointed at. False for a
	 * key that is none of them.
	 */
	private namesKey(picker: OpenPicker, key: string): boolean {
		const count = SWATCHES.length;
		const column = Math.ceil(count / 2);
		const from = picker.name;
		const arrow = (moved: number): number => (from < 0 ? 0 : moved);
		let to: number;
		switch (key) {
			case 'ArrowUp': to = arrow(from % column > 0 ? from - 1 : from); break;
			case 'ArrowDown': to = arrow(from % column < column - 1 ? from + 1 : from); break;
			case 'ArrowLeft': to = arrow(from >= column ? from - column : from); break;
			case 'ArrowRight': to = arrow(from < column ? from + column : from); break;
			case 'Home': to = 0; break;
			case 'End': to = count - 1; break;
			default: return false;
		}
		const swatch = SWATCHES[clamp(to, 0, count - 1)];
		picker.terms = termsKeeping(swatch.rgb, picker.terms.alpha, picker.terms);
		this.takeColour(picker.layout.widget, [...swatch.rgb], picker.terms.alpha);
		return true;
	}

	// ---------------------------------------------------------------------
	// The picker's fields, which take the page's input in turn
	// ---------------------------------------------------------------------

	/** The widget's open picker while one of its fields holds the page's input; null otherwise. */
	private fieldPicker(widget: ColourWidget): OpenPicker | null {
		const picker = this.popover;
		return picker && picker.layout.widget === widget && picker.field ? picker : null;
	}

	/**
	 * Hands the page's input between a picker's body and one of its fields:
	 * the input blurs its host as its kind changes, and that blur reaches
	 * `onBlur` under the hand-off mark, which leaves the picker open and the
	 * widget focused.
	 */
	private handOff(kind: InputKind, words: string): void {
		this.handingOff = true;
		try {
			const own = this.host.fieldInput ?? null;
			if (kind === 'field' && own) own.focus('field', words, this.host.inputHost);
			else {
				// Back from the host's own field input to the page's, which the colour kept.
				if (own?.focused) own.blur();
				pageInput().focus(kind, words, this.host.inputHost);
			}
		} finally {
			this.handingOff = false;
		}
	}

	/** The input the picker's fields are typed through: the host's own (`fieldInput`), or the page's. */
	private get fieldInput(): PageInput {
		return this.host.fieldInput ?? pageInput();
	}

	/** Lets the input go from the colour and its fields, as Tab past the last field does where the host has nothing after it: the host's own field input let go first, as a hand-off, then the page's. */
	private letInputGo(): void {
		this.handingOff = true;
		try {
			this.host.fieldInput?.blur();
		} finally {
			this.handingOff = false;
		}
		pageInput().blur();
	}

	/** The words a field of the open picker shows as the colour stands. */
	private fieldWords(picker: OpenPicker, region: Region): string {
		return fieldText(region, picker.space, this.host.stateOf(picker.layout.widget).text, picker.colour, picker.terms);
	}

	/**
	 * Gives one of the open picker's fields the page's input, as an input's
	 * field: shown over the field's box with its words, typed into and worked
	 * by key (`fieldKey`). The colour widget stays the focused widget, and
	 * the colour as the field is entered is kept for Escape to put back. The
	 * field already holding the input is left as it is, its words as typed.
	 */
	private focusField(region: Region): void {
		const picker = this.popover;
		if (!picker || !fieldBox(picker.layout, region) || sameRegion(picker.field, region)) return;
		const widget = picker.layout.widget;
		if (this.host.focused !== widget) this.host.focus(widget);
		picker.field = region;
		picker.typed = this.fieldWords(picker, region);
		picker.entered = { colour: picker.colour, terms: picker.terms };
		this.handOff('field', picker.typed);
		this.paintThePicker();
	}

	/** Returns the page's input from a field to the picker's body, out of sight again, the field painted with its words. */
	private focusBody(): void {
		const picker = this.popover;
		if (!picker) return;
		picker.field = null;
		picker.typed = '';
		picker.entered = null;
		this.handOff('colour', this.host.stateOf(picker.layout.widget).text);
		this.paintThePicker();
	}

	/** Takes the page's input back from a field as the picker shuts under it, where the colour still holds the focus: out of sight again, as a colour's is. */
	private takeBack(widget: ColourWidget): void {
		if (pageInputMade()?.focusedHost === this.host.inputHost && this.host.focused === widget) this.handOff('colour', this.host.stateOf(widget).text);
	}

	/** Writes a field's words as the colour stands into the page's input, over whatever was typed. */
	private rewriteField(picker: OpenPicker): void {
		if (!picker.field) return;
		picker.typed = this.fieldWords(picker, picker.field);
		this.fieldInput.setValue(picker.typed);
	}

	/** Writes a field's words into the page's input as the colour moves under it from outside the field, the colour as it now stands the one Escape puts back. */
	private showField(picker: OpenPicker): void {
		if (!picker.field) return;
		this.rewriteField(picker);
		picker.entered = { colour: picker.colour, terms: picker.terms };
	}

	/**
	 * Applies a field's words to the colour where they read: the hex as
	 * `parseColour` reads it, with or without its #, as it is typed once it
	 * is six digits, or eight on a colour with alpha, and in any form it
	 * reads as on Enter; a channel as a whole number held to its range in the
	 * space (`readChannel`); the alpha in percent. Words that read as none
	 * change nothing, and stay in the field.
	 *
	 * @param whole - Whether the words are taken as they stand, on Enter or a step; false as they are typed
	 * @returns Whether a colour was applied
	 */
	private applyField(picker: OpenPicker, text: string, whole: boolean): boolean {
		const field = picker.field;
		if (!field) return false;
		const widget = picker.layout.widget;
		switch (field.kind) {
			case 'hex': {
				const colour = parseColour(text);
				if (!colour) return false;
				const digits = text.trim().replace(/^#/, '').length;
				if (!whole && digits !== 6 && !(digits === 8 && widget.alpha)) return false;
				const rgb: Rgb = [Math.round(colour.r * 255), Math.round(colour.g * 255), Math.round(colour.b * 255)];
				const alpha = widget.alpha ? colour.a : 1;
				picker.terms = termsKeeping(rgb, alpha, picker.terms);
				this.takeColour(widget, rgb, alpha, true);
				return true;
			}
			case 'channel': {
				const value = readChannel(text, CHANNELS[picker.space][field.index]);
				if (value === null) return false;
				const at = termsWithChannel(picker.space, field.index, value, picker.terms, picker.colour);
				picker.terms = at.terms;
				this.takeColour(widget, at.colour, at.terms.alpha, true);
				return true;
			}
			case 'alphaField': {
				const value = readChannel(text, 100);
				if (value === null) return false;
				picker.terms = { ...picker.terms, alpha: value / 100 };
				this.takeColour(widget, picker.colour, picker.terms.alpha, true);
				return true;
			}
			default:
				return false;
		}
	}

	/**
	 * A key in one of the picker's fields: Tab moves to the field after,
	 * and past the last out to the host's next field, which shuts the
	 * picker, or lets the focus go past the host's last; Shift and Tab to
	 * the field before, and from the hex back to the picker's body; Enter
	 * applies the words as they stand and returns to the body; Escape puts
	 * back the colour the field was entered on, or as the picker last moved
	 * it from outside the field, and returns; Up and Down step a channel or
	 * the alpha by 1, Shift by 10, held to its range. Every other key is the
	 * field's own.
	 */
	private fieldKey(picker: OpenPicker, event: KeyboardEvent): boolean {
		const field = picker.field!;
		const widget = picker.layout.widget;
		switch (event.key) {
			case 'Tab': {
				const chain = fieldChain(picker.layout);
				const to = chain.findIndex((each) => sameRegion(each, field)) + (event.shiftKey ? -1 : 1);
				if (to < 0) this.focusBody();
				else if (to < chain.length) this.focusField(chain[to]);
				else if (!this.host.focusAfter(widget)) this.letInputGo();
				return true;
			}
			case 'Enter':
				this.applyField(picker, picker.typed, true);
				this.focusBody();
				return true;
			case 'Escape': {
				const entered = picker.entered;
				if (entered) {
					picker.terms = entered.terms;
					this.takeColour(widget, entered.colour, entered.terms.alpha, true);
				}
				this.focusBody();
				return true;
			}
			case 'ArrowUp':
			case 'ArrowDown': {
				if (field.kind === 'hex') return false;
				const by = (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1);
				const most = field.kind === 'alphaField' ? 100 : CHANNELS[picker.space][field.index];
				const value = String(clamp(Number(this.fieldWords(picker, field)) + by, 0, most));
				picker.typed = value;
				this.fieldInput.setValue(value);
				this.applyField(picker, value, true);
				return true;
			}
			default:
				return false;
		}
	}
}
