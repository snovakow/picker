// @vitest-environment jsdom
/**
 * @fileoverview A colour's picker on its host: each case on a stand-in for a
 * host that draws the colour and its picker on planes in a 3D scene, as a VR
 * host does (`TestPanel`), holding the colour, its plane and the picker's
 * standing on it, pressed, moved, released, clicked and hovered, and the
 * page's input handed to it. The picker is opened in the mode last chosen on
 * any picker's tabs, pressed, dragged, carried, clicked, keyed and shut, its
 * wheel's renderer a stand-in for WebGL's that records each draw, whose
 * context the case may give later, with the renderer each paint asked for
 * recorded, its painter its own recording the eyedropper each paint draws,
 * and its fields given the page's input in turn, typed into, stepped,
 * walked by Tab and left.
 * jsdom has no 2D context, so a canvas is given one that does nothing, every
 * measure 0. The stand-in host stands the picker at the box it is laid out
 * at, moving it nowhere (`standing`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Every draw the wheel's renderer was asked for: the geometry and the colour's terms. */
const wheelDraws = vi.hoisted(() => [] as { width: number; height: number; size: number; ratio: number; hue: number[]; base: number[]; saturation: number; intensity: number }[]);

/** The WebGL stand-ins made, each with what it tells as its context comes or goes, and whether the next is made waiting for its context. */
const glStandIn = vi.hoisted(() => ({ waits: false, made: [] as { ready: boolean; events: { ready(): void; lost(): void } }[] }));

// jsdom has no WebGL: the renderer alone is replaced by one that records
// what it is asked to draw, and the wheel's maths stay the module's own.
vi.mock('./wheelWebGL.ts', () => ({
	makeWebGLWheel: (canvas: HTMLCanvasElement, events: { ready(): void; lost(): void }) => {
		const made = {
			canvas,
			ready: !glStandIn.waits,
			events,
			draw: (geometry: { width: number; height: number; size: number; ratio: number }, terms: { hue: number[]; base: number[]; saturation: number; intensity: number }) => {
				wheelDraws.push({ width: geometry.width, height: geometry.height, size: geometry.size, ratio: geometry.ratio, hue: [...terms.hue], base: [...terms.base], saturation: terms.saturation, intensity: terms.intensity });
				return true;
			},
		};
		glStandIn.made.push(made);
		return made;
	},
}));

/** The renderer each paint of the picker asked its wheel of. */
const rendererAsks = vi.hoisted(() => [] as string[]);

// What draws the wheel stays the module's own, each renderer asked for recorded.
vi.mock('./renderer.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./renderer.ts')>();
	return {
		...actual,
		wheelImage: (...args: Parameters<typeof actual.wheelImage>) => {
			rendererAsks.push(args[0]);
			return actual.wheelImage(...args);
		},
	};
});

/** The eyedropper as each paint of the picker drew it: armed, its tooltip shown, and unavailable. */
const dropperPaints = vi.hoisted(() => [] as { armed: boolean; tip: boolean; unavailable: boolean }[]);

// The picker's painter stays the module's own, each eyedropper it is asked to draw recorded.
vi.mock('./pickerView.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./pickerView.ts')>();
	return {
		...actual,
		paintPicker: (...args: Parameters<typeof actual.paintPicker>) => {
			dropperPaints.push({ ...args[2].dropper });
			actual.paintPicker(...args);
		},
	};
});

import { ColourPicker, forgetChosenMode, type Eyedropper, type PickerHost } from './colourPicker.ts';
import { forgetRenderers, type Renderer } from './renderer.ts';
import { DRAGGED_REGIONS, DROPPER_TIPS, barShare, channelsOf, pickerRegionAt, wheelGeometryOf, type DockButton, type PickerLayout } from './pickerView.ts';
import { readColourOptions, swatchesOf, type ColourOptions, type ColourWidget, type WidgetEvent } from './options.ts';
import { pageInput, pageInputMade, resetPageInput, type InputHost, type InputLook } from './input.ts';
import { PALETTE, fieldLine, fieldRadius, fontFamilies } from './paint.ts';
import { CONTROL, inBox, layoutWell, restingState, type Box, type Laid, type WidgetState } from './layout.ts';
import { cssColour } from './options.ts';
import { formatColour, parseColour } from './hex.ts';
import { SWATCHES, hsvToRgb, rgbToHsv } from './colour.ts';
import { hueOfAngle, saturatedOf, triangleColour, triangleOf, type Rgb } from './wheel.ts';

/** A context every call on which does nothing, its measures all 0, and its gradients a stop that takes none. */
const inertContext = () => new Proxy<Record<string | symbol, unknown>>({ globalAlpha: 1 }, {
	get: (held, key) => (key in held ? held[key] : key === 'measureText' ? () => ({ width: 0 }) : key === 'createLinearGradient' ? () => ({ addColorStop: () => { } }) : () => { }),
	set: (held, key, value) => {
		held[key] = value;
		return true;
	},
});

beforeEach(() => {
	dropperPaints.length = 0;
	rendererAsks.length = 0;
	wheelDraws.length = 0;
	forgetRenderers();
	glStandIn.waits = false;
	glStandIn.made.length = 0;
	// Cast to never: the spy is typed by getContext's last overload, which WebGPU's types make WebGPU's.
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => inertContext() as never);
});

afterEach(() => {
	for (const panel of panels) panel.dispose();
	forgetChosenMode();
	resetPageInput();
	vi.restoreAllMocks();
});

/** A point of a plane, as a `Uv` is: across from its left and up from its foot. */
class Vector2 {
	x: number;
	y: number;
	constructor(x: number, y: number) {
		this.x = x;
		this.y = y;
	}
}

/** A plane a test hits: the stand-in host's, or the popover's, shown or not. */
interface Plane {
	visible: boolean;
}

/** Every stand-in host made and not yet let go, so the picker of every host but one can be shut as a press elsewhere shuts them. */
const panels = new Set<TestPanel>();

/** Shuts the open picker of every stand-in host but one, as a press elsewhere on the page shuts a well's. */
const closeOtherPickers = (except: TestPanel | null = null): void => {
	for (const panel of panels) {
		if (panel !== except) panel.closePicker();
	}
};

/** The colour widget a stand-in host holds, with the id the host names it by. */
type Hosted = ColourWidget & { id: string };

/** The stand-in host's own view, which the eyedropper picks from as a 3D host's scene: the host takes the presses on it and hands the picker the colour under them. */
const OWN_VIEW = { scene: 'the stand-in host\'s own' };

/** A widget of the stand-in host beside its colour, which a press and a click land on: where it stands, and whether it is a field the focus walks to by Tab. */
interface Other {
	id: string;
	box: Box;
	field?: boolean;
}

/**
 * A stand-in host holding one colour among other widgets, which hosts the
 * colour's picker as a host does (`PickerHost`): as a host in a 3D scene or
 * in VR does, it draws the colour on a plane of its own and the picker on
 * another, and hands the picker the points a ray hits on them; the picker
 * stands on the host, its plane hit within the box it is laid out at, the
 * host's pixels from its top-left corner, and every call on it is made in
 * the order a host keeps (colourPicker.ts). Its other widgets take a press
 * and a click as widgets the colour is not, telling `click`; a field among
 * them is walked to by Tab.
 */
class TestPanel implements PickerHost, InputHost {
	readonly mesh: Plane = { visible: true };
	readonly popoverMesh: Plane = { visible: false };
	readonly widget: Hosted;
	readonly width: number;
	readonly height: number;
	readonly resolution: number;
	readonly measure = (): number => 0;
	onEvent: ((widget: string, event: string) => void) | null = null;
	/** The eyedropper it sets: by default one that picks from its own view, as a 3D host's scene, whose presses it takes itself and hands the colour under them to the picker (`takeDropped`). */
	eyedropper: Eyedropper<object> = { mode: 'view', view: OWN_VIEW };
	/** What the picker's wheel is drawn by, as a scene's own renderer would have it; left unset, WebGL. */
	renderer: Renderer | undefined = undefined;
	/** The dock button it has the picker show, none by default, and how many times it was clicked. */
	dockButton: DockButton | null = null;
	dockClicks = 0;
	private readonly state: WidgetState;
	/** Where the host lays its colour out, and whether it shows it. */
	private readonly at: { x: number; y: number };
	private hidden = false;
	private readonly others: readonly Other[];
	private readonly picker: ColourPicker;
	private laid: Laid;
	private dirty = false;
	private focusedOne: ColourWidget | null = null;
	private held: { kind: 'picker' | 'field' | 'other'; moved: boolean } | null = null;
	private popoverBox: Box | null = null;
	/** The widgets the pointer is on, the innermost first, as last told. */
	private hoveredIds: string[] = [];

	constructor({ id = 'c', x = 0, y = 0, ...options }: ColourOptions & { id?: string; x?: number; y?: number }, others: readonly Other[], width: number, height: number, resolution = 2) {
		this.widget = { ...readColourOptions(options), id };
		this.at = { x, y };
		this.state = restingState(this.widget);
		this.others = others;
		this.width = width;
		this.height = height;
		this.resolution = resolution;
		this.laid = this.lay();
		this.picker = new ColourPicker(this);
		panels.add(this);
	}

	private lay(): Laid {
		return layoutWell(this.widget, this.state, this.measure, this.at);
	}

	get layout(): { byId: Map<string, Laid> } {
		return { byId: new Map([[this.widget.id, this.laid]]) };
	}

	get openColor(): Hosted | null {
		return this.picker.openColor as Hosted | null;
	}

	get focusedWidget(): Hosted | null {
		return this.focusedOne as Hosted | null;
	}

	get focused(): ColourWidget | null {
		return this.focusedOne;
	}

	get pressing(): boolean {
		return this.held !== null;
	}

	get carrying(): boolean {
		return this.picker.carrying;
	}

	get inputHost(): InputHost {
		return this;
	}

	stateOf(_widget?: ColourWidget): WidgetState {
		return this.state;
	}

	laidOf(widget: ColourWidget | null): Laid | null {
		return widget === this.widget && !this.hidden ? this.laid : null;
	}

	invalidate(): void {
		this.dirty = true;
	}

	tell(widget: ColourWidget, event: WidgetEvent): void {
		this.onEvent?.((widget as Hosted).id, event);
		this.onEvent?.('root', event);
	}

	placePopover(box: Box | null): void {
		this.popoverBox = box;
		this.popoverMesh.visible = box !== null;
	}

	standing(box: Box): { box: Box; side: null } {
		return { box, side: null };
	}

	popoverPainted(): void {
		// Nothing here is drawn from the picker's canvas.
	}

	closeOther(): void {
		// The stand-in host's one popover is the picker's: another host's is shut as the focus leaves it.
	}

	closePicker(): void {
		this.picker.close();
	}

	dropperOf(_widget: ColourWidget): Eyedropper<object> {
		return this.eyedropper;
	}

	/** Changes the eyedropper the stand-in host sets, the picker reading it afresh. */
	setEyedropper(eyedropper: Eyedropper<object>): void {
		this.eyedropper = eyedropper;
		this.picker.dropperChanged();
	}

	/** Changes what the picker's wheel is drawn by, the open picker painted again by it, as a host does. */
	setRenderer(renderer: Renderer | undefined): void {
		this.renderer = renderer;
		this.picker.relay();
	}

	/** Changes the dock button it has the picker show, the picker laid out again. */
	setDockButton(dock: DockButton | null): void {
		this.dockButton = dock;
		this.picker.relay();
	}

	dockClicked(): void {
		this.dockClicks++;
	}

	/** Whether the picker's eyedropper is armed on the host's view. */
	get dropping(): boolean {
		return this.picker.dropping();
	}

	/** A colour the host read off its view under the eyedropper's press, as a host's view hands one. */
	takeDropped(rgb: Rgb | null, done: boolean): void {
		this.picker.takeDropped(rgb, done);
	}

	/** Where the stand-in host last stood the picker's plane; null while it stands nowhere. */
	get stoodAt(): Box | null {
		return this.popoverBox;
	}

	dispose(): void {
		this.held = null;
		this.picker.forgetPress();
		this.picker.close();
		if (this.focusedOne) {
			const input = pageInputMade();
			if (input?.focusedHost === this) input.blur();
			else this.focusedOne = null;
		}
		panels.delete(this);
	}

	/** Paints the stand-in host again where something changed since it was last painted, the picker laid out again with it (`relay`), and lets the input go from a colour no longer laid out. */
	update(): void {
		if (this.dirty) {
			this.dirty = false;
			this.laid = this.lay();
			this.picker.relay();
		}
		if (this.focusedOne && !this.laidOf(this.focusedOne)) pageInputMade()?.blur();
	}

	private pixelsOf(uv: Vector2): { x: number; y: number } {
		return { x: uv.x * this.width, y: (1 - uv.y) * this.height };
	}

	/** A hit on the popover, or on the host's plane inside the box the picker stands at, as a point of the popover's plane; null for any other. */
	private popoverUv(object: Plane, uv: Vector2): Vector2 | null {
		if (!this.picker.openColor) return null;
		if (object === this.popoverMesh) return uv;
		if (object !== this.mesh || !this.popoverBox) return null;
		const { x, y } = this.pixelsOf(uv);
		const box = this.popoverBox;
		if (!inBox(box, x, y)) return null;
		return new Vector2((x - box.x) / box.w, 1 - (y - box.y) / box.h);
	}

