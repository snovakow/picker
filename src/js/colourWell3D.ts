/**
 * @fileoverview A colour well in a three.js scene (`ColourWell3D`): a colour
 * widget made from its options, painted on a plane of its own, whose picker
 * opens on a second plane below it, under either of three.js's renderers and
 * in VR. The well is its picker's host (`PickerHost`): it lays its colour out
 * in pixels of its own, a pixel `pixelSize` of the scene's units across,
 * stands the picker's plane where the picker asks, and hands the picker the
 * points a ray hits on either plane as a `Uv`, a held press's moves taken
 * along the plane wherever the ray goes.
 *
 * The app hands the well each pointer's ray in world space: a mouse's from
 * the camera, or a controller's in VR (`pointerDown`, `pointerMove`,
 * `pointerUp`, `pointerCancel`); or has the well listen on the renderer's
 * canvas itself (`listen`). A press let go where it went down, unmoved, is a
 * click. One well's picker opening shuts another's, and a press on neither
 * plane lets the well's focus go, the picker staying open, as on a page.
 *
 * The well paints its colour again on a microtask after a change, and the
 * picker paints its own as it changes; an app that renders on demand is
 * asked for a frame as either does (`requestRender`). The page's input takes
 * the well's keys and typing, placed over the field it is typed into where
 * the well is given the view it is seen through (`setView`), and out of
 * sight otherwise, as in VR, where the typing still shows in the field.
 */

import { CanvasTexture, Group, Mesh, MeshBasicMaterial, Plane, PlaneGeometry, Raycaster, SRGBColorSpace, Vector2, Vector3, type Camera, type Ray } from 'three';
import { ColourPicker, type Eyedropper, type PickerHost } from './colourPicker.ts';
import { pageInput, pageInputMade, type InputHost, type InputRect } from './input.ts';
import { MONO_FAMILY, layoutWell, restingState, type Box, type Laid, type WidgetState } from './layout.ts';
import { loadFaces, paintWell } from './paint.ts';
import { readColourOptions, swatchesOf, type ColourOptions, type ColourWidget, type WidgetEvent } from './options.ts';
import { pageMeasure } from './pagePicker.ts';
import { TOUCH_SLOP } from './pointer.ts';
import { rendererOf, type Renderer } from './renderer.ts';
import { formatColour, parseColour } from './hex.ts';

/** What a well in a scene is made from: its colour widget's options, what it tells, its eyedropper, what draws its wheel, its size and sharpness, and how it asks for a frame. */
export interface ColourWell3DOptions extends ColourOptions {
	/** Told each event the colour tells: `click` as the well is clicked, `change` as a colour is taken, `enter` and `leave` as a pointer comes onto or goes off the well or its picker. */
	onEvent?: (event: WidgetEvent, well: ColourWell3D) => void;
	/** The eyedropper the picker shows (`Eyedropper`): the screen's by default, which the browser gives on a computer; in VR, the app's own pick (`custom`), or none. */
	eyedropper?: Eyedropper<object>;
	/** What draws the picker's wheel (`Renderer`): the one the scene's renderer draws by, `webgpu` under WebGPURenderer; WebGL where left out. */
	renderer?: Renderer;
	/** How far across a pixel of the well is in the scene's units; a millimetre, 0.001, where left out, for a scene in metres, as VR's is. */
	pixelSize?: number;
	/** How many of a texture's pixels make one of the well's; 2 where left out. */
	resolution?: number;
	/** Asks the app for a frame, as the well or its picker is painted again or moved, for an app that renders on demand. */
	requestRender?: () => void;
}

/** A pixel's size in the scene's units where the options give none: a millimetre, for a scene in metres. */
export const PIXEL_SIZE = 0.001;

/** A texture's pixels to one of the well's where the options give none. */
const RESOLUTION = 2;

/** The eyedropper a well shows where it is given none: the screen's. */
export const SCREEN: Eyedropper<object> = { mode: 'screen' };

