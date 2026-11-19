// @vitest-environment jsdom
/**
 * @fileoverview What draws the picker's wheel: the renderer asked for, else
 * the other where it cannot be had, each made once and shared, on stand-ins
 * for WebGL's and WebGPU's renderers, jsdom having neither, whose context
 * the case gives at once, later or never, takes away, or loses as it draws.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type Kind = 'webgl' | 'webgpu';
/** How a stand-in is made: with its context, waiting for it, with none, or throwing. */
type How = 'ready' | 'waits' | 'none' | 'throws';

/** A stand-in made: what it stands in for, its canvas, whether it can draw, what it tells, how often it drew, and whether its next draw draws. */
interface StandIn {
	kind: Kind;
	canvas: HTMLCanvasElement;
	ready: boolean;
	events: { ready(): void; lost(): void };
	draws: number;
	drew: boolean;
	draw(): boolean;
}

/** The stand-ins made, how the next of each kind is made, and the maker standing in for each kind's. */
const standIns = vi.hoisted(() => {
	const held = { next: { webgl: 'ready', webgpu: 'ready' } as Record<Kind, How>, made: [] as StandIn[] };
	const makerOf = (kind: Kind) => (canvas: HTMLCanvasElement, events: StandIn['events']): StandIn | null => {
		const how = held.next[kind];
		if (how === 'none') return null;
		if (how === 'throws') throw new Error('no context');
		const made: StandIn = {
			kind,
			canvas,
			ready: how === 'ready',
			events,
			draws: 0,
			drew: true,
			draw() {
				made.draws++;
				return made.drew;
			},
		};
		held.made.push(made);
		return made;
	};
	return Object.assign(held, { makerOf });
});

vi.mock('./wheelWebGL.ts', () => ({ makeWebGLWheel: standIns.makerOf('webgl') }));
vi.mock('./wheelWebGPU.ts', () => ({ makeWebGPUWheel: standIns.makerOf('webgpu') }));

import { RENDERERS, forgetRenderers, rendererOf, wheelImage } from './renderer.ts';
import { wheelGeometry, type WheelTerms } from './wheel.ts';

const GEOMETRY = wheelGeometry(360, 360, 180, 2);
const TERMS: WheelTerms = { unit: [1, 0], hue: [255, 0, 0], base: [255, 0, 0], saturation: 1, intensity: 0.5 };
/** A picker's wheel asked of a renderer, the picker painted again by `paint`. */
const ask = (renderer: Kind, paint: () => void = () => { }) => wheelImage(renderer, GEOMETRY, TERMS, paint);
/** The stand-ins made of a kind. */
const madeOf = (kind: Kind) => standIns.made.filter((made) => made.kind === kind);

afterEach(() => {
	forgetRenderers();
	standIns.next = { webgl: 'ready', webgpu: 'ready' };
	standIns.made.length = 0;
});

