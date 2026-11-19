/**
 * @fileoverview A colour well in a React Three Fiber scene, as a component
 * (`ColourWell3D`): the three.js well (colourWell3D.ts), made as the
 * component mounts in its Canvas and let go as it unmounts, its colour and
 * its picker on planes the scene shows, under WebGLRenderer or
 * WebGPURenderer and in VR.
 *
 * Fiber's pointer events are the well's: each event's ray handed to it,
 * a press it takes captured and stopped from reaching what is behind it, and
 * a press on nothing letting its focus go. Its wheel is drawn by WebGPU
 * under a WebGPURenderer drawing by WebGPU, and by WebGL otherwise, unless
 * `renderer` says; the page's input is placed through Fiber's camera over
 * its canvas; and a frame is asked of Fiber as the well or its picker is
 * painted again, so a Canvas rendering on demand shows it.
 *
 * What the well is made from, its kind of colour, its look, its size and its
 * sharpness, makes a new well as it changes; the rest is written to the well
 * as it changes.
 */

import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState, type ForwardedRef, type ReactElement } from 'react';
import { useThree, type Euler, type ThreeEvent, type Vector3 } from '@react-three/fiber';
import { ColourWell3D as Well3D, SCREEN, type ColourWell3DOptions } from './colourWell3D.ts';
import { useSame } from './same.ts';
import type { Renderer } from './renderer.ts';
import type { WidgetEvent } from './options.ts';

/** A well's props in a scene: its options (`ColourWell3DOptions`), its value as React holds it, what it tells, and where it stands. */
export interface ColourWell3DProps extends Omit<ColourWell3DOptions, 'value' | 'onEvent' | 'requestRender'> {
	/** The colour, as hex, written to the well as it changes; the colour the viewer takes stays until it does. */
	value?: string;
	/** The colour the well starts on where `value` is left out. */
	defaultValue?: string;
	/** Told the colour the viewer takes, as hex, as the well tells `change`. */
	onChange?: (value: string, well: Well3D) => void;
	/** Told each event the well tells (`ColourWell3DOptions.onEvent`). */
	onEvent?: (event: WidgetEvent, well: Well3D) => void;
	/** Where the well stands, turns and how far it is scaled, as a group's. */
	position?: Vector3;
	rotation?: Euler;
	scale?: Vector3;
}

/** What draws a well's wheel in a scene drawn by a renderer: WebGPU under a WebGPURenderer drawing by WebGPU, WebGL under any other. */
export const rendererOfScene = (renderer: unknown): Renderer =>
	(renderer as { backend?: { isWebGPUBackend?: boolean } } | null)?.backend?.isWebGPUBackend === true ? 'webgpu' : 'webgl';

/** The element a Fiber event's pointer is captured on. */
type Capturing = { setPointerCapture(id: number): void; releasePointerCapture(id: number): void };

/**
 * A colour well in a React Three Fiber scene, as a component, inside a
 * Canvas: the well made as the component mounts and let go as it unmounts,
 * its ref the well itself (`ColourWell3D`), null till it is made.
 */
export const ColourWell3D = forwardRef(function ColourWell3D(props: ColourWell3DProps, ref: ForwardedRef<Well3D | null>): ReactElement | null {
	const { gl, camera, invalidate } = useThree();
	const [well, setWell] = useState<Well3D | null>(null);
	const latest = useRef(props);
	latest.current = props;
	const { value, swatches, disabled, renderer, position, rotation, scale } = props;
	const eyedropper = useSame(props.eyedropper);
	// What a well is made from: a new one is made as any of it changes.
	const makings = JSON.stringify([props.alpha ?? null, props.mode ?? null, props.title ?? null, props.showValue ?? null, props.style ?? null, props.pixelSize ?? null, props.resolution ?? null]);
	const swatchKey = swatches ? JSON.stringify(swatches) : null;

	useEffect(() => {
		const { value: set, defaultValue, onChange: _onChange, onEvent: _onEvent, position: _position, rotation: _rotation, scale: _scale, ...options } = latest.current;
		const made = new Well3D({
			...options,
			value: set ?? defaultValue,
			renderer: options.renderer ?? rendererOfScene(gl),
			requestRender: () => invalidate(),
			onEvent: (event, of) => {
				latest.current.onEvent?.(event, of);
				if (event === 'change') latest.current.onChange?.(of.value, of);
			},
		});
		setWell(made);
		return () => {
			made.dispose();
			setWell(null);
		};
	}, [makings, gl, invalidate]);

	useEffect(() => {
		if (well && value !== undefined) well.setValue(value);
	}, [well, value]);
	useEffect(() => {
		well?.setSwatches(latest.current.swatches ?? []);
	}, [well, swatchKey]);
	useEffect(() => {
		if (well) well.disabled = disabled === true;
	}, [well, disabled]);
	useEffect(() => {
		well?.setEyedropper(eyedropper ?? SCREEN);
	}, [well, eyedropper]);
	useEffect(() => {
		well?.setRenderer(renderer ?? rendererOfScene(gl));
	}, [well, renderer, gl]);
	useEffect(() => {
		well?.setView(camera, gl.domElement);
	}, [well, camera, gl]);

	useImperativeHandle<Well3D | null, Well3D | null>(ref, () => well, [well]);
	if (!well) return null;
	return createElement('primitive', {
		object: well,
		position,
		rotation,
		scale,
		onPointerDown: (event: ThreeEvent<PointerEvent>) => {
			if (!well.pointerDown(event.ray, event.pointerId)) return;
			event.stopPropagation();
			(event.target as unknown as Capturing).setPointerCapture(event.pointerId);
		},
		onPointerMove: (event: ThreeEvent<PointerEvent>) => {
			if (well.pointerMove(event.ray, event.pointerId)) event.stopPropagation();
		},
		onPointerUp: (event: ThreeEvent<PointerEvent>) => {
			if (!well.pointerUp(event.ray, event.pointerId)) return;
			event.stopPropagation();
			(event.target as unknown as Capturing).releasePointerCapture(event.pointerId);
		},
		onPointerCancel: (event: ThreeEvent<PointerEvent>) => well.pointerCancel(event.pointerId),
		onLostPointerCapture: (event: ThreeEvent<PointerEvent>) => well.pointerCancel(event.pointerId),
		onPointerLeave: (event: ThreeEvent<PointerEvent>) => {
			well.pointerMove(null, event.pointerId);
		},
		onPointerMissed: () => well.pointerMissed(),
	});
});