/** How far in front of the colour's plane the picker's stands, in the well's pixels, so it is drawn over the colour where it is carried across it. */
const LIFT = 1;

/** The room the well's pixels give its picker: none of a scene bounds it, so it stands below its colour. */
const ROOM = 1e6;

/** Every well made and not let go, whose pickers one opening shuts. */
const wells = new Set<ColourWell3D>();

/** Whether the warning that a WebGPURenderer's tone mapping shifts the well's colours has been given: once a page. */
let warnedToneMapping = false;

/**
 * Warns, once, where a well is drawn by a WebGPURenderer that tone-maps:
 * three.js's WebGPURenderer tone-maps the whole frame as it is drawn out,
 * a material's `toneMapped` left unread, so the well and its picker show
 * in colours other than their own. WebGLRenderer reads it, and shows them
 * true.
 */
const warnIfToneMapped = (renderer: unknown): void => {
	if (warnedToneMapping) return;
	const drawing = renderer as { isWebGPURenderer?: boolean; toneMapping?: number } | null;
	// NoToneMapping is 0.
	if (drawing?.isWebGPURenderer !== true || !drawing.toneMapping) return;
	warnedToneMapping = true;
	console.warn('ColourWell3D: three.js\'s WebGPURenderer tone-maps the whole frame, whatever a material\'s toneMapped says, so the colour well and its picker show in colours other than their own. Set the renderer\'s toneMapping to NoToneMapping (in React Three Fiber, <Canvas flat>) for them to show true.');
};

/** Which plane a point is on: the picker's, or the colour's. */
type On = 'picker' | 'colour';

/** A press held on the well: its pointer, the plane it went down on, where, in the well's pixels, and whether it has moved past a drag's start. */
interface Held {
	pointerId: number;
	on: On;
	at: { x: number; y: number };
	moved: boolean;
}

/** A number read from an option: a positive one as given, the fallback otherwise. */
const positive = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback);

/** A texture painted from a canvas, read as sRGB, so the scene shows the canvas's bytes. */
const textureOf = (canvas: HTMLCanvasElement): CanvasTexture => {
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	return texture;
};

/** A plane over a unit square, drawn in its texture's colours as painted: unlit, not tone-mapped, its transparency blended. */
const planeOf = (geometry: PlaneGeometry, map: CanvasTexture): Mesh<PlaneGeometry, MeshBasicMaterial> =>
	new Mesh(geometry, new MeshBasicMaterial({ map, transparent: true, toneMapped: false }));

export class ColourWell3D extends Group {
	readonly widget: ColourWidget;
	/** The colour's plane, its centre at the well's origin. */
	readonly colourMesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
	/** The picker's plane, shown while the picker is open. */
	readonly pickerMesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
	/** How far across a pixel of the well is in the scene's units. */
	readonly pixelSize: number;
	/** How many of a texture's pixels make one of the well's. */
	readonly resolution: number;
	private readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D;
	private readonly geometry = new PlaneGeometry(1, 1);
	private readonly state: WidgetState;
	private readonly picker: ColourPicker;
	private readonly host: PickerHost & InputHost;
	private readonly onEvent: ColourWell3DOptions['onEvent'];
	private readonly requestRender: (() => void) | undefined;
	private readonly raycaster = new Raycaster();
	/** The colour as last laid out, in the well's pixels. */
	private laid: Laid;
	/** Whether something the colour is painted from changed since it was last painted, and whether a paint is asked for. */
	private dirty = true;
	private queued = false;
	private disposed = false;
	private ownEyedropper: Eyedropper<object>;
	private rendererSet: Renderer;
	private focusedWidget: ColourWidget | null = null;
	/** Whether a pointer is over the well or its picker, as last told. */
	private over = false;
	private held: Held | null = null;
	/** The camera the scene is seen through and the element it is shown in, which the page's input is placed over; null for none, as in VR. */
	private view: { camera: Camera; element: HTMLElement } | null = null;
	private unlisten: (() => void) | null = null;
	private readonly facesLoaded = () => this.invalidate();