describe('what draws the wheel', () => {
	it('names WebGL and WebGPU, and reads one set without types as WebGL', () => {
		expect(RENDERERS).toEqual(['webgl', 'webgpu']);
		expect(rendererOf('webgl')).toBe('webgl');
		expect(rendererOf('webgpu')).toBe('webgpu');
		for (const set of [undefined, null, 'WebGPU', 'sideways', 3, {}]) expect(rendererOf(set)).toBe('webgl');
	});

	it('draws the wheel by WebGL on a canvas of its own, made as the first wheel asks and shared by every wheel after', () => {
		const first = ask('webgl');
		expect(standIns.made).toHaveLength(1);
		expect(standIns.made[0].kind).toBe('webgl');
		expect(first).toBe(standIns.made[0].canvas);
		expect(ask('webgl')).toBe(first);
		expect(standIns.made).toHaveLength(1);
		expect(standIns.made[0].draws).toBe(2);
	});

	it('draws a wheel asked of WebGPU by WebGPU, on a canvas of its own apart from WebGL\'s, each shared by the wheels asked of it', () => {
		const gpu = ask('webgpu');
		expect(madeOf('webgpu')).toHaveLength(1);
		expect(gpu).toBe(madeOf('webgpu')[0].canvas);
		const gl = ask('webgl');
		expect(gl).toBe(madeOf('webgl')[0].canvas);
		expect(gl).not.toBe(gpu);
		expect(ask('webgpu')).toBe(gpu);
		expect(ask('webgl')).toBe(gl);
		expect(standIns.made).toHaveLength(2);
	});

	it('draws by the other where the one asked for cannot be had: by WebGL where the browser offers no WebGPU, by WebGPU where it gives no WebGL', () => {
		standIns.next.webgpu = 'none';
		expect(ask('webgpu')).toBe(madeOf('webgl')[0].canvas);
		expect(ask('webgpu')).toBe(madeOf('webgl')[0].canvas);
		expect(madeOf('webgpu')).toHaveLength(0);
		forgetRenderers();
		standIns.made.length = 0;
		standIns.next = { webgl: 'throws', webgpu: 'ready' };
		expect(ask('webgl')).toBe(madeOf('webgpu')[0].canvas);
		expect(madeOf('webgl')).toHaveLength(0);
	});

	it('shows no wheel where no renderer can be had, asking for one no more, a maker that throws among them', () => {
		standIns.next = { webgl: 'none', webgpu: 'none' };
		expect(ask('webgl')).toBeNull();
		standIns.next = { webgl: 'ready', webgpu: 'ready' };
		expect(ask('webgl')).toBeNull();
		expect(ask('webgpu')).toBeNull();
		expect(standIns.made).toHaveLength(0);
		forgetRenderers();
		standIns.next = { webgl: 'throws', webgpu: 'throws' };
		expect(ask('webgpu')).toBeNull();
		standIns.next = { webgl: 'ready', webgpu: 'ready' };
		expect(ask('webgl')).toBeNull();
		expect(standIns.made).toHaveLength(0);
	});

	it('draws nothing while its renderer\'s context is to come, and has each picker that asked paint again once as it comes', () => {
		standIns.next = { webgl: 'waits', webgpu: 'waits' };
		const one = vi.fn();
		const two = vi.fn();
		expect(ask('webgl', one)).toBeNull();
		expect(ask('webgl', one)).toBeNull();
		expect(ask('webgpu', two)).toBeNull();
		expect(standIns.made).toHaveLength(2);
		const [gl] = madeOf('webgl');
		expect(gl.draws).toBe(0);
		gl.ready = true;
		gl.events.ready();
		expect(one).toHaveBeenCalledTimes(1);
		// WebGPU's device is still to come: the picker that asked it waits on.
		expect(two).not.toHaveBeenCalled();
		expect(ask('webgl', one)).toBe(gl.canvas);
		// Told again, it has no one paint again.
		gl.events.ready();
		expect(one).toHaveBeenCalledTimes(1);
		const [gpu] = madeOf('webgpu');
		gpu.ready = true;
		gpu.events.ready();
		expect(two).toHaveBeenCalledTimes(1);
		expect(ask('webgpu', two)).toBe(gpu.canvas);
	});

	it('draws by WebGL from then on where WebGPU\'s device never comes, the pickers that waited on it painted again', () => {
		standIns.next.webgpu = 'waits';
		const waiting = vi.fn();
		expect(ask('webgpu', waiting)).toBeNull();
		const [gpu] = madeOf('webgpu');
		gpu.events.lost();
		expect(waiting).toHaveBeenCalledTimes(1);
		expect(ask('webgpu', waiting)).toBe(madeOf('webgl')[0].canvas);
		expect(madeOf('webgpu')).toHaveLength(1);
		// Told again, the renderer it was changes nothing.
		gpu.ready = true;
		gpu.events.ready();
		expect(waiting).toHaveBeenCalledTimes(1);
		expect(ask('webgpu')).toBe(madeOf('webgl')[0].canvas);
	});

	it('makes its renderer again as its context is lost, has a picker whose draw it lost paint again, and asks no more for one whose context never came', () => {
		ask('webgl');
		const [lost] = standIns.made;
		lost.events.lost();
		expect(ask('webgl')).toBe(standIns.made[1].canvas);
		expect(standIns.made).toHaveLength(2);
		// The renderer it was takes no more part: told again, it changes nothing.
		lost.events.lost();
		lost.events.ready();
		expect(ask('webgl')).toBe(standIns.made[1].canvas);
		// Its context lost as it draws, it draws nothing, and the picker paints again as the loss is told.
		const [, second] = standIns.made;
		second.drew = false;
		const paint = vi.fn();
		expect(ask('webgl', paint)).toBeNull();
		expect(paint).not.toHaveBeenCalled();
		second.events.lost();
		expect(paint).toHaveBeenCalledTimes(1);
		// WebGPU's device lost after it came is asked for again, as WebGL's context is.
		ask('webgpu');
		const [gpu] = madeOf('webgpu');
		gpu.events.lost();
		expect(ask('webgpu')).toBe(madeOf('webgpu')[1].canvas);
		// A context that never came: the pickers waiting paint again, and the renderer is asked for no more, the other drawing.
		forgetRenderers();
		standIns.made.length = 0;
		standIns.next.webgl = 'waits';
		const waiting = vi.fn();
		expect(ask('webgl', waiting)).toBeNull();
		standIns.made[0].events.lost();
		expect(waiting).toHaveBeenCalledTimes(1);
		standIns.next.webgl = 'ready';
		expect(ask('webgl')).toBe(madeOf('webgpu')[0].canvas);
		expect(madeOf('webgl')).toHaveLength(1);
	});
});
