// @vitest-environment jsdom
/**
 * @fileoverview The colour dialog: the faces it loads, and its drags: its
 * title bar, its wheel and a bar are pressed and dragged with events
 * dispatched on the dialog's own elements, which bubble through the document
 * as a person's do. The wheel's renderer is a stand-in, jsdom having no
 * WebGL, and the 2D contexts the dialog paints its close button and its bars
 * with do nothing.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./wheel.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./wheel.ts')>();
	return { ...actual, makeWheelRenderer: () => ({ canvas: document.createElement('canvas'), draw: () => { } }) };
});

/** A context every call on which does nothing, its gradients a stop that takes none. */
const inertContext = () => new Proxy<Record<string | symbol, unknown>>({}, {
	get: (held, key) => (key in held ? held[key] : key === 'createLinearGradient' ? () => ({ addColorStop: () => { } }) : () => { }),
	set: (held, key, value) => {
		held[key] = value;
		return true;
	},
});

/** Pins an element's rect, which jsdom otherwise reports as all zeros. */
const setRect = (el: Element, left: number, top: number, right: number, bottom: number) => {
	el.getBoundingClientRect = () => ({ left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) }) as DOMRect;
};

/** Where the dialog stands, measured from the window's left. */
const DIALOG_LEFT = 500;
/** The dialog's wheel is 258 logical pixels square; its ring runs from a radius of 103 to 129 round the centre. */
const WHEEL_MID = 129;
const ON_RING = 120;

let picker: typeof import('./picker.js');

beforeAll(async () => {
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => inertContext() as unknown as CanvasRenderingContext2D);
	picker = await import('./picker.js');
});

afterAll(() => {
	vi.restoreAllMocks();
});

afterEach(() => {
	document.body.innerHTML = '';
});

/** Shows the dialog on the body, standing at the dialog's left, and records what it tells. */
const shown = () => {
	const updates: number[][] = [];
	const dones: number[][] = [];
	picker.pickerShow(document.body, [255, 0, 0, 1], (colour) => { dones.push([...colour]); }, (colour) => { updates.push([...colour]); });
	const backing = document.querySelector('.___picker') as HTMLElement;
	const top = backing.querySelector('.___top') as HTMLElement;
	const canvases = Array.from(backing.querySelectorAll('canvas.___element')) as HTMLCanvasElement[];
	const [wheel, red] = canvases;
	for (const each of [backing, top, wheel, red]) setRect(each, DIALOG_LEFT, 0, DIALOG_LEFT + 258, 258);
	return { updates, dones, backing, top, wheel, red };
};

const mouse = (target: EventTarget, type: string, x: number, y: number) =>
	target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, buttons: type === 'mouseup' ? 0 : 1, bubbles: true, cancelable: true }));

/** A press on the wheel's ring at an angle, in degrees clockwise from the right. */
const ringPoint = (degrees: number): [number, number] => [DIALOG_LEFT + WHEEL_MID + ON_RING * Math.cos(degrees * Math.PI / 180), WHEEL_MID + ON_RING * Math.sin(degrees * Math.PI / 180)];

describe('the colour dialog\'s drags', () => {
	it('follow the pointer and tell the colour left at', () => {
		const { updates, dones, wheel } = shown();
		mouse(wheel, 'mousedown', ...ringPoint(0));
		mouse(wheel, 'mousemove', ...ringPoint(120));
		mouse(wheel, 'mouseup', ...ringPoint(120));
		expect(updates).toHaveLength(2);
		expect(updates[1]).toEqual([0, 0, 255, 1]);
		expect(dones).toEqual([[0, 0, 255, 1]]);
	});

	it('set a bar\'s channel through the drag and move the dialog by its title bar', () => {
		const { updates, dones, backing, top, red } = shown();
		// The red bar is 258 tall: its foot is 0, its top 255.
		mouse(red, 'mousedown', DIALOG_LEFT + 12, 258);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toEqual([0, 0, 0, 1]);
		mouse(red, 'mousemove', DIALOG_LEFT + 12, 129);
		expect(updates[1]).toEqual([128, 0, 0, 1]);
		mouse(red, 'mouseup', DIALOG_LEFT + 12, 129);
		expect(dones).toEqual([[128, 0, 0, 1]]);
		mouse(top, 'mousedown', DIALOG_LEFT + 10, 10);
		mouse(top, 'mousemove', DIALOG_LEFT + 60, 30);
		expect(backing.style.left).toBe(`${DIALOG_LEFT + 50}px`);
		expect(backing.style.top).toBe('20px');
		mouse(top, 'mouseup', DIALOG_LEFT + 60, 30);
		mouse(top, 'mousemove', DIALOG_LEFT + 160, 30);
		expect(backing.style.left).toBe(`${DIALOG_LEFT + 50}px`);
	});
});

describe('the colour dialog\'s faces', () => {
	it('loads Roboto Mono for its words and Roboto for its colour names as it is shown', () => {
		shown();
		expect(document.head.textContent).toContain("font-family: 'Roboto Mono';");
		expect(document.head.textContent).toContain("font-family: 'Roboto';");
	});
});