	/** Whether a point of the host's plane lies on the open picker. */
	popoverAt(uv: Vector2): boolean {
		return this.picker.openColor !== null && this.popoverBox !== null && inBox(this.popoverBox, this.pixelsOf(uv).x, this.pixelsOf(uv).y);
	}

	private otherAt(x: number, y: number): Other | null {
		return this.others.find((other) => inBox(other.box, x, y)) ?? null;
	}

	press(object: Plane, uv: Vector2 | undefined): boolean {
		if (!uv) return false;
		this.picker.forgetPress();
		const onPopover = this.popoverUv(object, uv);
		if (onPopover) {
			this.picker.press(onPopover);
			this.held = { kind: 'picker', moved: false };
			return true;
		}
		if (object !== this.mesh) return false;
		const { x, y } = this.pixelsOf(uv);
		const onColour = !this.hidden && inBox(this.laid.box, x, y);
		if (this.picker.openColor && !onColour) this.picker.close();
		if (!onColour) {
			this.letFocusGo(null);
			if (!this.otherAt(x, y)) return false;
			this.held = { kind: 'other', moved: false };
			return true;
		}
		this.letFocusGo(this.widget);
		this.held = { kind: 'field', moved: false };
		return true;
	}

	move(x: number, y: number, moved: boolean): boolean {
		const held = this.held;
		if (!held) return false;
		if (moved) held.moved = true;
		if (held.kind === 'picker') return this.picker.move(x, y, moved);
		return held.moved;
	}

	release(x: number, y: number): boolean {
		const held = this.held;
		this.held = null;
		if (!held) return false;
		if (held.kind === 'picker') return this.picker.release(x, y);
		this.picker.forgetPress();
		if (held.kind === 'field' && !held.moved && !this.state.disabled && inBox(this.laid.box, x, y)) this.focus(this.widget);
		return held.moved;
	}

	cancel(): boolean {
		const held = this.held;
		this.held = null;
		if (held?.kind === 'picker') return this.picker.cancel();
		this.picker.forgetPress();
		return held?.moved ?? false;
	}

	pointAt(object: Plane, uv: Vector2 | undefined): void {
		if (!uv) return;
		const onPopover = this.popoverUv(object, uv);
		if (onPopover) {
			this.picker.click(onPopover);
			return;
		}
		this.picker.forgetPress();
		if (object !== this.mesh) return;
		const { x, y } = this.pixelsOf(uv);
		const onColour = !this.hidden && inBox(this.laid.box, x, y);
		if (this.picker.openColor && !onColour) this.picker.close();
		this.letFocusGo(onColour ? this.widget : null);
		if (!onColour) {
			const other = this.otherAt(x, y);
			if (other) {
				this.onEvent?.(other.id, 'click');
				this.onEvent?.('root', 'click');
			}
			return;
		}
		if (this.state.disabled) return;
		if (this.picker.openColor === this.widget) this.picker.close();
		else this.picker.open(this.widget);
		this.focus(this.widget);
		this.tell(this.widget, 'click');
	}

	hover(hit: { object: Plane; uv: Vector2 } | null): void {
		if (this.held) return;
		this.picker.forgetPress();
		const onPopover = hit ? this.popoverUv(hit.object, hit.uv) : null;
		if (onPopover) {
			this.picker.hover(onPopover);
			this.hoverAt([this.widget.id, 'root']);
			return;
		}
		this.picker.hover(null);
		if (!hit || hit.object !== this.mesh) {
			this.hoverAt([]);
			return;
		}
		const { x, y } = this.pixelsOf(hit.uv);
		const other = this.otherAt(x, y);
		this.hoverAt(inBox(this.laid.box, x, y) ? [this.widget.id, 'root'] : other ? [other.id, 'root'] : ['root']);
	}

	/** Draws the colour hovered or not, and tells each widget the pointer has gone off `leave` and then each it has come onto `enter`, innermost first. */
	private hoverAt(ids: string[]): void {
		const was = this.hoveredIds;
		this.hoveredIds = ids;
		const over = ids.includes(this.widget.id);
		if (over !== this.state.hovered) {
			this.state.hovered = over;
			this.invalidate();
		}
		for (const id of was) if (!ids.includes(id)) this.onEvent?.(id, 'leave');
		for (const id of ids) if (!was.includes(id)) this.onEvent?.(id, 'enter');
	}

	get(id: string, property: string): string | number | boolean | null {
		if (id !== this.widget.id) return null;
		switch (property) {
			case 'value': return this.state.text;
			case 'swatches': return (this.state.swatches ?? this.widget.swatches ?? []).join(' ');
			case 'enabled': return !this.state.disabled;
			case 'visible': return !this.hidden;
			default: return null;
		}
	}

	set(id: string, property: string, value: string | number | boolean): boolean {
		if (id !== this.widget.id) return false;
		switch (property) {
			case 'value': {
				// Held as a well's `setValue` holds a colour, its alpha dropped
				// where the colour carries none. Only text is a colour.
				const colour = typeof value === 'string' ? parseColour(value) : null;
				if (!colour) return false;
				const hex = formatColour(this.widget.alpha ? colour : { r: colour.r, g: colour.g, b: colour.b });
				if (this.state.text === hex) return true;
				this.state.text = hex;
				if (this.picker.openColor === this.widget) this.picker.sync();
				break;
			}
			case 'swatches':
				this.state.swatches = swatchesOf(String(value).split(/[\s,]+/).filter(Boolean), this.widget.alpha === true);
				break;
			case 'x':
			case 'y':
				if (typeof value !== 'number') return false;
				this.at[property] = value;
				break;
			case 'enabled':
				this.state.disabled = !value;
				if (!value) this.letGo();
				break;
			case 'visible':
				this.hidden = !value;
				if (!value) this.letGo();
				break;
			default:
				return false;
		}
		this.invalidate();
		return true;
	}

	/** Lets go what the colour held, as it is hidden or switched off: its focus, its picker, and a press on it. */
	private letGo(): void {
		if (this.focusedOne) pageInputMade()?.blur();
		this.picker.close();
		if (this.held) this.cancel();
	}

	private letFocusGo(except: ColourWidget | null): void {
		const input = pageInputMade();
		if (!input?.focused) return;
		if (except !== null && input.focusedHost === this && this.focusedOne === except) return;
		input.blur();
	}

	focus(widget: ColourWidget): void {
		const input = pageInput();
		if (this.focusedOne !== widget) {
			if (input.focused) input.blur();
			this.focusedOne = widget;
			this.state.focused = true;
			this.invalidate();
		} else if (this.picker.inField(widget)) {
			this.picker.returnToBody();
			return;
		}
		input.focus('colour', this.state.text, this);
	}

	/** Tab past the picker's last field: the stand-in host's next field after the colour, the first other widget that is a field, takes the focus, out of sight as the colour's does; none where it has no field. */
	focusAfter(widget: ColourWidget): boolean {
		const next = widget === this.widget ? this.others.find((other) => other.field) : undefined;
		if (!next) return false;
		const field: Hosted = { id: next.id, value: '#000000' };
		this.focus(field);
		return true;
	}

	onInput(value: string): void {
		const widget = this.focusedOne;
		if (!widget) return;
		this.picker.input(widget, value);
	}