	/**
	 * @param options - The colour widget's options (`readColourOptions`), what the well tells, its eyedropper, what draws its wheel, its size and sharpness, and how it asks for a frame
	 */
	constructor(options: ColourWell3DOptions = {}) {
		super();
		loadFaces();
		this.widget = readColourOptions(options);
		this.onEvent = options.onEvent;
		this.ownEyedropper = options.eyedropper ?? SCREEN;
		this.rendererSet = rendererOf(options.renderer);
		this.pixelSize = positive(options.pixelSize, PIXEL_SIZE);
		this.resolution = positive(options.resolution, RESOLUTION);
		this.requestRender = options.requestRender;
		this.state = restingState(this.widget);
		this.canvas = document.createElement('canvas');
		this.ctx = this.canvas.getContext('2d')!;
		this.laid = layoutWell(this.widget, this.state, pageMeasure);
		this.host = this.hostOf();
		this.picker = new ColourPicker(this.host);
		this.colourMesh = planeOf(this.geometry, textureOf(this.canvas));
		this.pickerMesh = planeOf(this.geometry, textureOf(this.picker.canvas));
		this.pickerMesh.visible = false;
		this.colourMesh.onBeforeRender = (renderer) => warnIfToneMapped(renderer);
		// A plane hidden is hit by no ray, as three.js's raycasting, and an app's, would otherwise hit it.
		for (const mesh of [this.colourMesh, this.pickerMesh]) {
			const raycast = mesh.raycast.bind(mesh);
			mesh.raycast = (raycaster, intersects) => {
				if (mesh.visible) raycast(raycaster, intersects);
			};
		}
		this.add(this.colourMesh, this.pickerMesh);
		// Faces that arrive after the first paint have it painted again in its own.
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
	 * Writes the colour, as a script writes one: held as `formatColour` writes
	 * a colour, its alpha dropped where the widget carries none, an open
	 * picker reading it afresh, and nothing told.
	 *
	 * @returns Whether the text reads as a colour; one that does not is refused
	 */
	setValue(text: string): boolean {
		const colour = parseColour(text);
		if (!colour) return false;
		const hex = formatColour(this.widget.alpha ? colour : { r: colour.r, g: colour.g, b: colour.b });
		if (this.state.text === hex) return true;
		this.state.text = hex;
		if (this.open) this.picker.sync();
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

	/** Whether the picker is open on the well. */
	get open(): boolean {
		return this.picker.openColor === this.widget;
	}

	/** Opens the picker, giving the well the focus, as a click on it does; nothing for a disabled well. */
	openPicker(): void {
		if (this.disposed || this.state.disabled || this.open) return;
		this.picker.open(this.widget);
		this.focusColour();
	}

	/** Shuts the picker; the colour stays as it was last taken. */
	closePicker(): void {
		if (this.open) this.picker.close();
	}

	/** The eyedropper the picker shows. */
	get eyedropper(): Eyedropper<object> {
		return this.ownEyedropper;
	}

	/** Sets the eyedropper the picker shows: an open picker reads it afresh, one armed on a view it no longer picks from put away. */
	setEyedropper(eyedropper: Eyedropper<object>): void {
		this.ownEyedropper = eyedropper;
		if (this.open) this.picker.dropperChanged();
	}

	/** Whether the picker's eyedropper is armed on the app's view, whose presses the app takes and hands the colour under them to the picker (`takeDropped`). */
	get dropping(): boolean {
		return this.picker.dropping();
	}

	/** A colour the app read off its view under the eyedropper's press, as the press goes down and moves, and done as it is let go; null for none. */
	takeDropped(rgb: readonly [number, number, number] | null, done: boolean): void {
		this.picker.takeDropped(rgb ? [rgb[0], rgb[1], rgb[2]] : null, done);
	}

	/** What draws the picker's wheel. */
	get renderer(): Renderer {
		return this.rendererSet;
	}

	/** Sets what draws the picker's wheel, as the scene's renderer changes: an open picker is painted again by it. */
	setRenderer(renderer: Renderer): void {
		const set = rendererOf(renderer);
		if (set === this.rendererSet) return;
		this.rendererSet = set;
		if (this.open) this.picker.relay();
	}

	/** Sets the camera the scene is seen through and the element it is shown in, which the page's input is placed over as a field is typed into; null for none, as in VR, where the input is out of sight. */
	setView(camera: Camera | null, element?: HTMLElement): void {
		this.view = camera && element ? { camera, element } : null;
		this.placeInput();
	}

	/**
	 * Listens on the element the scene is shown in, the renderer's canvas, for
	 * the pointer, each event's ray cast from the camera; the well's view set
	 * to them (`setView`). A press the well takes goes no further, so the
	 * app's own controls listening on the element after it do not see it.
	 *
	 * @returns What stops the listening
	 */
	listen(element: HTMLElement, camera: Camera): () => void {
		this.unlisten?.();
		this.setView(camera, element);
		const raycaster = new Raycaster();
		const rayOf = (event: PointerEvent): Ray => {
			const rect = element.getBoundingClientRect();
			raycaster.setFromCamera(new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2), camera);
			return raycaster.ray;
		};
		const down = (event: PointerEvent) => {
			if (event.button !== 0 || !this.pointerDown(rayOf(event), event.pointerId)) return;
			event.stopImmediatePropagation();
			try {
				element.setPointerCapture(event.pointerId);
			} catch {
				// A pointer already gone cannot be captured.
			}
		};
		const move = (event: PointerEvent) => {
			const holding = this.held !== null;
			if (this.pointerMove(rayOf(event), event.pointerId) && holding) event.stopImmediatePropagation();
		};
		const up = (event: PointerEvent) => {
			if (this.pointerUp(rayOf(event), event.pointerId)) event.stopImmediatePropagation();
		};
		const cancel = (event: PointerEvent) => this.pointerCancel(event.pointerId);
		const leave = (event: PointerEvent) => {
			if (!this.held) this.pointerMove(null, event.pointerId);
		};
		// The browser's own focus change and drag stay off a press the well holds.
		const mousedown = (event: MouseEvent) => {
			if (this.held) event.preventDefault();
		};
		const listened: [string, EventListener][] = [['pointerdown', down as EventListener], ['pointermove', move as EventListener], ['pointerup', up as EventListener], ['pointercancel', cancel as EventListener], ['pointerleave', leave as EventListener], ['mousedown', mousedown as EventListener]];
		for (const [type, listener] of listened) element.addEventListener(type, listener, { capture: true });
		const unlisten = () => {
			for (const [type, listener] of listened) element.removeEventListener(type, listener, { capture: true });
			if (this.unlisten === unlisten) this.unlisten = null;
		};
		this.unlisten = unlisten;
		return unlisten;
	}

	/** Lets the well go: its picker shut, its focus let go, its listening stopped, its textures, materials and plane let go, and it taken out of the scene. */
	dispose(): void {
		if (this.disposed) return;
		if (this.held) this.letGo(null);
		this.picker.forgetPress();
		this.picker.close();
		const input = pageInputMade();
		if (input?.focusedHost === this.host) input.blur();
		this.disposed = true;
		wells.delete(this);
		this.unlisten?.();
		if (typeof document !== 'undefined') document.fonts?.removeEventListener?.('loadingdone', this.facesLoaded);
		for (const mesh of [this.colourMesh, this.pickerMesh]) {
			mesh.material.map?.dispose();
			mesh.material.dispose();
		}
		this.geometry.dispose();
		this.removeFromParent();
	}

	// ---------------------------------------------------------------------
	// The pointer
	// ---------------------------------------------------------------------

	/**
	 * A press going down along a ray, in world space: on the picker, it is the
	 * picker's, and gives the well the focus back; on the colour, it is held
	 * to be a click as it is let go there unmoved. A press on neither lets the
	 * well's focus go, but while the app's own pick or a view's is armed,
	 * whose presses are the app's.
	 *
	 * @param pointerId - Which pointer pressed, for a scene with more than one, as two controllers
	 * @returns Whether the well took the press, which the app then leaves be
	 */
	pointerDown(ray: Ray, pointerId = 0): boolean {
		if (this.disposed) return false;
		if (this.held) {
			// Its own pointer down again means its release was never seen; another pointer leaves it held.
			if (pointerId !== this.held.pointerId) return false;
			this.letGo(null);
		}
		const hit = this.hitOf(ray);
		if (!hit) {
			this.pressedElsewhere();
			return false;
		}
		if (hit.on === 'picker') {
			const at = this.picker.press(hit.uv);
			if (!at) return false;
			if (this.open && this.focusedWidget !== this.widget) this.focusColour();
			this.held = { pointerId, on: 'picker', at, moved: false };
			return true;
		}
		this.picker.forgetPress();
		this.letOthersFocusGo();
		const { box } = this.laid;
		this.held = { pointerId, on: 'colour', at: { x: box.x + hit.uv.x * box.w, y: box.y + (1 - hit.uv.y) * box.h }, moved: false };
		return true;
	}

	/**
	 * The pointer moving along a ray: a held press's move, taken along the
	 * plane it went down on wherever the ray goes, which past a drag's start
	 * moves it; otherwise the pointer over the picker, whose region under it
	 * is lit, or over the colour, the well drawn hovered and told `enter` and
	 * `leave` as the pointer comes and goes. Null for the pointer gone.
	 *
	 * @returns Whether the well took the move: a press it holds, or the pointer over it
	 */
	pointerMove(ray: Ray | null, pointerId = 0): boolean {
		if (this.disposed) return false;
		const held = this.held;
		if (held) {
			if (pointerId !== held.pointerId) return false;
			const at = ray ? this.pixelsAlong(ray, held.on) : null;
			if (!at) return true;
			if (!held.moved && Math.hypot(at.x - held.at.x, at.y - held.at.y) > TOUCH_SLOP) held.moved = true;
			if (held.on === 'picker') this.picker.move(at.x, at.y, held.moved);
			return true;
		}
		const hit = ray ? this.hitOf(ray) : null;
		this.picker.forgetPress();
		this.picker.hover(hit?.on === 'picker' ? hit.uv : null);
		this.pointAt(hit !== null && (hit.on === 'colour' || this.open));
		return hit !== null;
	}

	/**
	 * A held press let go along a ray: the picker's released where the ray
	 * meets its plane, and one let go unmoved on what it went down on clicks
	 * there: a region of the picker, or the colour, which opens the picker or
	 * shuts it, takes the focus and tells `click`. Null for a release with no
	 * ray, which clicks nothing.
	 *
	 * @returns Whether the press was the well's
	 */
	pointerUp(ray: Ray | null, pointerId = 0): boolean {
		if (!this.held || pointerId !== this.held.pointerId) return false;
		this.letGo(ray);
		return true;
	}

	/** A held press taken away, as the browser does: let go where it is, clicking nothing. */
	pointerCancel(pointerId = 0): void {
		if (this.held && pointerId === this.held.pointerId) this.letGo(null);
	}

	/** A press that landed on none of the scene's objects the app listens to: as a press on neither plane, it lets the well's focus go. */
	pointerMissed(): void {
		if (!this.held) this.pressedElsewhere();
	}

	// ---------------------------------------------------------------------
	// Painting
	// ---------------------------------------------------------------------

	/**
	 * Lays the colour out and paints it where something changed since it was
	 * last painted, the picker open on it laid out again and painted, and
	 * places the page's input over what holds it. Called on a microtask after
	 * a change; a test calls it to paint at once.
	 */
	update(): void {
		this.queued = false;
		if (this.disposed) return;
		const relaid = this.dirty;
		if (relaid) {
			this.dirty = false;
			this.laid = layoutWell(this.widget, this.state, pageMeasure);
			this.paintColour();
			if (this.open) this.picker.relay();
		}
		this.placeInput();
		if (relaid) this.requestRender?.();
	}

	/** Has the colour painted again on a microtask, as the script that changed it ends. */
	private invalidate(): void {
		this.dirty = true;
		if (this.disposed || this.queued) return;
		this.queued = true;
		queueMicrotask(() => this.update());
	}

	/** Paints the colour into its canvas at the well's resolution, a canvas of another size given a texture of its own, and stands its plane at its box. */
	private paintColour(): void {
		const { box } = this.laid;
		const across = Math.max(1, Math.round(box.w * this.resolution));
		const down = Math.max(1, Math.round(box.h * this.resolution));
		const material = this.colourMesh.material;
		if (this.canvas.width !== across || this.canvas.height !== down) {
			this.canvas.width = across;
			this.canvas.height = down;
			material.map?.dispose();
			material.map = textureOf(this.canvas);
		}
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);
		this.ctx.clearRect(0, 0, across, down);
		this.ctx.setTransform(this.resolution, 0, 0, this.resolution, -box.x * this.resolution, -box.y * this.resolution);
		paintWell(this.ctx, this.laid);
		if (material.map) material.map.needsUpdate = true;
		this.stand(this.colourMesh, box, 0);
	}

