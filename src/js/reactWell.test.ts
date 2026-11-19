// @vitest-environment jsdom
/**
 * @fileoverview A colour well as a React component, mounted in jsdom: its
 * canvas in the element it renders and its ref the well, let go as it
 * unmounts; its value written as it changes and the colour the viewer takes
 * told; a new well made as its kind changes and the same kept as the rest
 * does, an eyedropper written inline included. The well's wheel is drawn by
 * a stand-in, jsdom having no WebGL, and its 2D contexts do nothing.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./wheelWebGL.ts', () => ({ makeWebGLWheel: (canvas: HTMLCanvasElement = document.createElement('canvas')) => ({ canvas, ready: true, draw: () => true }) }));

import { createElement, createRef, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ColourWell, type ColourWellProps } from './reactWell.ts';
import type { ColourWell as Well } from './colourWell.ts';
import { pageInputMade, resetPageInput } from './input.ts';
import { forgetChosenMode } from './colourPicker.ts';

/** A context every call on which does nothing, its measures all 0, and its gradients a stop that takes none. */
const inertContext = () => new Proxy<Record<string | symbol, unknown>>({ globalAlpha: 1 }, {
	get: (held, key) => (key in held ? held[key] : key === 'measureText' ? () => ({ width: 0 }) : key === 'createLinearGradient' ? () => ({ addColorStop: () => { } }) : () => { }),
	set: (held, key, value) => {
		held[key] = value;
		return true;
	},
});

beforeAll(() => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	// Cast to never: the spy is typed by getContext's last overload, which WebGPU's types make WebGPU's.
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => inertContext() as never);
	vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
	// jsdom lays nothing out: a canvas stands at a box of its own, so the page's picker counts it shown, and the page at the window's.
	const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) });
	vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect(100, 50, 160, 40));
	document.body.getBoundingClientRect = () => rect(0, 0, 1024, 768);
});

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
	act(() => root?.unmount());
	container?.remove();
	root = null;
	resetPageInput();
	forgetChosenMode();
});

/** Renders the well with props into a fresh element, in strict mode, as an app in development runs it, and the ref it fills. */
const render = (props: ColourWellProps) => {
	container = document.createElement('div');
	document.body.appendChild(container);
	root = createRoot(container);
	const ref = createRef<Well | null>();
	const show = (next: ColourWellProps) => act(() => root!.render(createElement(StrictMode, null, createElement(ColourWell, { ...next, ref }))));
	show(props);
	return { ref, show, holder: container };
};

describe('a colour well as a React component', () => {
	it('stands its well\'s canvas in the element it renders, its ref the well, and lets the well go as it unmounts', () => {
		const { ref, holder } = render({ value: '#ff8b30', className: 'tint' });
		const span = holder.querySelector('span.tint')!;
		const well = ref.current!;
		expect(well.value).toBe('#ff8b30');
		expect(span.children).toHaveLength(1);
		expect(span.firstElementChild).toBe(well.canvas);
		act(() => root!.unmount());
		root = null;
		expect(well.canvas.isConnected).toBe(false);
		expect(ref.current).toBeNull();
	});

	it('writes its value to the well as it changes, and tells the colour the viewer takes', () => {
		const changed = vi.fn();
		const told = vi.fn();
		const { ref, show } = render({ value: '#ff0000', onChange: changed, onEvent: told });
		const well = ref.current!;
		show({ value: '#00ff00', onChange: changed, onEvent: told });
		expect(well.value).toBe('#00ff00');
		act(() => well.openPicker());
		// The wheel's keys turn the hue, and the colour the triangle gives is taken.
		act(() => {
			pageInputMade()!.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
		});
		expect(well.value).not.toBe('#00ff00');
		expect(changed).toHaveBeenCalledWith(well.value, well);
		expect(told).toHaveBeenCalledWith('change', well);
	});

	it('makes a new well as its kind changes, and keeps it as its value, swatches, disabled and an eyedropper written inline change or stay', () => {
		const { ref, show } = render({ value: '#ff0000', eyedropper: { mode: 'disabled' } });
		const first = ref.current!;
		show({ value: '#0000ff', swatches: ['#ffffff'], disabled: true, eyedropper: { mode: 'disabled' } });
		expect(ref.current).toBe(first);
		expect(first.disabled).toBe(true);
		expect(first.eyedropper).toEqual({ mode: 'disabled' });
		show({ value: '#0000ff', alpha: true, disabled: true });
		const second = ref.current!;
		expect(second).not.toBe(first);
		expect(first.canvas.isConnected).toBe(false);
		expect(second.value).toBe('#0000ff');
		expect(second.disabled).toBe(true);
		expect(second.eyedropper).toBeNull();
	});

	it('starts on its default value where it is given no value, and keeps the colour the viewer took', () => {
		const { ref, show } = render({ defaultValue: '#123456' });
		const well = ref.current!;
		expect(well.value).toBe('#123456');
		act(() => {
			well.setValue('#abcdef');
		});
		show({ defaultValue: '#123456' });
		expect(well.value).toBe('#abcdef');
	});
});
