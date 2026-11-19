/**
 * @fileoverview What draws the picker's wheel (`Renderer`): WebGL, or
 * WebGPU. A host sets the one its picker draws by (`PickerHost.renderer`),
 * WebGL where it sets none, so a page or a scene that draws by WebGL or by
 * WebGPU, as three.js's two renderers do, has the wheel drawn the same way.
 * Every picker draws by one shared renderer of each kind, made as the first
 * wheel asks for it, on a canvas of its own, whose drawing the picker
 * copies into its own canvas in the same task (`wheelImage`).
 *
 * Where the renderer asked for cannot be had, as where the browser gives it
 * no context, the wheel is drawn by the other, and where neither can be,
 * the picker shows no wheel. A renderer whose context comes later draws
 * nothing till then, and the pickers that asked for it are painted again as
 * it comes; one whose context is lost is made again as the next wheel asks,
 * and one whose context never came is not asked for again.
 *
 * WebGL's renderer is built (wheelWebGL.ts); WebGPU's is not yet, so a
 * picker set to WebGPU has its wheel drawn by WebGL.
 */

import { makeWebGLWheel } from './wheelWebGL.ts';
import type { WheelGeometry, WheelTerms } from './wheel.ts';

/** What can draw the wheel, as `Renderer` names it. */
export const RENDERERS = ['webgl', 'webgpu'] as const;

/** What draws the picker's wheel: WebGL, or WebGPU. */
export type Renderer = (typeof RENDERERS)[number];

/** A renderer of the wheel: the canvas it draws into, whether it can draw yet, and its drawing. */
export interface WheelRenderer {
	/** The canvas the wheel is drawn into, read or copied in the same task it is drawn in. */
	readonly canvas: HTMLCanvasElement;
	/** Whether it can draw: one whose context comes later cannot till then. */
	readonly ready: boolean;
	/** Clears the canvas and draws the wheel for the geometry and terms given; whether it drew, which one without its context does not. */
	draw(geometry: WheelGeometry, terms: WheelTerms): boolean;
}

/** What a renderer tells as its context comes or goes. */
export interface RendererEvents {
	/** Its context came, to one made without it: it can draw now. */
	ready(): void;
	/** Its context went, or never came: it draws no more. */
	lost(): void;
}

/** Makes a renderer on a canvas, telling `events` as its context comes or goes; null where it cannot be had. */
export type WheelMaker = (canvas: HTMLCanvasElement, events: RendererEvents) => WheelRenderer | null;

/** The renderers that are built, by what they draw by. */
const MAKERS: { readonly [kind in Renderer]?: WheelMaker } = { webgl: makeWebGLWheel };

/** The renderer that draws where the one asked for cannot be had. */
const OTHER: Readonly<Record<Renderer, Renderer>> = { webgl: 'webgpu', webgpu: 'webgl' };

/** The shared renderer of one kind: the one made, null while there is none; whether it cannot be had; and the pickers waiting to paint again as it comes or goes. */
interface Shared {
	renderer: WheelRenderer | null;
	refused: boolean;
	waiting: Set<() => void>;
}

const shared = new Map<Renderer, Shared>();

const sharedOf = (kind: Renderer): Shared => {
	let slot = shared.get(kind);
	if (!slot) {
		slot = { renderer: null, refused: false, waiting: new Set() };
		shared.set(kind, slot);
	}
	return slot;
};

/** Has the pickers waiting on a renderer paint again, each once. */
const tellWaiting = (slot: Shared): void => {
	const waiting = [...slot.waiting];
	slot.waiting.clear();
	for (const paint of waiting) paint();
};

/** Makes the shared renderer of a kind where it can be had, and marks it refused where it cannot. */
const make = (kind: Renderer, slot: Shared): void => {
	const maker = MAKERS[kind];
	let made: WheelRenderer | null = null;
	// Whether its context ever came: one lost before it did is not asked for again.
	let came = false;
	const events: RendererEvents = {
		ready: () => {
			if (!made || slot.renderer !== made) return;
			came = true;
			tellWaiting(slot);
		},
		lost: () => {
			if (!made || slot.renderer !== made) return;
			slot.renderer = null;
			if (!came) slot.refused = true;
			tellWaiting(slot);
		},
	};
	try {
		made = maker ? maker(document.createElement('canvas'), events) : null;
	} catch {
		made = null;
	}
	if (!made) {
		slot.refused = true;
		return;
	}
	came = made.ready;
	slot.renderer = made;
};

/** A renderer as a host or a page's script sets it, read without types: WebGL where it is none of `RENDERERS`. */
export const rendererOf = (set: unknown): Renderer => ((RENDERERS as readonly unknown[]).includes(set) ? (set as Renderer) : 'webgl');

/**
 * The wheel drawn for a geometry and a colour's terms, by the renderer
 * asked for, else the other where the one asked for cannot be had, on its
 * canvas, to be copied in the same task; null where none draws it. Where
 * the renderer that would draw it cannot draw yet, or loses its context
 * drawing, `whenReady` is called as it comes or goes, once however often it
 * was asked.
 *
 * @param asked - The renderer the picker is set to draw by
 * @param whenReady - Paints the picker again
 */
export const wheelImage = (asked: Renderer, geometry: WheelGeometry, terms: WheelTerms, whenReady: () => void): HTMLCanvasElement | null => {
	for (const kind of [asked, OTHER[asked]]) {
		const slot = sharedOf(kind);
		if (!slot.renderer && !slot.refused) make(kind, slot);
		const renderer = slot.renderer;
		if (!renderer) continue;
		if (renderer.ready && renderer.draw(geometry, terms)) return renderer.canvas;
		slot.waiting.add(whenReady);
		return null;
	}
	return null;
};

/** Forgets every shared renderer and what could not be had, so the next wheel makes its renderer afresh, as the tests do between cases. */
export const forgetRenderers = (): void => {
	shared.clear();
};