	/** Stands a plane over a box of the well's pixels, the colour's box centred on the well's origin, lifted toward the viewer by a number of pixels. */
	private stand(mesh: Mesh, box: Box, lift: number): void {
		const size = this.pixelSize;
		const { x, y } = this.centre();
		mesh.position.set((box.x + box.w / 2 - x) * size, (y - (box.y + box.h / 2)) * size, lift * size);
		mesh.scale.set(box.w * size, box.h * size, 1);
	}

	/** The colour's centre, in the well's pixels: the well's origin. */
	private centre(): { x: number; y: number } {
		const { box } = this.laid;
		return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
	}

	// ---------------------------------------------------------------------
	// The picker's host
	// ---------------------------------------------------------------------

	/** What the picker asks of the well, and the page's input tells it. */
	private hostOf(): PickerHost & InputHost {
		const well = this;
		return {
			laidOf: () => (well.disposed ? null : well.laid),
			stateOf: () => well.state,
			invalidate: () => well.invalidate(),
			tell: (_widget, event) => well.onEvent?.(event, well),
			width: ROOM,
			height: ROOM,
			get resolution() {
				return well.resolution;
			},
			measure: pageMeasure,
			placePopover: (box) => well.placePicker(box),
			standing: (box) => ({ box, side: null }),
			popoverPainted: (resized) => well.pickerPainted(resized),
			get focused() {
				return well.focusedWidget;
			},
			focus: () => well.focusColour(),
			focusAfter: () => false,
			get inputHost() {
				return well.host;
			},
			closeOther: () => {
				for (const other of wells) if (other !== well) other.closePicker();
			},
			dropperOf: () => well.ownEyedropper,
			get renderer() {
				return well.rendererSet;
			},
			onInput: (value) => {
				if (well.focusedWidget && !well.disposed) well.picker.input(well.widget, value);
			},
			onKey: (event) => well.keyed(event),
			onBlur: () => well.blurred(),
			putAway: () => {
				if (!well.focusedWidget || !well.picker.inField(well.focusedWidget)) return false;
				well.picker.returnToBody();
				return true;
			},
		};
	}