	onKey(event: KeyboardEvent): boolean {
		const widget = this.focusedOne;
		if (!widget) return false;
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

	onBlur(): void {
		if (this.picker.handing) return;
		const widget = this.focusedOne;
		if (!widget) return;
		this.focusedOne = null;
		this.state.focused = false;
		if (this.picker.openColor === widget) this.picker.close();
		this.invalidate();
	}

	putAway(): boolean {
		if (!this.focusedOne || !this.picker.inField(this.focusedOne)) return false;
		this.picker.returnToBody();
		return true;
	}

	placement(): { object: Plane; width: number; height: number; box: Box; look: Omit<InputLook, 'scale'> } | null {
		const laid = this.laidOf(this.focusedOne);
		if (!laid) return null;
		const { style, face, inner } = laid;
		const field = this.picker.placement(laid.widget, style.opacity);
		if (field) return { object: this.popoverMesh, width: field.box.w, height: field.box.h, box: field.field, look: field.look };
		const line = fieldLine(laid);
		const look: Omit<InputLook, 'scale'> = {
			font: style.font,
			families: fontFamilies(style.font),
			color: cssColour(style.color),
			background: style.background ? cssColour(style.background) : PALETTE.field,
			accent: cssColour(style.accent),
			align: 'left',
			padX: inner.x - face.x,
			padY: inner.y - face.y,
			radius: fieldRadius(laid),
			line: line.width,
			lineColor: line.colour,
			opacity: style.opacity,
		};
		return { object: this.mesh, width: this.width, height: this.height, box: face, look };
	}
}

const W = 400;
const H = 300;

/** The colour and the widgets beside it the cases point at, in a 400 by 300 stand-in host. */
const AT = { go: [60, 30], sel: [85, 189], col: [145, 265] } as const;

/** The point of the host's plane, as a `Uv`, at a point of the host in its pixels. */
const uv = ([x, y]: readonly [number, number]) => new Vector2(x / W, 1 - y / H);

/** A stand-in host holding a colour at (100, 250), 90 by 30, and beside it a widget and a field Tab walks to, with what it tells recorded. */
const usable = () => {
	const panel = new TestPanel({ id: 'col', value: '#ff8b30', x: 100, y: 250, style: { width: 90, height: 30 } }, [{ id: 'go', box: { x: 10, y: 10, w: 100, h: 40 } }, { id: 'sel', box: { x: 10, y: 170, w: 150, h: 38 }, field: true }], W, H);
	const told: string[] = [];
	panel.onEvent = (widget, event) => { told.push(`${widget}:${event}`); };
	return { panel, told };
};

const press = (panel: TestPanel, at: readonly [number, number]) => panel.press(panel.mesh, uv(at));
const click = (panel: TestPanel, at: readonly [number, number]) => panel.pointAt(panel.mesh, uv(at));

describe('a colour\'s picker', () => {
	/** The picker as it is held open. */
	interface Open {
		mode: string;
		layout: PickerLayout;
		terms: { unit: [number, number]; hue: Rgb; saturation: number; intensity: number; square: { h: number; s: number; v: number }; hsl: { h: number; s: number; l: number }; alpha: number };
		colour: Rgb;
		lit: unknown;
		name: number;
		bar: number;
		space: string;
		field: { kind: string; index: number } | null;
		typed: string;
	}
	const pickerOf = (panel: TestPanel) => ((panel as unknown as { picker: { popover: Open | null } }).picker).popover;
	/** A press released unmoved on a point of the popover, in its own pixels, as a pointer's press and release are. */
	const pressRelease = (panel: TestPanel, at: readonly [number, number]) => {
		pressOn(panel, at);
		const { box } = pickerOf(panel)!.layout;
		panel.release(box.x + at[0], box.y + at[1]);
	};
	/** Words typed into the page's input as the browser types them: the value set, then the input event. */
	const typeWords = (words: string) => {
		const input = pageInput().input;
		input.value = words;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	};
	/** The point of the popover's plane, as a `Uv`, at a point of the popover in its own pixels. */
	const uvOn = (panel: TestPanel, [x, y]: readonly [number, number]) => {
		const { box } = pickerOf(panel)!.layout;
		return new Vector2(x / box.w, 1 - y / box.h);
	};
	const pressOn = (panel: TestPanel, at: readonly [number, number]) => panel.press(panel.popoverMesh, uvOn(panel, at));
	const clickOn = (panel: TestPanel, at: readonly [number, number]) => panel.pointAt(panel.popoverMesh, uvOn(panel, at));
	const hoverOn = (panel: TestPanel, at: readonly [number, number]) => panel.hover({ object: panel.popoverMesh, uv: uvOn(panel, at) });
	/** The held press moved to a point of the popover, in its own pixels, which may lie past it. */
	const moveOn = (panel: TestPanel, [x, y]: readonly [number, number]) => {
		const { box } = pickerOf(panel)!.layout;
		return panel.move(box.x + x, box.y + y, true);
	};
	/** A point of the wheel's square: the centre moved by a distance along an angle, clockwise from the right in screen axes. */
	const onWheel = (layout: PickerLayout, radius: number, degrees: number): [number, number] => {
		const wheel = layout.wheel!;
		const mid = wheel.w / 2;
		return [wheel.x + mid + radius * Math.cos(degrees * Math.PI / 180), wheel.y + mid + radius * Math.sin(degrees * Math.PI / 180)];
	};
	/** A point a share of the way from the wheel's centre to a corner of the triangle. */
	const towardCorner = (layout: PickerLayout, corner: [number, number], share: number): [number, number] => {
		const wheel = layout.wheel!;
		const geometry = wheelGeometryOf(wheel, 1);
		return [wheel.x + geometry.mid[0] + corner[0] * share * geometry.dim, wheel.y + geometry.mid[1] - corner[1] * share * geometry.dim];
	};
	const centre = (box: { x: number; y: number; w: number; h: number }): [number, number] => [box.x + box.w / 2, box.y + box.h / 2];
	const hex = (rgb: Rgb) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
	const key = (k: string, shiftKey = false) => pageInput().input.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
	/** A 400 by 500 stand-in host holding one colour at (10, 20), 200 wide, made from the options given, and another widget beside it. */
	const coloured = (options: ColourOptions) => {
		const panel = new TestPanel({ id: 'c', value: '#ff8b30', x: 10, y: 20, style: { width: 200 }, ...options }, [{ id: 'go', box: { x: 300, y: 450, w: 32, h: CONTROL.height } }], W, 500);
		const told: string[] = [];
		panel.onEvent = (widget, event) => { told.push(`${widget}:${event}`); };
		const at = panel.layout!.byId.get('c')!.face;
		const open = () => panel.pointAt(panel.mesh, new Vector2((at.x + at.w / 2) / W, 1 - (at.y + at.h / 2) / 500));
		return { panel, told, open };
	};
	const ORANGE: Rgb = [255, 139, 48];

	it('opens on the click, its plane standing where it is laid out and nowhere while shut, and shuts on a second click, a press elsewhere, another host\'s focus and Escape, which keeps the colour as it stands', () => {
		const { panel, told } = usable();
		const col = panel.layout!.byId.get('col')!.widget;
		click(panel, AT.col);
		expect(panel.openColor).toBe(col);
		expect(panel.popoverMesh.visible).toBe(true);
		expect(panel.stateOf(col).open).toBe(true);
		expect(panel.focusedWidget).toBe(col);
		expect(pageInput().input.readOnly).toBe(true);
		expect(told).toEqual(['col:click', 'root:click']);
		const { box } = pickerOf(panel)!.layout;
		// Above the field and past the host's top edge: neither side has the room, and there is more above.
		expect(box).toEqual({ x: 100, y: 250 - 308, w: 288, h: 308 });
		expect(panel.popoverAt(uv([150, 100]))).toBe(true);
		expect(panel.popoverAt(uv(AT.go))).toBe(false);
		click(panel, AT.col);
		expect(panel.openColor).toBeNull();
		expect(panel.popoverMesh.visible).toBe(false);
		expect(panel.stateOf(col).open).toBe(false);
		expect(panel.popoverAt(uv([150, 100]))).toBe(false);
		expect(panel.focusedWidget).toBe(col);
		click(panel, AT.col);
		press(panel, AT.go);
		panel.release(...AT.go);
		expect(panel.openColor).toBeNull();
		click(panel, AT.col);
		const other = usable().panel;
		click(other, AT.col);
		expect(panel.openColor).toBeNull();
		expect(other.openColor?.id).toBe('col');
		click(panel, AT.col);
		closeOtherPickers(panel);
		expect(panel.openColor).toBe(col);
		closeOtherPickers();
		expect(panel.openColor).toBeNull();
		click(panel, AT.col);
		told.length = 0;
		pressOn(panel, onWheel(pickerOf(panel)!.layout, 81, 120));
		panel.release(0, 0);
		const set = panel.get('col', 'value');
		expect(set).not.toBe('#ff8b30');
		expect(told).toEqual(['col:change', 'root:change']);
		key('Escape');
		expect(panel.get('col', 'value')).toBe(set);
		expect(panel.openColor).toBeNull();
		expect(panel.focusedWidget).toBe(col);
		expect(told).toEqual(['col:change', 'root:change']);
		key('Escape');
		expect(panel.focusedWidget).toBeNull();
		expect(pageInput().focused).toBe(false);
	});

	it('sets the hue by a press on the ring and keeps the ring through the drag wherever the pointer goes, and the triangle\'s colour by a press on the triangle, a drag off it taken onto its edge, each colour told once', () => {
		const { panel, told } = usable();
		click(panel, AT.col);
		told.length = 0;
		const picker = pickerOf(panel)!;
		const start = saturatedOf(ORANGE);
		expect(pressOn(panel, onWheel(picker.layout, 81, 120))).toBe(true);
		expect(panel.pressing).toBe(true);
		expect(picker.terms.hue).toEqual([0, 0, 255]);
		expect(picker.terms.saturation).toBe(start.saturation);
		expect(panel.get('col', 'value')).toBe(hex(triangleColour([0, 0, 255], start.saturation, start.intensity)));
		// Far past the popover, the angle from the wheel's centre is still what is set.
		moveOn(panel, onWheel(picker.layout, 600, 50));
		expect(picker.terms.hue).toEqual(hueOfAngle(50));
		expect(panel.get('col', 'value')).toBe(hex(triangleColour(hueOfAngle(50), start.saturation, start.intensity)));
		// Into the triangle: the ring is still the region pressed.
		moveOn(panel, onWheel(picker.layout, 10, -100));
		expect(picker.terms.hue).toEqual(hueOfAngle(-100));
		// Moved a hair, the same hue: nothing new is told.
		moveOn(panel, onWheel(picker.layout, 10.1, -100));
		expect(panel.release(0, 0)).toBe(true);
		expect(told).toEqual(['col:change', 'root:change', 'col:change', 'root:change', 'col:change', 'root:change']);
		told.length = 0;
		const corners = triangleOf(picker.terms.unit, wheelGeometryOf(picker.layout.wheel!, 1));
		expect(pressOn(panel, towardCorner(picker.layout, corners[1], 0.9))).toBe(true);
		const near = panel.get('col', 'value') as string;
		expect(near).not.toBe('#ffffff');
		expect(picker.terms.saturation).toBeLessThan(0.1);
		expect(picker.terms.hue).toEqual(hueOfAngle(-100));
		moveOn(panel, towardCorner(picker.layout, corners[1], 1.4));
		expect(panel.get('col', 'value')).toBe('#ffffff');
		moveOn(panel, towardCorner(picker.layout, corners[2], 1.4));
		expect(panel.get('col', 'value')).toBe('#000000');
		// A hair off the black corner reads black still: nothing new is told.
		moveOn(panel, towardCorner(picker.layout, corners[2], 1.5));
		panel.release(0, 0);
		expect(told).toEqual(['col:change', 'root:change', 'col:change', 'root:change', 'col:change', 'root:change']);
		// The click that follows a press let go unmoved sets nothing again, its point the press's rounded; the next click alone does.
		panel.set('col', 'value', '#ff8b30');
		told.length = 0;
		pressOn(panel, onWheel(picker.layout, 81, 20));
		panel.release(0, 0);
		const pressedTo = panel.get('col', 'value');
		clickOn(panel, onWheel(picker.layout, 81, 20.4));
		expect(panel.get('col', 'value')).toBe(pressedTo);
		expect(told).toEqual(['col:change', 'root:change']);
		clickOn(panel, onWheel(picker.layout, 81, 60));
		expect(picker.terms.hue).toEqual(hueOfAngle(60));
		expect(told).toHaveLength(4);
		// A press on the gap between the ring and the triangle is held, and sets nothing: with the hue at the right the gap lies at the left.
		panel.set('col', 'value', '#ff0000');
		told.length = 0;
		expect(pressOn(panel, onWheel(picker.layout, 55, 180))).toBe(true);
		moveOn(panel, onWheel(picker.layout, 81, 0));
		panel.release(0, 0);
		expect(told).toEqual([]);
		expect(panel.get('col', 'value')).toBe('#ff0000');
	});

	it('draws the wheel through the shared renderer at the wheel\'s square times the host\'s resolution, once per paint with the colour\'s terms, a colour taken painted with the host, and never in names', () => {
		wheelDraws.length = 0;
		const { panel } = usable();
		click(panel, AT.col);
		expect(wheelDraws).toHaveLength(1);
		const start = saturatedOf(ORANGE);
		expect(wheelDraws[0]).toEqual({ width: 360, height: 360, size: 180, ratio: 2, hue: start.hue, base: ORANGE, saturation: start.saturation, intensity: start.intensity });
		panel.update();
		wheelDraws.length = 1;
		pressOn(panel, onWheel(pickerOf(panel)!.layout, 81, 120));
		panel.release(0, 0);
		// The colour changed: the picker is painted once, with the host.
		expect(wheelDraws).toHaveLength(1);
		panel.update();
		expect(wheelDraws).toHaveLength(2);
		expect(wheelDraws[1].hue).toEqual([0, 0, 255]);
		expect(wheelDraws[1].base).toEqual(triangleColour([0, 0, 255], start.saturation, start.intensity));
		const { panel: named, open } = coloured({ mode: 'names' });
		wheelDraws.length = 0;
		open();
		expect(named.openColor?.id).toBe('c');
		expect(pickerOf(named)!.mode).toBe('names');
		clickOn(named, centre(pickerOf(named)!.layout.names[4]));
		expect(named.get('c', 'value')).toBe(SWATCHES[4].hex);
		expect(wheelDraws).toHaveLength(0);
	});

	it('asks its wheel of the renderer its host sets, WebGL where it sets none or one that does not read, a wheel asked of WebGPU drawn by WebGL where the browser offers no WebGPU, as jsdom does not', () => {
		const { panel, open } = coloured({});
		open();
		expect(rendererAsks).toEqual(['webgl']);
		expect(wheelDraws).toHaveLength(1);
		panel.setRenderer('webgpu');
		expect(rendererAsks.at(-1)).toBe('webgpu');
		expect(wheelDraws).toHaveLength(2);
		// jsdom offering no WebGPU, WebGL's one renderer draws both.
		expect(glStandIn.made).toHaveLength(1);
		panel.setRenderer('sideways' as Renderer);
		expect(rendererAsks.at(-1)).toBe('webgl');
	});

	it('paints the picker without its wheel while its renderer\'s context is to come, and again with the wheel as it comes, but not once shut', () => {
		glStandIn.waits = true;
		const { panel, open } = coloured({});
		open();
		expect(panel.openColor?.id).toBe('c');
		expect(wheelDraws).toHaveLength(0);
		const paints = dropperPaints.length;
		expect(paints).toBeGreaterThan(0);
		const [made] = glStandIn.made;
		made.ready = true;
		made.events.ready();
		expect(wheelDraws).toHaveLength(1);
		expect(dropperPaints).toHaveLength(paints + 1);
		// Shut before its renderer's context came, it is painted no more as the context comes.
		forgetRenderers();
		glStandIn.made.length = 0;
		panel.setRenderer(undefined);
		panel.closePicker();
		const shutPaints = dropperPaints.length;
		const [later] = glStandIn.made;
		later.ready = true;
		later.events.ready();
		expect(dropperPaints).toHaveLength(shutPaints);
		expect(wheelDraws).toHaveLength(1);
	});

	it('sets the alpha by a press on the bar where the colour carries one, read back as #rrggbbaa, and offers no bar without it', () => {
		const { panel, told, open } = coloured({ alpha: true, value: '#ff8b3080' });
		expect(panel.get('c', 'value')).toBe('#ff8b3080');
		open();
		told.length = 0;
		const picker = pickerOf(panel)!;
		const bar = picker.layout.alphaBar!;
		// Pressed a hair above the bar's foot, then dragged past it, past its top, and back to its middle.
		expect(pressOn(panel, [bar.x + 9, bar.y + bar.h - 0.5])).toBe(true);
		expect(panel.get('c', 'value')).toBe('#ff8b3001');
		moveOn(panel, [bar.x + 9, bar.y + bar.h + 50]);
		expect(panel.get('c', 'value')).toBe('#ff8b3000');
		expect(picker.terms.alpha).toBe(0);
		moveOn(panel, [bar.x + 9, bar.y - 50]);
		expect(panel.get('c', 'value')).toBe('#ff8b30');
		expect(picker.terms.alpha).toBe(1);
		moveOn(panel, [bar.x + 9, bar.y + bar.h / 2]);
		expect(panel.get('c', 'value')).toBe('#ff8b3080');
		expect(picker.colour).toEqual(ORANGE);
		panel.release(0, 0);
		expect(told).toEqual(['c:change', 'root:change', 'c:change', 'root:change', 'c:change', 'root:change', 'c:change', 'root:change']);
		const { panel: flat, open: openFlat } = coloured({ value: '#ff8b3080' });
		expect(flat.get('c', 'value')).toBe('#ff8b30');
		openFlat();
		expect(pickerOf(flat)!.layout.alphaBar).toBeNull();
		expect(pickerOf(flat)!.layout.alphaField).toBeNull();
	});

	it('takes a named cell\'s colour and a swatch\'s by a click, a swatch\'s alpha taken, and the old half puts back the colour it opened on, each told once and a held colour not at all', () => {
		const { panel, told, open } = coloured({ mode: 'names', alpha: true, swatches: ['#11223380', '#aabbcc', 'nope'] });
		open();
		told.length = 0;
		const picker = pickerOf(panel)!;
		expect(picker.name).toBe(-1);
		clickOn(panel, centre(picker.layout.names[4]));
		expect(panel.get('c', 'value')).toBe(SWATCHES[4].hex);
		expect(picker.name).toBe(4);
		expect(picker.colour).toEqual(SWATCHES[4].rgb);
		clickOn(panel, centre(picker.layout.names[4]));
		expect(told).toEqual(['c:change', 'root:change']);
		clickOn(panel, centre(picker.layout.swatches[0]));
		expect(panel.get('c', 'value')).toBe('#11223380');
		expect(picker.terms.alpha).toBeCloseTo(128 / 255, 12);
		clickOn(panel, centre(picker.layout.swatches[1]));
		expect(panel.get('c', 'value')).toBe('#aabbcc');
		expect(picker.terms.alpha).toBe(1);
		clickOn(panel, centre(picker.layout.old));
		expect(panel.get('c', 'value')).toBe('#ff8b30');
		expect(picker.colour).toEqual(ORANGE);
		clickOn(panel, centre(picker.layout.old));
		clickOn(panel, centre(picker.layout.new));
		clickOn(panel, centre(picker.layout.hex));
		expect(told).toEqual(['c:change', 'root:change', 'c:change', 'root:change', 'c:change', 'root:change', 'c:change', 'root:change']);
		expect(panel.openColor?.id).toBe('c');
	});

	it('sets the colour by a click alone with no press before it, on the triangle, the ring and the bar', () => {
		const { panel, told, open } = coloured({ alpha: true });
		open();
		told.length = 0;
		const picker = pickerOf(panel)!;
		const corners = triangleOf(picker.terms.unit, wheelGeometryOf(picker.layout.wheel!, 1));
		// Just inside the black corner: the triangle, not the ring the corner touches.
		clickOn(panel, towardCorner(picker.layout, corners[2], 0.999));
		expect(panel.get('c', 'value')).toBe('#000000');
		expect(panel.pressing).toBe(false);
		clickOn(panel, onWheel(picker.layout, 81, 120));
		expect(picker.terms.hue).toEqual([0, 0, 255]);
		const bar = picker.layout.alphaBar!;
		clickOn(panel, [bar.x + 2, bar.y + bar.h / 2]);
		expect(panel.get('c', 'value')).toBe('#00000080');
		expect(told).toEqual(['c:change', 'root:change', 'c:change', 'root:change']);
		expect(panel.openColor?.id).toBe('c');
	});

	it('shuts the picker by a click on its close, the colour kept as it stands and the focus with the colour', () => {
		const { panel, open } = coloured({});
		open();
		const picker = pickerOf(panel)!;
		clickOn(panel, centre(picker.layout.tabs[3].box));
		clickOn(panel, centre(picker.layout.names[4]));
		expect(panel.get('c', 'value')).toBe(SWATCHES[4].hex);
		clickOn(panel, centre(picker.layout.close));
		expect(pickerOf(panel)).toBeNull();
		expect(panel.get('c', 'value')).toBe(SWATCHES[4].hex);
		expect(panel.openColor).toBeNull();
		expect(panel.focusedWidget?.id).toBe('c');
	});

	it('shows the page\'s input over a picker field rounded and lined as the widget\'s field is', () => {
		const { panel, open } = coloured({ style: { width: 200, borderRadius: 0, borderWidth: 2, borderColor: '#ff8000' } });
		open();
		pressRelease(panel, centre(pickerOf(panel)!.layout.hex));
		expect(panel.placement()!.look).toMatchObject({ radius: 0, line: 2, lineColor: 'rgba(255,128,0,1)' });
		key('Escape');
	});

	it('switches the mode by a tab, the colour kept and its terms read afresh, and lays the picker out again as the host is painted', () => {
		const { panel, open } = coloured({});
		open();
		const picker = pickerOf(panel)!;
		clickOn(panel, centre(picker.layout.tabs[3].box));
		expect(picker.mode).toBe('names');
		expect(picker.layout.wheel).toBeNull();
		expect(picker.layout.names).toHaveLength(14);
		expect(panel.get('c', 'value')).toBe('#ff8b30');
		expect(picker.terms.hue).toEqual(saturatedOf(ORANGE).hue);
		clickOn(panel, centre(picker.layout.tabs[0].box));
		expect(picker.mode).toBe('wheel');
		expect(picker.layout.wheel).not.toBeNull();
		panel.set('c', 'y', 60);
		panel.update();
		expect(pickerOf(panel)!.layout.box.y).toBe(60 + 42);
		expect(panel.popoverMesh.visible).toBe(true);
		panel.set('c', 'visible', false);
		expect(panel.openColor).toBeNull();
	});

	it('is worked by key: Space and Enter open it and Enter shuts it, the arrows, Page Up, Page Down, Home and End move the wheel\'s terms, Shift tenfold, and Escape shuts it as Enter does, the colour kept', () => {
		const { panel, told } = usable();
		press(panel, AT.col);
		panel.release(...AT.col);
		expect(panel.focusedWidget?.id).toBe('col');
		expect(panel.openColor).toBeNull();
		key(' ');
		expect(panel.openColor?.id).toBe('col');
		key('Enter');
		expect(panel.openColor).toBeNull();
		expect(panel.focusedWidget?.id).toBe('col');
		key('Enter');
		const picker = pickerOf(panel)!;
		told.length = 0;
		const start = saturatedOf(ORANGE);
		key('ArrowRight');
		const turned = picker.terms;
		expect(turned.hue).not.toEqual(start.hue);
		expect(panel.get('col', 'value')).toBe(hex(triangleColour(turned.hue, start.saturation, start.intensity)));
		key('ArrowLeft');
		expect(picker.terms.hue).toEqual(start.hue);
		expect(panel.get('col', 'value')).toBe('#ff8b30');
		expect(told).toEqual(['col:change', 'root:change', 'col:change', 'root:change']);
		told.length = 0;
		// Up from an intensity of 1 moves nothing; Down a hundredth, with Shift a tenth.
		key('ArrowUp');
		expect(picker.terms.intensity).toBe(1);
		expect(told).toEqual([]);
		key('ArrowDown');
		expect(picker.terms.intensity).toBeCloseTo(0.99, 12);
		expect(panel.get('col', 'value')).toBe(hex(triangleColour(start.hue, start.saturation, 0.99)));
		key('ArrowDown', true);
		expect(picker.terms.intensity).toBeCloseTo(0.89, 12);
		key('PageDown');
		expect(picker.terms.saturation).toBeCloseTo(start.saturation - 0.1, 12);
		key('PageUp');
		expect(picker.terms.saturation).toBeCloseTo(start.saturation, 12);
		key('Home');
		expect(picker.terms.saturation).toBe(0);
		expect(panel.get('col', 'value')).toBe(hex(triangleColour(start.hue, 0, 0.89)));
		key('End');
		expect(picker.terms.saturation).toBe(1);
		expect(panel.get('col', 'value')).toBe(hex(start.hue));
		// Without an alpha, Shift with Page Down steps the saturation as Page Down does.
		key('PageDown', true);
		expect(picker.terms.saturation).toBeCloseTo(0.9, 12);
		const stepped = panel.get('col', 'value');
		key('Escape');
		expect(panel.get('col', 'value')).toBe(stepped);
		expect(panel.openColor).toBeNull();
		expect(key('Tab')).toBe(false);
	});

	it('steps the alpha by Shift with Page Up and Page Down where the colour carries one, and moves through the names in names, each taking its colour', () => {
		const { panel, open } = coloured({ alpha: true });
		open();
		key('PageDown', true);
		expect(panel.get('c', 'value')).toBe('#ff8b30f2');
		key('PageDown', true);
		// On the twentieths: nine tenths of 255 is 229.5, rounded up.
		expect(panel.get('c', 'value')).toBe('#ff8b30e6');
		expect(pickerOf(panel)!.terms.alpha).toBe(0.9);
		key('PageUp', true);
		key('PageUp', true);
		key('PageUp', true);
		expect(panel.get('c', 'value')).toBe('#ff8b30');
		const { panel: named, told, open: openNamed } = coloured({ mode: 'names', value: '#3f3f3f' });
		openNamed();
		expect(pickerOf(named)!.name).toBe(1);
		told.length = 0;
		key('ArrowDown');
		expect(named.get('c', 'value')).toBe(SWATCHES[2].hex);
		key('ArrowRight');
		expect(named.get('c', 'value')).toBe(SWATCHES[9].hex);
		key('ArrowUp');
		expect(named.get('c', 'value')).toBe(SWATCHES[8].hex);
		key('ArrowLeft');
		expect(named.get('c', 'value')).toBe(SWATCHES[1].hex);
		key('ArrowUp');
		expect(named.get('c', 'value')).toBe(SWATCHES[0].hex);
		key('ArrowUp');
		expect(named.get('c', 'value')).toBe(SWATCHES[0].hex);
		key('End');
		expect(named.get('c', 'value')).toBe(SWATCHES[13].hex);
		key('ArrowDown');
		expect(named.get('c', 'value')).toBe(SWATCHES[13].hex);
		key('Home');
		expect(named.get('c', 'value')).toBe(SWATCHES[0].hex);
		expect(told.filter((each) => each === 'c:change')).toHaveLength(7);
		// On a colour none of the cells holds, every arrow takes the first cell.
		for (const arrow of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft']) {
			const { panel: unnamed, open: openUnnamed } = coloured({ mode: 'names', value: '#123456' });
			openUnnamed();
			expect(pickerOf(unnamed)!.name).toBe(-1);
			key(arrow);
			expect(unnamed.get('c', 'value')).toBe(SWATCHES[0].hex);
			expect(pickerOf(unnamed)!.name).toBe(0);
		}
	});

	it('rereads its terms as a script writes the value while it is open, a grey keeping the hue, and drops the alpha where the colour carries none, its host refusing a non-colour', () => {
		const { panel, open } = coloured({});
		open();
		panel.update();
		const picker = pickerOf(panel)!;
		wheelDraws.length = 0;
		expect(panel.set('c', 'value', '#0000ff')).toBe(true);
		expect(picker.colour).toEqual([0, 0, 255]);
		expect(picker.terms.hue).toEqual([0, 0, 255]);
		expect(picker.name).toBe(-1);
		// Painted with the host the write paints again.
		expect(wheelDraws).toHaveLength(0);
		panel.update();
		expect(wheelDraws).toHaveLength(1);
		expect(panel.set('c', 'value', 'blue')).toBe(false);
		expect(panel.set('c', 'value', '#00ff0080')).toBe(true);
		expect(panel.get('c', 'value')).toBe('#00ff00');
		expect(picker.terms.alpha).toBe(1);
		expect(panel.set('c', 'value', '#7f7f7f')).toBe(true);
		expect(picker.name).toBe(2);
		expect(picker.terms.hue).toEqual([0, 255, 0]);
		expect(picker.terms.saturation).toBe(0);
		expect(panel.openColor?.id).toBe('c');
	});

	it('lets a press held on the picker set nothing more once the picker shuts, on a picker opened after it among them, and writes an alpha within half a byte of 1 as none', () => {
		const { panel, told } = usable();
		click(panel, AT.col);
		pressOn(panel, onWheel(pickerOf(panel)!.layout, 81, 120));
		const pressed = panel.get('col', 'value');
		expect(pressed).not.toBe('#ff8b30');
		key('Escape');
		expect(panel.openColor).toBeNull();
		expect(panel.get('col', 'value')).toBe(pressed);
		key('Enter');
		expect(panel.openColor?.id).toBe('col');
		told.length = 0;
		moveOn(panel, onWheel(pickerOf(panel)!.layout, 81, -60));
		panel.release(0, 0);
		expect(panel.get('col', 'value')).toBe(pressed);
		expect(told).toEqual([]);
		const { panel: clear, told: clearTold, open } = coloured({ alpha: true });
		open();
		const bar = pickerOf(clear)!.layout.alphaBar!;
		clearTold.length = 0;
		pressOn(clear, [bar.x + 5, bar.y + 0.2]);
		clear.release(0, 0);
		expect(pickerOf(clear)!.terms.alpha).toBeLessThan(1);
		expect(clear.get('c', 'value')).toBe('#ff8b30');
		expect(clearTold).toEqual([]);
	});

	it('opens in square and in sliders where its options name them, and a tab switches it to wheel, sliders and back to square, the colour kept and the square\'s terms read afresh from it', () => {
		// Opened before any tab is chosen, which every picker would open in after.
		const { panel: sliders, open: openSliders } = coloured({ mode: 'sliders', alpha: true });
		openSliders();
		expect(pickerOf(sliders)!.mode).toBe('sliders');
		expect(pickerOf(sliders)!.layout.bars).toHaveLength(4);
		expect(pickerOf(sliders)!.bar).toBe(0);
		const { panel, open } = coloured({ mode: 'square' });
		open();
		const picker = pickerOf(panel)!;
		expect(picker.mode).toBe('square');
		expect(picker.layout.square).not.toBeNull();
		expect(picker.terms.square).toEqual(rgbToHsv([1, 139 / 255, 48 / 255]));
		// Moved in square, then switched: the wheel reads the colour the square gave, and back again.
		const sq = picker.layout.square!;
		clickOn(panel, [sq.x + sq.w / 2, sq.y + sq.h / 2]);
		const moved = panel.get('c', 'value');
		const strip = picker.layout.hueStrip!;
		clickOn(panel, [strip.x + 9, strip.y + strip.h / 3]);
		const blue = panel.get('c', 'value') as string;
		clickOn(panel, centre(picker.layout.tabs[0].box));
		expect(picker.mode).toBe('wheel');
		expect(panel.get('c', 'value')).toBe(blue);
		expect(picker.terms.hue).toEqual(saturatedOf(picker.colour).hue);
		clickOn(panel, centre(picker.layout.tabs[2].box));
		expect(picker.mode).toBe('sliders');
		expect(picker.layout.bars).toHaveLength(3);
		clickOn(panel, centre(picker.layout.tabs[1].box));
		expect(picker.mode).toBe('square');
		expect(picker.terms.square.h).toBeCloseTo(240, 9);
		expect(panel.get('c', 'value')).toBe(blue);
		expect(moved).not.toBe(blue);
	});

	it('opens every picker on every host in the mode the viewer last chose on a picker\'s tabs, and each in its options\' mode until one is chosen and once `forgetChosenMode` forgets it', () => {
		// One picker is open at a time: each opened shuts the other, as it takes the page's input.
		const named = coloured({ mode: 'names' });
		const plain = coloured({});
		plain.open();
		expect(pickerOf(plain.panel)!.mode).toBe('wheel');
		named.open();
		expect(pickerOf(plain.panel)).toBeNull();
		expect(pickerOf(named.panel)!.mode).toBe('names');
		// The open mode's own tab chosen: every picker opens in it from then on, whatever its options name.
		clickOn(named.panel, centre(pickerOf(named.panel)!.layout.tabs[3].box));
		plain.open();
		expect(pickerOf(plain.panel)!.mode).toBe('names');
		// Chosen on another host's picker, it is the one the first opens in.
		clickOn(plain.panel, centre(pickerOf(plain.panel)!.layout.tabs[1].box));
		expect(pickerOf(plain.panel)!.mode).toBe('square');
		named.open();
		expect(pickerOf(named.panel)!.mode).toBe('square');
		// Forgotten by `forgetChosenMode`: the next opens in its options' mode, the wheel where they name none.
		for (const each of [...panels]) each.dispose();
		forgetChosenMode();
		const fresh = coloured({});
		fresh.open();
		expect(pickerOf(fresh.panel)!.mode).toBe('wheel');
	});

	it('offers the swatches a script sets in its open picker as the host is laid out again, the colour and its terms kept', () => {
		const { panel, open } = coloured({ mode: 'square' });
		open();
		const terms = pickerOf(panel)!.terms;
		expect(panel.set('c', 'swatches', '#00ff00 #0000ff')).toBe(true);
		expect(pickerOf(panel)!.terms).toBe(terms);
		panel.update();
		expect(pickerOf(panel)!.layout.swatchHexes).toEqual(['#00ff00', '#0000ff']);
		expect(pickerOf(panel)!.terms).toBe(terms);
	});

	it('is carried by a press anywhere on it but a field and the parts that set the colour, from where it stands, kept there as the host is laid out again and its mode switched, and laid out afresh as it opens again', () => {
		/** A box as far as a press read off the popover's plane can tell it. */
		const near = (box: { x: number; y: number; w: number; h: number }, at: { x: number; y: number; w: number; h: number }) => {
			for (const side of ['x', 'y', 'w', 'h'] as const) expect(box[side]).toBeCloseTo(at[side], 9);
		};
		const { panel, told } = usable();
		click(panel, AT.col);
		const from = { ...pickerOf(panel)!.layout.box };
		expect(from).toEqual({ x: 100, y: 250 - 308, w: 288, h: 308 });
		// Between its parts: held, and carried once the press moves past a drag's start.
		expect(pressOn(panel, [5, 150])).toBe(true);
		expect(panel.carrying).toBe(true);
		panel.move(from.x + 7, from.y + 151, false);
		expect(pickerOf(panel)!.layout.box).toEqual(from);
		expect(panel.move(from.x + 35, from.y + 170, true)).toBe(true);
		const carried = { ...from, x: from.x + 30, y: from.y + 20 };
		near(pickerOf(panel)!.layout.box, carried);
		// Its plane stands there at once.
		near(panel.stoodAt!, carried);
		expect(panel.release(from.x + 35, from.y + 170)).toBe(true);
		expect(panel.carrying).toBe(false);
		expect(panel.get('col', 'value')).toBe('#ff8b30');
		expect(told).toEqual(['col:click', 'root:click']);
		// A tab pressed and moved carries it, the mode kept; released unmoved, its click switches the mode where the picker stands.
		const tab = centre(pickerOf(panel)!.layout.tabs[1].box);
		pressOn(panel, tab);
		panel.move(carried.x + tab[0] - 10, carried.y + tab[1], true);
		panel.release(carried.x + tab[0] - 10, carried.y + tab[1]);
		const twice = { ...carried, x: carried.x - 10 };
		near(pickerOf(panel)!.layout.box, twice);
		expect(pickerOf(panel)!.mode).toBe('wheel');
		pressRelease(panel, tab);
		clickOn(panel, tab);
		expect(pickerOf(panel)!.mode).toBe('square');
		near(pickerOf(panel)!.layout.box, twice);
		// Its colour moved and the host laid out again: as far from where its layout stands it.
		panel.set('col', 'y', 240);
		panel.update();
		const followed = { ...twice, y: twice.y - 10 };
		near(pickerOf(panel)!.layout.box, followed);
		// A field, and a part that sets the colour, are not carried.
		const hex = centre(pickerOf(panel)!.layout.hex);
		pressOn(panel, hex);
		expect(panel.carrying).toBe(false);
		panel.move(followed.x + hex[0] + 40, followed.y + hex[1] + 40, true);
		panel.cancel();
		const square = centre(pickerOf(panel)!.layout.square!);
		pressOn(panel, square);
		expect(panel.carrying).toBe(false);
		panel.move(followed.x + square[0] + 40, followed.y + square[1] + 40, true);
		panel.release(followed.x + square[0] + 40, followed.y + square[1] + 40);
		near(pickerOf(panel)!.layout.box, followed);
		expect(panel.get('col', 'value')).not.toBe('#ff8b30');
		// Shut while carried, the press carries nothing more.
		pressOn(panel, [5, 150]);
		panel.closePicker();
		expect(panel.carrying).toBe(false);
		panel.cancel();
		// Opened again: where its layout stands it.
		click(panel, AT.col);
		expect(pickerOf(panel)!.layout.box).toEqual({ ...from, y: from.y - 10 });
	});

	it('sets the saturation and value by a press on the square and follows the move past the popover, and the hue by a press on the strip, each colour the square\'s and told once', () => {
		const { panel, told, open } = coloured({ mode: 'square', value: '#ff0000' });
		open();
		told.length = 0;
		const picker = pickerOf(panel)!;
		const sq = picker.layout.square!;
		expect(pressOn(panel, [sq.x + sq.w / 2, sq.y + sq.h / 4])).toBe(true);
		expect(panel.pressing).toBe(true);
		expect(picker.terms.square).toEqual({ h: 0, s: 0.5, v: 0.75 });
		expect(panel.get('c', 'value')).toBe(hex(hsvToRgb({ h: 0, s: 0.5, v: 0.75 }).map((c) => Math.round(c * 255)) as Rgb));
		expect(panel.get('c', 'value')).toBe('#bf6060');
		moveOn(panel, [sq.x + sq.w, sq.y]);
		expect(panel.get('c', 'value')).toBe('#ff0000');
		// Past the popover's right and foot: held to the square's edge, black.
		moveOn(panel, [sq.x + sq.w + 400, sq.y + sq.h + 400]);
		expect(picker.terms.square).toEqual({ h: 0, s: 1, v: 0 });
		expect(panel.get('c', 'value')).toBe('#000000');
		// Back to the square's top-left corner: no saturation at full value, white.
		moveOn(panel, [sq.x, sq.y]);
		expect(panel.get('c', 'value')).toBe('#ffffff');
		panel.release(0, 0);
		expect(told).toEqual(['c:change', 'root:change', 'c:change', 'root:change', 'c:change', 'root:change', 'c:change', 'root:change']);
		panel.set('c', 'value', '#ff0000');
		told.length = 0;
		const strip = picker.layout.hueStrip!;
		pressOn(panel, [strip.x + 9, strip.y + strip.h / 2]);
		expect(picker.terms.square.h).toBe(180);
		expect(panel.get('c', 'value')).toBe('#00ffff');
		moveOn(panel, [strip.x - 300, strip.y + strip.h * 2 / 3]);
		expect(picker.terms.square.h).toBeCloseTo(120, 9);
		expect(panel.get('c', 'value')).toBe('#00ff00');
		moveOn(panel, [strip.x, strip.y - 100]);
		expect(picker.terms.square.h).toBe(360);
		expect(panel.get('c', 'value')).toBe('#ff0000');
		panel.release(0, 0);
		expect(told).toEqual(['c:change', 'root:change', 'c:change', 'root:change', 'c:change', 'root:change']);
		// A press let go unmoved tells one change; the click after it sets nothing again; a click alone sets.
		told.length = 0;
		pressOn(panel, [sq.x + 30, sq.y + 30]);
		panel.release(0, 0);
		const pressed = panel.get('c', 'value');
		clickOn(panel, [sq.x + 30.4, sq.y + 30.4]);
		expect(panel.get('c', 'value')).toBe(pressed);
		expect(told).toEqual(['c:change', 'root:change']);
		clickOn(panel, [sq.x + sq.w * 0.75, sq.y + sq.h / 2]);
		expect(picker.terms.square).toMatchObject({ s: 0.75, v: 0.5 });
		expect(told).toHaveLength(4);
	});

	it('sets one channel by a press on its bar and follows the drag past the popover, a press let go unmoved telling one change, and a click alone setting a channel', () => {
		const { panel, told, open } = coloured({ mode: 'sliders', alpha: true });
		open();
		told.length = 0;
		const picker = pickerOf(panel)!;
		const [, green, blue, alpha] = picker.layout.bars;
		expect(pressOn(panel, [green.x + 5, green.y + green.h / 2])).toBe(true);
		expect(picker.bar).toBe(1);
		expect(panel.get('c', 'value')).toBe('#ff8030');
		moveOn(panel, [green.x + 500, green.y + green.h + 300]);
		expect(panel.get('c', 'value')).toBe('#ff0030');
		moveOn(panel, [green.x - 500, green.y - 300]);
		expect(panel.get('c', 'value')).toBe('#ffff30');
		// Over the next bar: the green is still the bar pressed.
		moveOn(panel, [blue.x + 5, blue.y + blue.h / 4]);
		expect(panel.get('c', 'value')).toBe('#ffc030');
		panel.release(0, 0);
		expect(told).toEqual(['c:change', 'root:change', 'c:change', 'root:change', 'c:change', 'root:change', 'c:change', 'root:change']);
		told.length = 0;
		pressOn(panel, [blue.x + 5, blue.y + blue.h - 0.5]);
		panel.release(0, 0);
		expect(panel.get('c', 'value')).toBe('#ffc000');
		expect(picker.bar).toBe(2);
		clickOn(panel, [blue.x + 5.4, blue.y + blue.h - 0.4]);
		expect(panel.get('c', 'value')).toBe('#ffc000');
		expect(told).toEqual(['c:change', 'root:change']);
		// A click alone with no press before it, on the red bar and on the alpha's.
		told.length = 0;
		const red = picker.layout.bars[0];
		clickOn(panel, [red.x + 5, red.y + red.h * 0.75]);
		expect(panel.get('c', 'value')).toBe('#40c000');
		expect(picker.bar).toBe(0);
		expect(panel.pressing).toBe(false);
		clickOn(panel, [alpha.x + 5, alpha.y + alpha.h / 2]);
		expect(panel.get('c', 'value')).toBe('#40c00080');
		expect(picker.bar).toBe(3);
		expect(picker.colour).toEqual([64, 192, 0]);
		expect(told).toEqual(['c:change', 'root:change', 'c:change', 'root:change']);
		expect(panel.openColor?.id).toBe('c');
	});

	it('is worked by key in square: Left and Right the saturation, Up and Down the value, Shift tenfold, Page Up and Page Down the hue by ten degrees round the strip, Home and End the saturation', () => {
		const { panel, told, open } = coloured({ mode: 'square', value: '#ff0000' });
		open();
		told.length = 0;
		const picker = pickerOf(panel)!;
		key('ArrowLeft');
		expect(picker.terms.square).toEqual({ h: 0, s: 0.99, v: 1 });
		expect(panel.get('c', 'value')).toBe('#ff0303');
		key('ArrowLeft', true);
		expect(picker.terms.square.s).toBeCloseTo(0.89, 12);
		key('ArrowRight');
		expect(picker.terms.square.s).toBeCloseTo(0.9, 12);
		key('ArrowUp');
		expect(picker.terms.square.v).toBe(1);
		key('ArrowDown');
		expect(picker.terms.square.v).toBeCloseTo(0.99, 12);
		key('ArrowDown', true);
		expect(picker.terms.square.v).toBeCloseTo(0.89, 12);
		key('End');
		expect(picker.terms.square.s).toBe(1);
		key('PageDown');
		expect(picker.terms.square.h).toBe(350);
		key('PageUp');
		key('PageUp');
		expect(picker.terms.square.h).toBe(10);
		expect(panel.get('c', 'value')).toBe(hex(hsvToRgb({ h: 10, s: 1, v: 0.89 }).map((c) => Math.round(c * 255)) as Rgb));
		key('Home');
		expect(picker.terms.square.s).toBe(0);
		expect(panel.get('c', 'value')).toBe('#e3e3e3');
		// A grey keeps the hue it stood at, and moving off it brings the hue back.
		key('ArrowRight', true);
		expect(picker.terms.square).toMatchObject({ h: 10 });
		expect(picker.terms.square.s).toBeCloseTo(0.1, 12);
		expect(told.length).toBe(2 * 11);
		const stepped = panel.get('c', 'value');
		key('Escape');
		expect(panel.get('c', 'value')).toBe(stepped);
		expect(panel.openColor).toBeNull();
	});

	it('is worked by key in sliders: Left and Right move the bar acted on, Up and Down step its channel by 1 and Shift by 10, Page Up and Page Down by 16, Home and End to its ends, the alpha\'s bar a hundredth and a tenth', () => {
		const { panel, told, open } = coloured({ mode: 'sliders', alpha: true, value: '#808080' });
		open();
		told.length = 0;
		const picker = pickerOf(panel)!;
		expect(picker.bar).toBe(0);
		key('ArrowUp');
		expect(panel.get('c', 'value')).toBe('#818080');
		key('ArrowUp', true);
		expect(panel.get('c', 'value')).toBe('#8b8080');
		key('PageDown');
		expect(panel.get('c', 'value')).toBe('#7b8080');
		key('End');
		expect(panel.get('c', 'value')).toBe('#ff8080');
		key('ArrowUp');
		expect(told).toHaveLength(8);
		key('ArrowLeft');
		expect(picker.bar).toBe(0);
		key('ArrowRight');
		expect(picker.bar).toBe(1);
		key('Home');
		expect(panel.get('c', 'value')).toBe('#ff0080');
		key('ArrowRight');
		key('PageUp');
		expect(panel.get('c', 'value')).toBe('#ff0090');
		key('ArrowRight');
		expect(picker.bar).toBe(3);
		key('ArrowRight');
		expect(picker.bar).toBe(3);
		key('ArrowDown');
		expect(picker.terms.alpha).toBe(0.99);
		expect(panel.get('c', 'value')).toBe('#ff0090fc');
		key('PageDown');
		expect(picker.terms.alpha).toBe(0.89);
		key('ArrowDown', true);
		expect(picker.terms.alpha).toBe(0.79);
		key('Home');
		expect(panel.get('c', 'value')).toBe('#ff009000');
		key('End');
		expect(panel.get('c', 'value')).toBe('#ff0090');
		expect(picker.colour).toEqual([255, 0, 144]);
		// Shift with Page Up and Page Down steps the alpha a twentieth here too.
		key('PageDown', true);
		expect(picker.terms.alpha).toBe(0.95);
		const stepped = panel.get('c', 'value');
		key('Escape');
		expect(panel.get('c', 'value')).toBe(stepped);
		expect(panel.openColor).toBeNull();
		// Without alpha there are three bars, and Right stops at the blue.
		const { panel: flat, open: openFlat } = coloured({ mode: 'sliders' });
		openFlat();
		key('ArrowRight');
		key('ArrowRight');
		key('ArrowRight');
		expect(pickerOf(flat)!.bar).toBe(2);
		key('ArrowRight');
		expect(pickerOf(flat)!.bar).toBe(2);
		key('Home');
		expect(flat.get('c', 'value')).toBe('#ff8b00');
	});

	it('is shut as its widget is switched off, and its host does not open it on a disabled colour', () => {
		const { panel, open } = coloured({});
		open();
		expect(panel.openColor?.id).toBe('c');
		panel.set('c', 'enabled', false);
		expect(panel.openColor).toBeNull();
		open();
		expect(panel.openColor).toBeNull();
		panel.set('c', 'enabled', true);
		open();
		expect(panel.openColor?.id).toBe('c');
	});

	it('lights the region under the pointer and paints the popover again only where that changed, and its stand-in host tells enter and leave for its widget', () => {
		const { panel, told, open } = coloured({ swatches: ['#112233', '#445566'] });
		open();
		told.length = 0;
		const picker = pickerOf(panel)!;
		wheelDraws.length = 0;
		hoverOn(panel, centre(picker.layout.swatches[0]));
		expect(picker.lit).toEqual({ kind: 'swatch', index: 0 });
		expect(wheelDraws).toHaveLength(1);
		expect(told).toEqual(['c:enter', 'root:enter']);
		hoverOn(panel, [picker.layout.swatches[0].x + 3, picker.layout.swatches[0].y + 3]);
		expect(wheelDraws).toHaveLength(1);
		hoverOn(panel, centre(picker.layout.swatches[1]));
		expect(picker.lit).toEqual({ kind: 'swatch', index: 1 });
		expect(wheelDraws).toHaveLength(2);
		hoverOn(panel, [5, 5]);
		expect(picker.lit).toBeNull();
		expect(wheelDraws).toHaveLength(3);
		panel.hover({ object: panel.mesh, uv: new Vector2(0.75, 1 - 450 / 500) });
		expect(wheelDraws).toHaveLength(3);
		expect(told).toEqual(['c:enter', 'root:enter', 'c:leave', 'go:enter']);
	});

	it('stays open and focused under a blur while the input is being handed off, and shuts on one otherwise', () => {
		const { panel, open } = coloured({});
		open();
		// The mark is the picker's, which the stand-in hosts.
		const marked = (panel as unknown as { picker: { handingOff: boolean } }).picker;
		marked.handingOff = true;
		pageInput().blur();
		expect(panel.openColor?.id).toBe('c');
		expect(panel.focusedWidget?.id).toBe('c');
		marked.handingOff = false;
		panel.onBlur();
		expect(panel.openColor).toBeNull();
		expect(panel.focusedWidget).toBeNull();
	});

	it('gives the hex field the page\'s input on a press released unmoved, the colour keeping the focus and the picker open, applies a six-digit hex as it is typed, holds text that does not read, and on Escape shuts the picker, the colour kept as it stands and the input back on the colour', () => {
		const { panel, told, open } = coloured({});
		open();
		const picker = pickerOf(panel)!;
		const input = pageInput();
		expect(input.input.readOnly).toBe(true);
		told.length = 0;
		pressRelease(panel, centre(picker.layout.hex));
		expect(picker.field).toEqual({ kind: 'hex', index: -1 });
		expect(panel.focusedWidget?.id).toBe('c');
		expect(panel.openColor?.id).toBe('c');
		expect(input.focused).toBe(true);
		expect(input.shown).toBe(true);
		expect(input.input.readOnly).toBe(false);
		expect(input.input.value).toBe('#ff8b30');
		expect(document.activeElement).toBe(input.input);
		expect(told).toEqual([]);
		typeWords('00ff0');
		expect(panel.get('c', 'value')).toBe('#ff8b30');
		expect(told).toEqual([]);
		typeWords('00ff00');
		expect(panel.get('c', 'value')).toBe('#00ff00');
		expect(picker.colour).toEqual([0, 255, 0]);
		expect(picker.terms.square.h).toBe(120);
		expect(told).toEqual(['c:change', 'root:change']);
		// A short hex reads, but is not applied as it is typed; text that does not read stays in the field.
		typeWords('f80');
		expect(panel.get('c', 'value')).toBe('#00ff00');
		typeWords('zz');
		expect(picker.typed).toBe('zz');
		expect(panel.get('c', 'value')).toBe('#00ff00');
		key('Escape');
		expect(panel.openColor).toBeNull();
		expect(panel.get('c', 'value')).toBe('#00ff00');
		expect(input.input.readOnly).toBe(true);
		expect(input.shown).toBe(false);
		expect(panel.focusedWidget?.id).toBe('c');
		expect(told).toEqual(['c:change', 'root:change']);
		// Enter applies the words as they stand, a short hex among them, and returns the input to the picker.
		key('Enter');
		const again = pickerOf(panel)!;
		pressRelease(panel, centre(again.layout.hex));
		typeWords('#f80');
		expect(panel.get('c', 'value')).toBe('#00ff00');
		key('Enter');
		expect(panel.get('c', 'value')).toBe('#ff8800');
		expect(again.field).toBeNull();
		expect(panel.openColor?.id).toBe('c');
		// Escape on the picker's body shuts it too, the colour kept.
		key('Escape');
		expect(panel.get('c', 'value')).toBe('#ff8800');
		expect(panel.openColor).toBeNull();
	});

	it('gives a channel field the input, applies a typed number held to its range at once, steps it by Up and Down within the range, Shift tenfold, and shows the alpha field in percent', () => {
		const { panel, told, open } = coloured({ alpha: true, value: '#ff8b3080' });
		open();
		const picker = pickerOf(panel)!;
		const input = pageInput();
		pressRelease(panel, centre(picker.layout.channels[1]));
		expect(picker.field).toEqual({ kind: 'channel', index: 1 });
		expect(input.input.value).toBe('139');
		told.length = 0;
		typeWords('300');
		expect(panel.get('c', 'value')).toBe('#ffff3080');
		expect(input.input.value).toBe('300');
		key('ArrowUp');
		expect(input.input.value).toBe('255');
		expect(told).toEqual(['c:change', 'root:change']);
		key('ArrowDown');
		expect(input.input.value).toBe('254');
		expect(panel.get('c', 'value')).toBe('#fffe3080');
		key('ArrowDown', true);
		expect(input.input.value).toBe('244');
		expect(panel.get('c', 'value')).toBe('#fff43080');
		typeWords('abc');
		expect(panel.get('c', 'value')).toBe('#fff43080');
		key('ArrowUp');
		expect(input.input.value).toBe('245');
		expect(panel.get('c', 'value')).toBe('#fff53080');
		key('Tab');
		key('Tab');
		expect(picker.field).toEqual({ kind: 'alphaField', index: -1 });
		expect(input.input.value).toBe('50');
		typeWords('25');
		expect(panel.get('c', 'value')).toBe('#fff53040');
		key('ArrowUp', true);
		expect(input.input.value).toBe('35');
		expect(panel.get('c', 'value')).toBe('#fff53059');
		// The hex field leaves Up and Down to the browser's field.
		pressRelease(panel, centre(picker.layout.hex));
		expect(key('ArrowUp')).toBe(true);
		expect(input.input.value).toBe('#fff53059');
	});

	it('walks the fields by Tab, hex and the channels, out to the host\'s next field shutting the picker, and back by Shift and Tab to the picker from the hex; a press on the colour\'s own field returns the input to the picker', () => {
		const { panel } = usable();
		click(panel, AT.col);
		const picker = pickerOf(panel)!;
		const input = pageInput();
		key('Tab');
		expect(picker.field).toEqual({ kind: 'hex', index: -1 });
		expect(input.shown).toBe(true);
		key('Tab');
		expect(picker.field).toEqual({ kind: 'channel', index: 0 });
		key('Tab', true);
		expect(picker.field).toEqual({ kind: 'hex', index: -1 });
		key('Tab', true);
		expect(picker.field).toBeNull();
		expect(panel.openColor?.id).toBe('col');
		expect(input.input.readOnly).toBe(true);
		for (let i = 0; i < 4; i++) key('Tab');
		expect(picker.field).toEqual({ kind: 'channel', index: 2 });
		key('Tab');
		expect(panel.openColor).toBeNull();
		expect(panel.focusedWidget?.id).toBe('sel');
		expect(input.input.readOnly).toBe(true);
		// Shift and Tab from the picker's body lets the focus go.
		click(panel, AT.col);
		expect(panel.openColor?.id).toBe('col');
		key('Tab', true);
		expect(panel.openColor).toBeNull();
		expect(panel.focusedWidget).toBeNull();
		// A press released on the colour's own field while a picker field has the input returns it to the picker; the click then shuts the picker.
		click(panel, AT.col);
		key('Tab');
		expect(pickerOf(panel)!.field).toEqual({ kind: 'hex', index: -1 });
		press(panel, AT.col);
		panel.release(...AT.col);
		expect(pickerOf(panel)!.field).toBeNull();
		expect(panel.openColor?.id).toBe('col');
		expect(input.input.readOnly).toBe(true);
		click(panel, AT.col);
		expect(panel.openColor).toBeNull();
		expect(panel.focusedWidget?.id).toBe('col');
	});

	it('places the page\'s input over the field\'s box on the popover\'s plane, past the host\'s edge where the popover reaches past it, with the picker\'s look; keeps the field through a press on the picker and a script\'s write, its words following the colour, and on Escape keeps the colour typed', () => {
		const { panel, open } = coloured({ swatches: ['#112233'] });
		open();
		const picker = pickerOf(panel)!;
		pressRelease(panel, centre(picker.layout.hex));
		const { box, hex } = picker.layout;
		expect(panel.placement()).toMatchObject({ object: panel.popoverMesh, width: box.w, height: box.h, box: { x: hex.x, y: hex.y, w: hex.w, h: hex.h } });
		expect(panel.placement()?.look).toMatchObject({ align: 'center', radius: CONTROL.radius, line: CONTROL.border, lineColor: PALETTE.line, background: PALETTE.field, padX: CONTROL.padX, opacity: 1 });
		expect(panel.placement()?.look.font.size).toBe(16);
		expect(panel.placement()?.look.font.family).toBe('Roboto Mono');
		expect(panel.placement()?.look.families.startsWith('"Roboto Mono", ')).toBe(true);
		pressOn(panel, onWheel(picker.layout, 81, 120));
		moveOn(panel, onWheel(picker.layout, 81, 125));
		panel.release(0, 0);
		expect(picker.field).toEqual({ kind: 'hex', index: -1 });
		expect(pageInput().input.value).toBe(panel.get('c', 'value'));
		expect(pageInput().input.value).not.toBe('#ff8b30');
		clickOn(panel, centre(picker.layout.swatches[0]));
		expect(pageInput().input.value).toBe('#112233');
		panel.set('c', 'value', '#0000ff');
		expect(pageInput().input.value).toBe('#0000ff');
		typeWords('#445566');
		expect(panel.get('c', 'value')).toBe('#445566');
		key('Escape');
		expect(panel.get('c', 'value')).toBe('#445566');
		expect(panel.openColor).toBeNull();
		// A 300-tall host's picker reaches past the foot, and a channel field's box with it.
		const short = new TestPanel({ id: 'c', value: '#ff8b30', x: 10, y: 20, style: { width: 200 } }, [], W, 300);
		const face = short.layout!.byId.get('c')!.face;
		short.pointAt(short.mesh, new Vector2((face.x + face.w / 2) / W, 1 - (face.y + face.h / 2) / 300));
		const reaching = pickerOf(short)!.layout;
		expect(reaching.box.y + reaching.box.h).toBeGreaterThan(300);
		const channel = reaching.channels[0];
		pressRelease(short, centre(channel));
		expect(short.placement()?.box).toEqual(channel);
		expect(short.placement()!.object).toBe(short.popoverMesh);
		expect(reaching.box.y + channel.y).toBeGreaterThan(300);
	});

	it('cycles the colour space by a click on the space word, RGB, HSV, HSL and back, a channel field holding the input rewritten in its units, the colour kept, and the sliders\' bars and keys following it', () => {
		const { panel, told, open } = coloured({ mode: 'sliders' });
		open();
		const picker = pickerOf(panel)!;
		expect(picker.space).toBe('RGB');
		told.length = 0;
		clickOn(panel, centre(picker.layout.space));
		expect(picker.space).toBe('HSV');
		expect(told).toEqual([]);
		expect(panel.get('c', 'value')).toBe('#ff8b30');
		// The first bar is now the hue: its top is 360, red at the colour's saturation and value.
		const [first] = picker.layout.bars;
		pressOn(panel, [first.x + 5, first.y]);
		panel.release(0, 0);
		expect(picker.terms.square.h).toBe(360);
		expect(panel.get('c', 'value')).toBe('#ff3030');
		key('ArrowDown');
		expect(picker.terms.square.h).toBe(359);
		key('Home');
		expect(picker.terms.square.h).toBe(0);
		expect(panel.get('c', 'value')).toBe('#ff3030');
		key('ArrowRight');
		key('End');
		expect(channelsOf('HSV', picker.colour, picker.terms)).toEqual([0, 100, 100]);
		expect(panel.get('c', 'value')).toBe('#ff0000');
		clickOn(panel, centre(picker.layout.space));
		expect(picker.space).toBe('HSL');
		key('ArrowRight');
		expect(picker.bar).toBe(2);
		key('PageDown');
		expect(channelsOf('HSL', picker.colour, picker.terms)).toEqual([0, 100, 34]);
		expect(panel.get('c', 'value')).toBe('#ad0000');
		clickOn(panel, centre(picker.layout.space));
		expect(picker.space).toBe('RGB');
		pressRelease(panel, centre(picker.layout.channels[0]));
		expect(pageInput().input.value).toBe('173');
		clickOn(panel, centre(picker.layout.space));
		expect(picker.space).toBe('HSV');
		expect(pageInput().input.value).toBe('0');
		expect(picker.field).toEqual({ kind: 'channel', index: 0 });
		// A space cycle moves no colour: the colour typed stands, and Enter applies the words rewritten as they read in the new space.
		typeWords('120');
		expect(panel.get('c', 'value')).toBe('#00ad00');
		clickOn(panel, centre(picker.layout.space));
		expect(picker.space).toBe('HSL');
		expect(pageInput().input.value).toBe('120');
		expect(panel.get('c', 'value')).toBe('#00ad00');
		key('Enter');
		expect(panel.get('c', 'value')).toBe('#00ad00');
		expect(picker.field).toBeNull();
		// The hex field's words are its own whatever the space: a space cycle leaves what was typed.
		pressRelease(panel, centre(picker.layout.hex));
		typeWords('#12');
		clickOn(panel, centre(picker.layout.space));
		expect(pageInput().input.value).toBe('#12');
		expect(picker.typed).toBe('#12');
	});

	it('steps an HSL channel from the value shown, which the bytes could not hold, a typed value reading back as itself, and keeps the saturation through the lightness\'s ends', () => {
		const { panel, told, open } = coloured({ value: '#808088', mode: 'sliders' });
		open();
		const picker = pickerOf(panel)!;
		clickOn(panel, centre(picker.layout.space));
		clickOn(panel, centre(picker.layout.space));
		expect(picker.space).toBe('HSL');
		pressRelease(panel, centre(picker.layout.channels[0]));
		expect(pageInput().input.value).toBe('240');
		told.length = 0;
		// A degree at a saturation this low moves no byte: the hue is held all the same, and nothing is told.
		key('ArrowUp');
		expect(pageInput().input.value).toBe('241');
		expect(channelsOf('HSL', picker.colour, picker.terms)).toEqual([241, 3, 52]);
		expect(panel.get('c', 'value')).toBe('#808088');
		expect(told).toEqual([]);
		key('ArrowUp', true);
		expect(pageInput().input.value).toBe('251');
		expect(channelsOf('HSL', picker.colour, picker.terms)).toEqual([251, 3, 52]);
		expect(panel.get('c', 'value')).toBe('#818088');
		expect(told).toEqual(['c:change', 'root:change']);
		key('ArrowDown', true);
		key('ArrowDown');
		expect(pageInput().input.value).toBe('240');
		expect(panel.get('c', 'value')).toBe('#808088');
		key('Tab');
		key('Tab');
		expect(picker.field).toEqual({ kind: 'channel', index: 2 });
		typeWords('100');
		expect(panel.get('c', 'value')).toBe('#ffffff');
		typeWords('52');
		expect(channelsOf('HSL', picker.colour, picker.terms)).toEqual([240, 3, 52]);
		expect(panel.get('c', 'value')).toBe('#818189');
		// The bar's keys step the shown value too, and its line follows.
		key('Enter');
		key('ArrowRight');
		expect(picker.bar).toBe(1);
		key('ArrowUp');
		expect(channelsOf('HSL', picker.colour, picker.terms)).toEqual([240, 4, 52]);
		expect(barShare('HSL', 1, picker.colour, picker.terms)).toBeCloseTo(0.04, 12);
	});

	it('does nothing on a click alone on a field, nor on a press on the field already holding the input, returns the input to the colour as the picker shuts under the field, puts it back there where the page is not seen, and lets the focus go on a blur that is no hand-off', () => {
		const { panel, open } = coloured({});
		open();
		const picker = pickerOf(panel)!;
		clickOn(panel, centre(picker.layout.hex));
		expect(picker.field).toBeNull();
		expect(pageInput().input.readOnly).toBe(true);
		expect(panel.putAway()).toBe(false);
		pressRelease(panel, centre(picker.layout.hex));
		expect(picker.field).toEqual({ kind: 'hex', index: -1 });
		// A press on the field holding the input leaves its words as typed.
		typeWords('#00ff00');
		typeWords('#00ff00a');
		pressRelease(panel, [picker.layout.hex.x + 3, picker.layout.hex.y + 3]);
		expect(picker.typed).toBe('#00ff00a');
		expect(pageInput().input.value).toBe('#00ff00a');
		key('Tab', true);
		expect(picker.field).toBeNull();
		expect(panel.get('c', 'value')).toBe('#00ff00');
		// Where the page is not seen, a field's input is put back to the picker's body, the colour focused and the picker open.
		pressRelease(panel, centre(picker.layout.hex));
		expect(pageInput().shown).toBe(true);
		expect(panel.putAway()).toBe(true);
		expect(picker.field).toBeNull();
		expect(panel.openColor?.id).toBe('c');
		expect(panel.focusedWidget?.id).toBe('c');
		expect(pageInput().shown).toBe(false);
		expect(pageInput().input.readOnly).toBe(true);
		pressRelease(panel, centre(picker.layout.hex));
		expect(picker.field).toEqual({ kind: 'hex', index: -1 });
		closeOtherPickers(null);
		expect(panel.openColor).toBeNull();
		expect(panel.focusedWidget?.id).toBe('c');
		expect(pageInput().focused).toBe(true);
		expect(pageInput().input.readOnly).toBe(true);
		expect(pageInput().shown).toBe(false);
		key('Enter');
		expect(panel.openColor?.id).toBe('c');
		pressRelease(panel, centre(pickerOf(panel)!.layout.channels[2]));
		expect(pageInput().shown).toBe(true);
		pageInput().input.blur();
		expect(panel.openColor).toBeNull();
		expect(panel.focusedWidget).toBeNull();
		expect(pageInput().focused).toBe(false);
	});

	describe('its eyedropper', () => {
		/** A page's view, its colour read by the host, here by the test. */
		const VIEW = { element: document.createElement('div'), sample: (): Rgb => [0, 0, 0] };
		/** The open picker's eyedropper. */
		const dropperOf = (panel: TestPanel) => (pickerOf(panel) as unknown as { dropper: { armed: boolean; abort: AbortController | null; pinned: boolean } }).dropper;
		/** The eyedropper as the picker was last painted. */
		const painted = () => dropperPaints.at(-1)!;
		/** The middle of the open picker's eyedropper. */
		const dropperAt = (panel: TestPanel) => centre(pickerOf(panel)!.layout.dropper!);
		/** The browser's own eyedropper, a stand-in each open of which the test answers. */
		const browserEyeDropper = () => {
			const opened: { signal: AbortSignal | undefined; resolve: (answer: { sRGBHex: string }) => void; reject: (error: unknown) => void }[] = [];
			class EyeDropper {
				open(options?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }> {
					return new Promise((resolve, reject) => {
						opened.push({ signal: options?.signal, resolve, reject });
						options?.signal?.addEventListener('abort', () => reject(new DOMException('The eyedropper was aborted', 'AbortError')));
					});
				}
			}
			Object.defineProperty(window, 'EyeDropper', { value: EyeDropper, configurable: true });
			return opened;
		};
		/** The app's own pick, a stand-in that keeps each pick's take and signal for the test to answer. */
		const appPick = () => {
			const picks: { take: (colour: string | null, done?: boolean) => void; signal: AbortSignal }[] = [];
			const pick = (take: (colour: string | null, done?: boolean) => void, signal: AbortSignal): void => {
				picks.push({ take, signal });
			};
			return { picks, pick };
		};
		/** Lets the answers given settle. */
		const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

		afterEach(() => {
			delete (window as unknown as { EyeDropper?: unknown }).EyeDropper;
		});

		it('picks from the host\'s own view: armed by a click, it takes each colour the host reads under the press as a named cell\'s, the alpha kept, telling change, and is put away as the press is let go, or by a second click', () => {
			const { panel, told, open } = coloured({ alpha: true, value: '#ff8b3080' });
			open();
			expect(pickerOf(panel)!.layout.tip!.lines.join(' ')).toBe(DROPPER_TIPS.view);
			const dropper = dropperAt(panel);
			clickOn(panel, dropper);
			expect(panel.dropping).toBe(true);
			told.length = 0;
			panel.takeDropped([0x12, 0x34, 0x56], false);
			expect(panel.get('c', 'value')).toBe('#12345680');
			expect(told).toEqual(['c:change', 'root:change']);
			// The same colour again tells nothing; a point off the view takes none.
			panel.takeDropped([0x12, 0x34, 0x56], false);
			panel.takeDropped(null, false);
			expect(told).toHaveLength(2);
			panel.takeDropped([0x65, 0x43, 0x21], true);
			expect(panel.get('c', 'value')).toBe('#65432180');
			expect(panel.dropping).toBe(false);
			// Put away, it takes nothing more.
			panel.takeDropped([1, 2, 3], false);
			expect(panel.get('c', 'value')).toBe('#65432180');
			clickOn(panel, dropper);
			clickOn(panel, dropper);
			expect(panel.dropping).toBe(false);
			expect(pickerOf(panel)!.terms.alpha).toBeCloseTo(0x80 / 255, 9);
		});

		it('shows its tooltip with its mode\'s words or the host\'s own while the pointer is over it or the tooltip, and while it is armed, standing over what lies under it', () => {
			const { panel, open } = coloured({});
			panel.setEyedropper({ mode: 'view', view: VIEW, tip: 'Pick a colour from the feed' });
			open();
			const layout = pickerOf(panel)!.layout;
			expect(layout.tip!.lines.join(' ')).toBe('Pick a colour from the feed');
			const over = centre(layout.tip!.box);
			hoverOn(panel, over);
			expect(pickerOf(panel)!.lit).not.toEqual({ kind: 'tip', index: -1 });
			hoverOn(panel, centre(layout.dropper!));
			expect(pickerOf(panel)!.lit).toEqual({ kind: 'dropper', index: -1 });
			hoverOn(panel, over);
			expect(pickerOf(panel)!.lit).toEqual({ kind: 'tip', index: -1 });
			hoverOn(panel, centre(layout.hex));
			hoverOn(panel, over);
			expect(pickerOf(panel)!.lit).not.toEqual({ kind: 'tip', index: -1 });
			// Armed, it shows with the pointer anywhere, a touch having none over it.
			clickOn(panel, centre(layout.dropper!));
			hoverOn(panel, centre(layout.hex));
			hoverOn(panel, over);
			expect(pickerOf(panel)!.lit).toEqual({ kind: 'tip', index: -1 });
			// Words that are blank give the mode's own.
			panel.setEyedropper({ mode: 'view', view: VIEW, tip: ' ' });
			expect(pickerOf(panel)!.layout.tip!.lines.join(' ')).toBe(DROPPER_TIPS.view);
		});

		it('is put away by a press anywhere else on the picker, which then works as ever, and by Escape, which shuts the picker with it, the colour kept', () => {
			const { panel, open } = coloured({});
			open();
			const layout = pickerOf(panel)!.layout;
			clickOn(panel, centre(layout.dropper!));
			pressRelease(panel, centre(layout.hex));
			expect(panel.dropping).toBe(false);
			expect(pickerOf(panel)!.field).toEqual({ kind: 'hex', index: -1 });
			key('Tab', true);
			clickOn(panel, centre(layout.dropper!));
			panel.takeDropped([0, 0, 255], false);
			key('Escape');
			expect(panel.dropping).toBe(false);
			expect(panel.openColor).toBeNull();
			expect(panel.get('c', 'value')).toBe('#0000ff');
		});

		it('opens the browser\'s own eyedropper on the screen inside the click where the browser has one, drawn armed while it is open, and takes the colour it picks as a named cell\'s, the alpha kept', async () => {
			const opened = browserEyeDropper();
			const { panel, told, open } = coloured({ alpha: true, value: '#ff8b3080' });
			panel.setEyedropper({ mode: 'screen', view: OWN_VIEW });
			open();
			expect(pickerOf(panel)!.layout.tip!.lines.join(' ')).toBe(DROPPER_TIPS.screen);
			clickOn(panel, dropperAt(panel));
			expect(opened).toHaveLength(1);
			expect(dropperOf(panel).abort).not.toBeNull();
			expect(panel.dropping).toBe(false);
			// A second click while it is open opens no other.
			clickOn(panel, dropperAt(panel));
			expect(opened).toHaveLength(1);
			told.length = 0;
			opened[0].resolve({ sRGBHex: '#3366CC' });
			await settled();
			expect(panel.get('c', 'value')).toBe('#3366cc80');
			expect(told).toEqual(['c:change', 'root:change']);
			expect(dropperOf(panel).abort).toBeNull();
		});

		it('takes nothing where the browser\'s eyedropper is escaped or the picker shut under it, by Escape among the rest, and opens none in view mode, arming on its view though the browser has one', async () => {
			const opened = browserEyeDropper();
			const { panel, open } = coloured({});
			panel.setEyedropper({ mode: 'screen' });
			open();
			clickOn(panel, dropperAt(panel));
			opened[0].reject(new DOMException('The eyedropper was cancelled', 'AbortError'));
			await settled();
			expect(panel.get('c', 'value')).toBe('#ff8b30');
			expect(dropperOf(panel).abort).toBeNull();
			// Escape shuts the picker under it, which aborts it.
			clickOn(panel, dropperAt(panel));
			key('Escape');
			expect(opened[1].signal!.aborted).toBe(true);
			expect(panel.openColor).toBeNull();
			open();
			// Shut under it otherwise, it is aborted and takes nothing.
			clickOn(panel, dropperAt(panel));
			panel.closePicker();
			expect(opened[2].signal!.aborted).toBe(true);
			opened[2].resolve({ sRGBHex: '#000000' });
			await settled();
			expect(panel.get('c', 'value')).toBe('#ff8b30');
			// In view mode it arms on the view.
			panel.setEyedropper({ mode: 'view', view: OWN_VIEW });
			open();
			clickOn(panel, dropperAt(panel));
			expect(opened).toHaveLength(3);
			expect(panel.dropping).toBe(true);
		});

		it('falls back to the view given beside the screen where the browser has no eyedropper of its own, saying so, and with no view either is unavailable, saying where it works', () => {
			const { panel, open } = coloured({});
			panel.setEyedropper({ mode: 'screen', view: OWN_VIEW });
			open();
			expect(pickerOf(panel)!.layout.tip!.lines.join(' ')).toBe(DROPPER_TIPS.fallback);
			expect(painted().unavailable).toBe(false);
			clickOn(panel, dropperAt(panel));
			expect(panel.dropping).toBe(true);
			panel.setEyedropper({ mode: 'screen' });
			expect(panel.dropping).toBe(false);
			expect(pickerOf(panel)!.layout.dropper).not.toBeNull();
			expect(pickerOf(panel)!.layout.tip!.lines.join(' ')).toBe(DROPPER_TIPS.unavailable);
			expect(painted()).toEqual({ armed: false, tip: false, unavailable: true });
			// Where the browser has one, the screen alone.
			browserEyeDropper();
			panel.setEyedropper({ mode: 'screen' });
			expect(pickerOf(panel)!.layout.tip!.lines.join(' ')).toBe(DROPPER_TIPS.screen);
			expect(painted().unavailable).toBe(false);
		});

		it('is drawn unavailable where it is set to the screen, the browser has no eyedropper of its own and no view is given, its tooltip shown while the pointer is over it and pinned open by a click on it, which picks nothing, until a second click, a press or click anywhere else on the picker, the eyedropper changing, or Escape, which shuts the picker', () => {
			const { panel, told, open } = coloured({});
			panel.setEyedropper({ mode: 'screen' });
			open();
			const layout = pickerOf(panel)!.layout;
			const dropper = centre(layout.dropper!);
			expect(painted()).toEqual({ armed: false, tip: false, unavailable: true });
			// The pointer over it shows its tooltip, and off it puts it away.
			hoverOn(panel, dropper);
			expect(painted().tip).toBe(true);
			hoverOn(panel, centre(layout.hex));
			expect(painted().tip).toBe(false);
			// A click pins the tooltip open with the pointer anywhere, as a touch's does, and picks nothing.
			told.length = 0;
			clickOn(panel, dropper);
			expect(painted()).toEqual({ armed: false, tip: true, unavailable: true });
			expect(dropperOf(panel)).toEqual({ armed: false, abort: null, pinned: true });
			expect(panel.dropping).toBe(false);
			expect(told).toEqual([]);
			// A second click lets it go.
			clickOn(panel, dropper);
			expect(painted().tip).toBe(false);
			// So does a press anywhere else on the picker, which then works as ever.
			clickOn(panel, dropper);
			pressRelease(panel, centre(layout.hex));
			expect(painted().tip).toBe(false);
			expect(pickerOf(panel)!.field).toEqual({ kind: 'hex', index: -1 });
			key('Tab', true);
			// And a click anywhere else, from a host that clicks without pressing first.
			clickOn(panel, dropper);
			clickOn(panel, centre(layout.old));
			expect(painted().tip).toBe(false);
			// And the eyedropper changing.
			clickOn(panel, dropper);
			panel.setEyedropper({ mode: 'screen' });
			expect(dropperOf(panel).pinned).toBe(false);
			expect(painted().tip).toBe(false);
			// And Escape, which shuts the picker, the colour kept.
			clickOn(panel, dropper);
			key('Escape');
			expect(panel.openColor).toBeNull();
			expect(panel.get('c', 'value')).toBe('#ff8b30');
		});

		it('leaves its tooltip standing under a press on it for the click after, which a touch has no pointer over to find it by: the click puts an armed eyedropper away, or the tooltip a click pinned open, and clicks nothing under it', () => {
			const { panel, open } = coloured({ mode: 'square' });
			open();
			for (const set of [{ mode: 'view', view: OWN_VIEW }, { mode: 'screen' }] as const) {
				panel.setEyedropper(set);
				const layout = pickerOf(panel)!.layout;
				const tip = centre(layout.tip!.box);
				// Under the tooltip, what sets the colour at a click's point.
				expect(DRAGGED_REGIONS).toContain(pickerRegionAt(layout, ...tip, pickerOf(panel)!.terms.unit)?.kind);
				clickOn(panel, dropperAt(panel));
				pressRelease(panel, tip);
				expect(dropperOf(panel)).toMatchObject(set.mode === 'view' ? { armed: true } : { pinned: true });
				clickOn(panel, tip);
				expect(dropperOf(panel)).toEqual({ armed: false, abort: null, pinned: false });
				expect(painted().tip).toBe(false);
				expect(panel.get('c', 'value')).toBe('#ff8b30');
			}
		});

		it('shows none where it is disabled or set in a mode that does not read, and reads the eyedropper afresh as it changes, one armed on a view staying armed on another view and put away otherwise', () => {
			const { panel, open } = coloured({});
			open();
			const was = dropperAt(panel);
			clickOn(panel, was);
			expect(panel.dropping).toBe(true);
			panel.setEyedropper({ mode: 'view', view: VIEW });
			expect(panel.dropping).toBe(true);
			panel.setEyedropper({ mode: 'disabled' });
			expect(panel.dropping).toBe(false);
			expect(pickerOf(panel)!.layout.dropper).toBeNull();
			// Where the eyedropper stood is the hex field's.
			hoverOn(panel, was);
			expect(pickerOf(panel)!.lit).toEqual({ kind: 'hex', index: -1 });
			for (const unread of [{ mode: 'sideways' }, { mode: 'view' }, { mode: 'custom' }, null]) {
				panel.setEyedropper(unread as unknown as Eyedropper<object>);
				expect(pickerOf(panel)!.layout.dropper).toBeNull();
			}
			panel.setEyedropper({ mode: 'view', view: OWN_VIEW });
			expect(pickerOf(panel)!.layout.dropper).not.toBeNull();
			expect(panel.dropping).toBe(false);
		});

		it('hands the app\'s own pick a take and a signal in custom mode, drawn armed with its tooltip while the app picks, each colour taken as a named cell\'s, the alpha kept, telling change, until the app is done', () => {
			const { picks, pick } = appPick();
			const { panel, told, open } = coloured({ alpha: true, value: '#ff8b3080' });
			panel.setEyedropper({ mode: 'custom', pick, tip: 'Pick a colour from the camera' });
			open();
			const layout = pickerOf(panel)!.layout;
			expect(layout.tip!.lines.join(' ')).toBe('Pick a colour from the camera');
			clickOn(panel, dropperAt(panel));
			expect(picks).toHaveLength(1);
			expect(dropperOf(panel).armed).toBe(true);
			// No view of the host's takes its presses, and the tooltip shows with the pointer anywhere.
			expect(panel.dropping).toBe(false);
			hoverOn(panel, centre(layout.tip!.box));
			expect(pickerOf(panel)!.lit).toEqual({ kind: 'tip', index: -1 });
			told.length = 0;
			picks[0].take('#123456');
			expect(panel.get('c', 'value')).toBe('#12345680');
			expect(told).toEqual(['c:change', 'root:change']);
			// What does not read takes nothing, nor does none; the same colour again tells nothing.
			picks[0].take('reddish');
			picks[0].take(null);
			picks[0].take('#123456');
			expect(told).toHaveLength(2);
			picks[0].take('#654321', true);
			expect(panel.get('c', 'value')).toBe('#65432180');
			expect(dropperOf(panel).armed).toBe(false);
			expect(picks[0].signal.aborted).toBe(false);
			// Done, it takes nothing more.
			picks[0].take('#000000');
			expect(panel.get('c', 'value')).toBe('#65432180');
			// Taken by its bytes: an alpha the app's colour carries is not the colour's.
			clickOn(panel, dropperAt(panel));
			picks[1].take('#00ff0011', true);
			expect(panel.get('c', 'value')).toBe('#00ff0080');
			// Done taking none, the colour stays.
			clickOn(panel, dropperAt(panel));
			picks[2].take(null, true);
			expect(dropperOf(panel).armed).toBe(false);
			expect(panel.get('c', 'value')).toBe('#00ff0080');
		});

		it('aborts the app\'s pick where the eyedropper is put away first, by a second click, a press anywhere else on the picker, a change of eyedropper or the picker shutting, Escape among what shuts it, and takes nothing after', () => {
			const { picks, pick } = appPick();
			const { panel, open } = coloured({});
			panel.setEyedropper({ mode: 'custom', pick });
			open();
			expect(pickerOf(panel)!.layout.tip!.lines.join(' ')).toBe(DROPPER_TIPS.custom);
			clickOn(panel, dropperAt(panel));
			clickOn(panel, dropperAt(panel));
			expect(picks).toHaveLength(1);
			expect(picks[0].signal.aborted).toBe(true);
			expect(dropperOf(panel).armed).toBe(false);
			picks[0].take('#000000', true);
			expect(panel.get('c', 'value')).toBe('#ff8b30');
			// A press elsewhere on the picker, which then works as ever.
			clickOn(panel, dropperAt(panel));
			pressRelease(panel, centre(pickerOf(panel)!.layout.hex));
			expect(picks[1].signal.aborted).toBe(true);
			expect(pickerOf(panel)!.field).toEqual({ kind: 'hex', index: -1 });
			key('Tab', true);
			// A change of eyedropper.
			clickOn(panel, dropperAt(panel));
			panel.setEyedropper({ mode: 'custom', pick });
			expect(picks[2].signal.aborted).toBe(true);
			// Escape, which shuts the picker.
			clickOn(panel, dropperAt(panel));
			key('Escape');
			expect(picks[3].signal.aborted).toBe(true);
			expect(panel.openColor).toBeNull();
			// The picker shut otherwise.
			open();
			clickOn(panel, dropperAt(panel));
			panel.closePicker();
			expect(picks[4].signal.aborted).toBe(true);
			picks[4].take('#000000', true);
			expect(panel.get('c', 'value')).toBe('#ff8b30');
		});

		it('puts the eyedropper away and throws on where the app\'s pick throws as it begins', () => {
			const { panel, open } = coloured({});
			panel.setEyedropper({ mode: 'custom', pick: () => { throw new Error('no camera'); } });
			open();
			expect(() => clickOn(panel, dropperAt(panel))).toThrow('no camera');
			expect(dropperOf(panel)).toEqual({ armed: false, abort: null, pinned: false });
			expect(panel.openColor?.id).toBe('c');
		});
	});

	describe('its dock button', () => {
		it('shows the dock button its host gives left of the close, none where it gives none, and hands its click to the host', () => {
			const { panel, open } = coloured({});
			open();
			expect(pickerOf(panel)!.layout.dock).toBeNull();
			panel.setDockButton('popout');
			const layout = pickerOf(panel)!.layout;
			expect(layout.dock!.kind).toBe('popout');
			clickOn(panel, centre(layout.dock!.box));
			expect(panel.dockClicks).toBe(1);
			expect(panel.openColor?.id).toBe('c');
			panel.setDockButton('dock');
			expect(pickerOf(panel)!.layout.dock!.kind).toBe('dock');
			panel.setDockButton(null);
			expect(pickerOf(panel)!.layout.dock).toBeNull();
			expect(panel.dockClicks).toBe(1);
		});
	});
});
