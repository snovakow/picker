// @vitest-environment jsdom
/**
 * @fileoverview What draws the picker's wheel: the renderer asked for, else
 * the other where it cannot be had, made once and shared, on a stand-in for
 * WebGL's renderer, jsdom having no WebGL, whose context the case gives at
 * once, later or never, takes away, or loses as it draws.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/** A WebGL stand-in made: its canvas, whether it can draw, what it tells, how often it drew, and whether its next draw draws. */
interface StandIn {
	canvas: HTMLCanvasElement;
	ready: boolean;
	events: { ready(): void; lost(): void };
	draws: number;
	drew: boolean;
	draw(): boolean;
}

/** The stand-ins made, and how the next is made: with its context, waiting for it, with none, or throwing. */
const standIns = vi.hoisted(() => ({ next: 'ready' as 'ready' | 'waits' | 'none' | 'throws', made: [] as StandIn[] }));

vi.mock('./wheelWebGL.ts', () => ({
	makeWebGLWheel: (canvas: HTMLCanvasElement, events: StandIn['events']): StandIn | null => {
		if (standIns.next === 'none') return null;
		if (standIns.next === 'throws') throw new Error('no context');
		const made: StandIn = {
			canvas,
			ready: standIns.next === 'ready',
			events,
			draws: 0,
			drew: true,
			draw() {
				made.draws++;
				return made.drew;
			},
		};
		standIns.made.push(made);
		return made;
	},
}));

import { RENDERERS, forgetRenderers, rendererOf, wheelImage } from './renderer.ts';
import { wheelGeometry, type WheelTerms } from './wheel.ts';

const GEOMETRY = wheelGeometry(360, 360, 180, 2);
const TERMS: WheelTerms = { unit: [1, 0], hue: [255, 0, 0], base: [255, 0, 0], saturation: 1, intensity: 0.5 };
/** A picker's wheel asked of a renderer, the picker painted again by `paint`. */
const ask = (renderer: 'webgl' | 'webgpu', paint: () => void = () => { }) => wheelImage(renderer, GEOMETRY, TERMS, paint);

afterEach(() => {
	forgetRenderers();
	standIns.next = 'ready';
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
		expect(first).toBe(standIns.made[0].canvas);
		expect(ask('webgl')).toBe(first);
		expect(standIns.made).toHaveLength(1);
		expect(standIns.made[0].draws).toBe(2);
	});

	it('draws a wheel asked of WebGPU by WebGL, no WebGPU renderer being built, the one renderer shared by both', () => {
		const drawn = ask('webgpu');
		expect(standIns.made).toHaveLength(1);
		expect(drawn).toBe(standIns.made[0].canvas);
		expect(ask('webgl')).toBe(drawn);
		expect(ask('webgpu')).toBe(drawn);
		expect(standIns.made).toHaveLength(1);
	});

	it('shows no wheel where no renderer can be had, asking for one no more, a maker that throws among them', () => {
		standIns.next = 'none';
		expect(ask('webgl')).toBeNull();
		standIns.next = 'ready';
		expect(ask('webgl')).toBeNull();
		expect(ask('webgpu')).toBeNull();
		expect(standIns.made).toHaveLength(0);
		forgetRenderers();
		standIns.next = 'throws';
		expect(ask('webgpu')).toBeNull();
		standIns.next = 'ready';
		expect(ask('webgl')).toBeNull();
		expect(standIns.made).toHaveLength(0);
	});

	it('draws nothing while its renderer\'s context is to come, and has each picker that asked paint again once as it comes', () => {
		standIns.next = 'waits';
		const one = vi.fn();
		const two = vi.fn();
		expect(ask('webgl', one)).toBeNull();
		expect(ask('webgl', one)).toBeNull();
		// Asked of WebGPU, the wheel waits on WebGL's context too.
		expect(ask('webgpu', two)).toBeNull();
		expect(standIns.made).toHaveLength(1);
		const [made] = standIns.made;
		expect(made.draws).toBe(0);
		made.ready = true;
		made.events.ready();
		expect(one).toHaveBeenCalledTimes(1);
		expect(two).toHaveBeenCalledTimes(1);
		expect(ask('webgl', one)).toBe(made.canvas);
		// Told again, it has no one paint again.
		made.events.ready();
		expect(one).toHaveBeenCalledTimes(1);
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
		// A context that never came: the pickers waiting paint again, and the renderer is asked for no more.
		forgetRenderers();
		standIns.made.length = 0;
		standIns.next = 'waits';
		const waiting = vi.fn();
		expect(ask('webgl', waiting)).toBeNull();
		standIns.made[0].events.lost();
		expect(waiting).toHaveBeenCalledTimes(1);
		standIns.next = 'ready';
		expect(ask('webgl')).toBeNull();
		expect(ask('webgpu')).toBeNull();
		expect(standIns.made).toHaveLength(1);
	});
});