	/** Stands the picker's plane at its box and shows it, or hides it, the picker shut. */
	private placePicker(box: Box | null): void {
		this.pickerMesh.visible = box !== null;
		if (box) this.stand(this.pickerMesh, box, LIFT);
		this.placeInput();
		this.requestRender?.();
	}

	/** The picker painted again: its texture read afresh, or a new one for a canvas resized. */
	private pickerPainted(resized: boolean): void {
		const material = this.pickerMesh.material;
		if (resized || !material.map) {
			material.map?.dispose();
			material.map = textureOf(this.picker.canvas);
		} else {
			material.map.needsUpdate = true;
		}
		this.placeInput();
		this.requestRender?.();
	}

	/**
	 * Gives the colour the page's input: drawn focused, and worked by key
	 * through the input, out of sight; another host's focus let go first.
	 * Where a field of the picker holds the input, it goes back to the
	 * colour's body.
	 */
	private focusColour(): void {
		const input = pageInput();
		if (this.focusedWidget !== this.widget) {
			if (input.focused && input.focusedHost !== this.host) input.blur();
			this.focusedWidget = this.widget;
			this.state.focused = true;
			this.invalidate();
		} else if (this.picker.inField(this.widget)) {
			this.picker.returnToBody();
			return;
		}
		input.focus('colour', this.state.text, this.host);
		this.placeInput();
	}

