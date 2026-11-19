// @vitest-environment jsdom
/**
 * @fileoverview A colour well in a three.js scene, pointed at by rays as an
 * app's mouse or VR controller points: its colour on a plane at its origin,
 * its picker opened on a plane below as the colour is clicked, a press on the
 * picker's wheel and its drag taken along the picker's plane past its edges
 * under a well moved and turned in its scene, a click on the picker's close,
 * the pointer coming and going, one well's picker shutting another's, the
 * page's input typed into and placed over the field it is typed in, and the
 * well listening on a canvas itself. jsdom has no WebGL: the wheel's
 * renderer is a stand-in, and the 2D contexts do nothing.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./wheelWebGL.ts', () => ({ makeWebGLWheel: (canvas: HTMLCanvasElement = document.createElement('canvas')) => ({ canvas, ready: true, draw: () => true }) }));

import { Group, PerspectiveCamera, Ray, Vector3 } from 'three';
import { ColourWell3D, type ColourWell3DOptions } from './colourWell3D.ts';
import { layoutPicker, type PickerLayout } from './pickerView.ts';
import { layoutWell, restingState, type Box } from './layout.ts';
import { pageMeasure } from './pagePicker.ts';
import { forgetChosenMode } from './colourPicker.ts';
import { pageInputMade, resetPageInput } from './input.ts';

/** A context every call on which does nothing, its measures all 0, and its gradients a stop that takes none. */
const inertContext = () => new Proxy<Record<string | symbol, unknown>>({ globalAlpha: 1 }, {
	get: (held, key) => (key in held ? held[key] : key === 'measureText' ? () => ({ width: 0 }) : key === 'createLinearGradient' ? () => ({ addColorStop: () => { } }) : () => { }),
	set: (held, key, value) => {
		held[key] = value;
		return true;
	},
});

beforeAll(() => {
	// Cast to never: the spy is typed by getContext's last overload, which WebGPU's types make WebGPU's.
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => inertContext() as never);
});

const made: ColourWell3D[] = [];

afterEach(() => {
	for (const well of made.splice(0)) well.dispose();
	resetPageInput();
	forgetChosenMode();
});

/** A well made from options, what it tells recorded, at a pixel a hundredth of the scene's units. */
const wellOf = (options: ColourWell3DOptions = {}) => {
	const told: string[] = [];
	const frames = vi.fn();
	const well = new ColourWell3D({ value: '#ff0000', pixelSize: 0.01, onEvent: (event) => told.push(event), requestRender: frames, ...options });
	made.push(well);
	return { well, told, frames };
};

/** The colour's box, in the well's pixels, as the well lays it out. */
const colourBox = (well: ColourWell3D): Box => layoutWell(well.widget, restingState(well.widget), pageMeasure).box;

/** The picker's layout as it opens in the wheel, its regions in its own pixels and its box in the well's. */
const pickerLayout = (well: ColourWell3D): PickerLayout => layoutPicker(layoutWell(well.widget, restingState(well.widget), pageMeasure), 1e6, 1e6, pageMeasure, 'wheel');

/**
 * A ray at a point of the well, in its pixels, from a little in front of its
 * plane: straight at it, or slanted by a step across the plane's own axes.
 */
const rayAt = (well: ColourWell3D, [x, y]: readonly [number, number], slant: readonly [number, number] = [0, 0]): Ray => {
	well.updateWorldMatrix(true, true);
	const box = colourBox(well);
	const size = well.pixelSize;
	const target = well.localToWorld(new Vector3((x - box.w / 2) * size, (box.h / 2 - y) * size, 0));
	const from = well.localToWorld(new Vector3((x - box.w / 2 + slant[0]) * size, (box.h / 2 - y - slant[1]) * size, 1));
	return new Ray(from, target.clone().sub(from).normalize());
};

/** A ray at a point of the picker, in its own pixels. */
const rayOnPicker = (well: ColourWell3D, [x, y]: readonly [number, number], slant: readonly [number, number] = [0, 0]): Ray => {
	const { box } = pickerLayout(well);
	return rayAt(well, [box.x + x, box.y + y], slant);
};

/** A press let go where it went down. */
const click = (well: ColourWell3D, ray: Ray, pointerId = 0) => {
	well.pointerDown(ray, pointerId);
	well.pointerUp(ray, pointerId);
};

const middle = (box: Box): [number, number] => [box.x + box.w / 2, box.y + box.h / 2];