	/** A key pressed in the page's input: a field of the picker holding it takes its keys; Tab on an open picker enters its hex field, and Shift+Tab, or Tab on a shut one, lets the input go; the rest work the picker. */
	private keyed(event: KeyboardEvent): boolean {
		const widget = this.focusedWidget;
		if (!widget || this.disposed) return false;
		if (this.picker.inField(widget)) return this.picker.fieldKeyOf(widget, event);
		if (event.key === 'Tab') {
			if (!event.shiftKey && this.open) {
				this.picker.enterHex();
				return true;
			}
			pageInput().blur();
			return true;
		}
		return this.picker.key(widget, event);
	}

	/** The focus gone from the page's input: the colour drawn resting and the picker left open, a field that held the input letting it go; a hand-off between the picker's body and a field leaves both. */
	private blurred(): void {
		if (this.picker.handing) return;
		const widget = this.focusedWidget;
		if (!widget) return;
		this.focusedWidget = null;
		this.state.focused = false;
		this.invalidate();
		if (this.picker.inField(widget)) this.picker.dropField();
	}

	/**
	 * Places the page's input, where the well holds it: over the picker's
	 * field that holds it, shown in the field's look at the scale the view
	 * shows the field at, or over the colour's face, out of sight. With no
	 * view, or the plane out of it, the input stands out of sight, and what is
	 * typed shows in the field the picker paints.
	 */
	private placeInput(): void {
		const input = pageInputMade();
		if (!input?.focused || input.focusedHost !== this.host) return;
		if (this.disposed) {
			input.blur();
			return;
		}
		const field = this.picker.placement(this.widget, this.laid.style.opacity);
		if (field) {
			const placed = this.onScreen(this.pickerMesh, field.field, field.box, input.holder);
			if (placed) input.place(placed.rect, { ...field.look, scale: placed.scale });
			else input.place(null);
			return;
		}
		const { face, box } = this.laid;
		input.place(this.onScreen(this.colourMesh, { x: face.x - box.x, y: face.y - box.y, w: face.w, h: face.h }, box, input.holder)?.rect ?? null);
	}

	/** Where a part of a plane shows in the view, a box of the plane's pixels, as a rectangle of the holder's pixels around it, and how many of them make one of the plane's; null with no view, or the part not before the camera. */
	private onScreen(mesh: Mesh, part: Box, whole: { w: number; h: number }, holder: HTMLElement): { rect: InputRect; scale: number } | null {
		const view = this.view;
		if (!view || !mesh.visible || whole.w <= 0 || whole.h <= 0 || part.w <= 0) return null;
		mesh.updateWorldMatrix(true, false);
		const screen = view.element.getBoundingClientRect();
		const held = holder.getBoundingClientRect();
		let left = Infinity;
		let top = Infinity;
		let right = -Infinity;
		let bottom = -Infinity;
		for (const [x, y] of [[part.x, part.y], [part.x + part.w, part.y], [part.x, part.y + part.h], [part.x + part.w, part.y + part.h]]) {
			const point = new Vector3(x / whole.w - 0.5, 0.5 - y / whole.h, 0).applyMatrix4(mesh.matrixWorld).project(view.camera);
			if (!(point.z >= -1 && point.z <= 1)) return null;
			const across = screen.left + ((point.x + 1) / 2) * screen.width;
			const down = screen.top + ((1 - point.y) / 2) * screen.height;
			left = Math.min(left, across);
			right = Math.max(right, across);
			top = Math.min(top, down);
			bottom = Math.max(bottom, down);
		}
		return { rect: { left: left - held.left, top: top - held.top, width: right - left, height: bottom - top }, scale: (right - left) / part.w };
	}