/** A point of the picker's wheel ring, at an angle clockwise from the right in screen axes, in the picker's pixels. */
const onRing = (layout: PickerLayout, degrees: number): [number, number] => {
	const wheel = layout.wheel!;
	const radius = wheel.w / 2 - (13 / 258) * wheel.w;
	return [wheel.x + wheel.w / 2 + radius * Math.cos(degrees * Math.PI / 180), wheel.y + wheel.h / 2 + radius * Math.sin(degrees * Math.PI / 180)];
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a colour well in a three.js scene', () => {
	it('stands its colour on a plane at its origin, a pixel `pixelSize` across, painted at its resolution and again as it changes, asking for a frame', async () => {
		const { well, frames } = wellOf();
		const box = colourBox(well);
		expect(well.colourMesh.position.toArray()).toEqual([0, 0, 0]);
		expect(well.colourMesh.scale.x).toBeCloseTo(box.w * 0.01);
		expect(well.colourMesh.scale.y).toBeCloseTo(box.h * 0.01);
		const texture = well.colourMesh.material.map!;
		expect((texture.image as HTMLCanvasElement).width).toBe(Math.round(box.w * 2));
		expect(well.pickerMesh.visible).toBe(false);
		frames.mockClear();
		const version = texture.version;
		expect(well.setValue('#00ff00')).toBe(true);
		expect(well.value).toBe('#00ff00');
		expect(well.setValue('green-ish')).toBe(false);
		await settle();
		expect(texture.version).toBeGreaterThan(version);
		expect(frames).toHaveBeenCalled();
	});

	it('opens its picker on a plane below its colour, in front of it, as a ray clicks the colour, takes the focus and tells click, and shuts it as the colour is clicked again', () => {
		const { well, told } = wellOf();
		const box = colourBox(well);
		click(well, rayAt(well, middle(box)));
		expect(well.open).toBe(true);
		expect(told).toContain('click');
		expect(pageInputMade()?.focused).toBe(true);
		expect(well.pickerMesh.visible).toBe(true);
		const { box: stood } = pickerLayout(well);
		expect(well.pickerMesh.scale.x).toBeCloseTo(stood.w * 0.01);
		expect(well.pickerMesh.position.y).toBeCloseTo((box.h / 2 - (stood.y + stood.h / 2)) * 0.01);
		expect(well.pickerMesh.position.y).toBeLessThan(-box.h / 2 * 0.01);
		expect(well.pickerMesh.position.z).toBeGreaterThan(0);
		click(well, rayAt(well, middle(box)));
		expect(well.open).toBe(false);
		expect(well.pickerMesh.visible).toBe(false);
	});

	it('sets the colour as the picker\'s wheel is pressed and dragged, the drag taken along the picker\'s plane past its edges, under a well moved and turned in its scene', () => {
		const { well, told } = wellOf();
		const scene = new Group();
		scene.position.set(4, -1, 2);
		scene.rotation.set(0, 0.6, 0);
		scene.add(well);
		well.position.set(1, 2, -3);
		well.rotation.set(0.3, -0.5, 0.1);
		click(well, rayAt(well, middle(colourBox(well))));
		const layout = pickerLayout(well);
		told.length = 0;
		expect(well.pointerDown(rayOnPicker(well, onRing(layout, 120), [3, -2]))).toBe(true);
		expect(well.value).toBe('#0000ff');
		expect(told).toEqual(['change']);
		// Far past the picker's right edge, level with the wheel's middle: off the plane, the ring still read along it.
		const wheel = layout.wheel!;
		expect(well.pointerMove(rayOnPicker(well, [wheel.x + wheel.w + 400, wheel.y + wheel.h / 2], [-5, 4]))).toBe(true);
		expect(well.value).toBe('#ff0000');
		expect(well.pointerUp(rayOnPicker(well, [wheel.x + wheel.w + 400, wheel.y + wheel.h / 2]))).toBe(true);
		expect(well.open).toBe(true);
	});

	it('clicks the picker where a press is let go unmoved where it went down: its close shuts it', () => {
		const { well } = wellOf();
		click(well, rayAt(well, middle(colourBox(well))));
		const layout = pickerLayout(well);
		click(well, rayOnPicker(well, middle(layout.close)));
		expect(well.open).toBe(false);
	});

	it('tells enter and leave as a pointer comes onto and goes off the colour or its picker, crossing between them telling nothing', () => {
		const { well, told } = wellOf();
		const box = colourBox(well);
		expect(well.pointerMove(rayAt(well, middle(box)))).toBe(true);
		expect(told).toEqual(['enter']);
		well.openPicker();
		expect(well.pointerMove(rayOnPicker(well, middle(pickerLayout(well).area)))).toBe(true);
		expect(told).toEqual(['enter']);
		expect(well.pointerMove(rayAt(well, [box.w + 500, -500]))).toBe(false);
		expect(well.pointerMove(null)).toBe(false);
		expect(told).toEqual(['enter', 'leave']);
	});

	it('holds a press for its own pointer alone, and a press on neither plane lets its focus go, its picker left open', () => {
		const { well } = wellOf();
		const box = colourBox(well);
		click(well, rayAt(well, middle(box)));
		expect(well.pointerDown(rayAt(well, middle(box)), 1)).toBe(true);
		expect(well.pointerDown(rayAt(well, middle(box)), 2)).toBe(false);
		expect(well.pointerUp(rayAt(well, middle(box)), 2)).toBe(false);
		well.pointerCancel(1);
		expect(pageInputMade()?.focused).toBe(true);
		expect(well.pointerDown(rayAt(well, [box.w + 500, -500]))).toBe(false);
		expect(pageInputMade()?.focused).toBe(false);
		expect(well.open).toBe(true);
	});

	it('shuts another well\'s picker as its own opens, and a disabled well answers no click, disabling shutting its picker', () => {
		const one = wellOf().well;
		const two = wellOf().well;
		two.position.set(5, 0, 0);
		one.openPicker();
		click(two, rayAt(two, middle(colourBox(two))));
		expect(two.open).toBe(true);
		expect(one.open).toBe(false);
		two.disabled = true;
		expect(two.open).toBe(false);
		click(two, rayAt(two, middle(colourBox(two))));
		expect(two.open).toBe(false);
		two.openPicker();
		expect(two.open).toBe(false);
	});

	it('takes typing into the picker\'s hex field through the page\'s input, placed over the field as the view shows it, and out of sight with no view', () => {
		const { well, told } = wellOf();
		const element = document.createElement('div');
		element.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, width: 800, height: 600, toJSON: () => ({}) }) as DOMRect;
		const camera = new PerspectiveCamera(50, 800 / 600, 0.1, 100);
		camera.position.set(0, -1, 4);
		camera.updateMatrixWorld();
		well.setView(camera, element);
		click(well, rayAt(well, middle(colourBox(well))));
		const input = pageInputMade()!;
		input.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		const width = parseFloat(input.input.style.width);
		expect(width).toBeGreaterThan(1);
		expect(parseFloat(input.input.style.fontSize)).toBeGreaterThan(0);
		input.input.value = '#123456';
		input.input.dispatchEvent(new Event('input', { bubbles: true }));
		expect(well.value).toBe('#123456');
		expect(told).toContain('change');
		well.setView(null);
		expect(input.input.style.width).toBe('1px');
	});

	it('listens on a canvas itself, each event\'s ray cast from the camera, a press it takes going no further', () => {
		const { well } = wellOf({ pixelSize: 0.002 });
		const element = document.createElement('canvas');
		document.body.appendChild(element);
		element.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, width: 800, height: 600, toJSON: () => ({}) }) as DOMRect;
		const camera = new PerspectiveCamera(50, 800 / 600, 0.1, 100);
		camera.position.set(0, 0, 1);
		camera.updateMatrixWorld();
		const after = vi.fn();
		const unlisten = well.listen(element, camera);
		element.addEventListener('pointerdown', after);
		const at = (type: string, x: number, y: number) => {
			const event = new MouseEvent(type, { button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, bubbles: true, cancelable: true });
			Object.defineProperty(event, 'pointerId', { value: 1 });
			element.dispatchEvent(event);
		};
		// The middle of the canvas looks along the camera's axis, at the well's origin: its colour's middle.
		at('pointerdown', 400, 300);
		at('pointerup', 400, 300);
		expect(well.open).toBe(true);
		expect(after).not.toHaveBeenCalled();
		at('pointerdown', 5, 5);
		expect(after).toHaveBeenCalledTimes(1);
		unlisten();
		at('pointerdown', 400, 300);
		at('pointerup', 400, 300);
		expect(well.open).toBe(true);
		element.remove();
	});

	it('warns once where a WebGPURenderer that tone-maps draws it, which shows its colours other than their own, and never where WebGL or no tone mapping does', () => {
		const { well } = wellOf();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
		const drawnBy = (renderer: object) => (well.colourMesh.onBeforeRender as (renderer: unknown) => void)(renderer);
		drawnBy({ isWebGLRenderer: true, toneMapping: 4 });
		drawnBy({ isWebGPURenderer: true, toneMapping: 0 });
		expect(warn).not.toHaveBeenCalled();
		drawnBy({ isWebGPURenderer: true, toneMapping: 4 });
		drawnBy({ isWebGPURenderer: true, toneMapping: 4 });
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('NoToneMapping');
		warn.mockRestore();
	});

	it('lets go as it is disposed: its picker shut, its focus let go, and it taken out of its scene', () => {
		const { well } = wellOf();
		const scene = new Group();
		scene.add(well);
		click(well, rayAt(well, middle(colourBox(well))));
		const ray = rayAt(well, middle(colourBox(well)));
		well.dispose();
		expect(well.open).toBe(false);
		expect(well.parent).toBeNull();
		expect(pageInputMade()?.focused).toBe(false);
		expect(well.pointerDown(ray)).toBe(false);
	});
});