	// ---------------------------------------------------------------------
	// Where a ray lands
	// ---------------------------------------------------------------------

	/** The plane a ray first meets, the picker's before the colour's, and the point of it the ray meets, from its left and up from its foot; null for neither, or a well not shown. */
	private hitOf(ray: Ray): { on: On; uv: Vector2 } | null {
		if (!this.visible) return null;
		this.updateWorldMatrix(true, true);
		this.raycaster.ray.copy(ray);
		const planes = this.pickerMesh.visible ? [this.pickerMesh, this.colourMesh] : [this.colourMesh];
		for (const hit of this.raycaster.intersectObjects(planes, false)) {
			if (hit.uv) return { on: hit.object === this.pickerMesh ? 'picker' : 'colour', uv: hit.uv.clone() };
		}
		return null;
	}

	/** Where a ray meets the plane of the picker or the colour, carried on past its edges, in the well's pixels; null where the ray runs along it or away from it. */
	private pixelsAlong(ray: Ray, on: On): { x: number; y: number } | null {
		const mesh = on === 'picker' ? this.pickerMesh : this.colourMesh;
		this.updateWorldMatrix(true, true);
		const normal = new Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
		const point = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
		const met = ray.intersectPlane(new Plane().setFromNormalAndCoplanarPoint(normal, point), new Vector3());
		if (!met) return null;
		const local = this.worldToLocal(met);
		const { x, y } = this.centre();
		return { x: x + local.x / this.pixelSize, y: y - local.y / this.pixelSize };
	}

	/** Lets the held press go, at a ray or with none: released on the picker, or cancelled there, and the click of a press let go unmoved where it went down. */
	private letGo(ray: Ray | null): void {
		const held = this.held;
		if (!held) return;
		this.held = null;
		if (held.on === 'picker') {
			const at = ray ? this.pixelsAlong(ray, 'picker') : null;
			if (at) this.picker.release(at.x, at.y);
			else this.picker.cancel();
			const hit = ray && !held.moved ? this.hitOf(ray) : null;
			if (hit?.on === 'picker') this.picker.click(hit.uv);
			return;
		}
		this.picker.forgetPress();
		const hit = ray && !held.moved ? this.hitOf(ray) : null;
		if (hit?.on === 'colour') this.clickColour();
	}

	/** A click on the colour: the picker opened on it, or shut where it is open, the focus taken, and `click` told; a disabled well answers nothing. */
	private clickColour(): void {
		this.letOthersFocusGo();
		if (this.state.disabled) return;
		if (this.open) this.picker.close();
		else this.picker.open(this.widget);
		this.focusColour();
		this.onEvent?.('click', this);
	}

	/** A pointer over the well or its picker, or off both: the colour drawn hovered or resting, and `enter` or `leave` told as that changes. */
	private pointAt(over: boolean): void {
		if (this.over === over) return;
		this.over = over;
		if (!this.state.disabled) {
			this.state.hovered = over;
			this.invalidate();
		}
		this.onEvent?.(over ? 'enter' : 'leave', this);
	}

	/** A press on neither plane: the well's focus let go, the picker staying open, but while the app's own pick or a view's is armed, whose presses are the app's. */
	private pressedElsewhere(): void {
		if (this.picker.picking() || this.picker.dropping()) return;
		const input = pageInputMade();
		if (input?.focused && input.focusedHost === this.host) input.blur();
	}

	/** Takes the focus from another host that has it. */
	private letOthersFocusGo(): void {
		const input = pageInputMade();
		if (input?.focused && input.focusedHost !== this.host) input.blur();
	}
}
