/**
 * @fileoverview A colour well as a React component (`ColourWell`): the
 * page's colour well (colourWell.ts), made as the component mounts, its
 * canvas in the element the component renders, and let go as it unmounts.
 * A server rendering the page mounts nothing, so it renders the element
 * alone and makes none of the well, which the browser makes as it hydrates.
 *
 * What the well is made from, its kind of colour and its look, makes a new
 * well as it changes; the rest is written to the well as it changes: its
 * value, swatches, whether it is disabled, and its eyedropper. The colour
 * the viewer takes is told through `onChange`, and every event the well
 * tells through `onEvent`, the latest of each heard without a new well.
 */

import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState, type ForwardedRef, type ReactElement } from 'react';
import { ColourWell as Well, type ColourWellOptions } from './colourWell.ts';
import type { WidgetEvent } from './options.ts';
import { useSame } from './same.ts';

/** A colour well's props: its options (`ColourWellOptions`), its value as React holds it, and what it tells. */
export interface ColourWellProps extends Omit<ColourWellOptions, 'value' | 'onEvent'> {
	/** The colour, as hex, written to the well as it changes; the colour the viewer takes stays until it does. */
	value?: string;
	/** The colour the well starts on where `value` is left out. */
	defaultValue?: string;
	/** Told the colour the viewer takes, as hex, as the well tells `change`. */
	onChange?: (value: string, well: Well) => void;
	/** Told each event the well tells (`ColourWellOptions.onEvent`). */
	onEvent?: (event: WidgetEvent, well: Well) => void;
	/** The class of the element the well's canvas stands in. */
	className?: string;
}

/**
 * A colour well, as a React component: the well made as the component
 * mounts and let go as it unmounts, its ref the well itself (`ColourWell`),
 * null till it is made.
 */
export const ColourWell = forwardRef(function ColourWell(props: ColourWellProps, ref: ForwardedRef<Well | null>): ReactElement {
	const holder = useRef<HTMLSpanElement>(null);
	const [well, setWell] = useState<Well | null>(null);
	// The latest props, which the well's events and its making read.
	const latest = useRef(props);
	latest.current = props;
	const { value, swatches, disabled, picker, className } = props;
	const eyedropper = useSame(props.eyedropper);
	// What a well is made from: a new one is made as any of it changes.
	const makings = JSON.stringify([props.alpha ?? null, props.mode ?? null, props.title ?? null, props.showValue ?? null, props.style ?? null]);
	const swatchKey = swatches ? JSON.stringify(swatches) : null;

	useEffect(() => {
		const { value: set, defaultValue, onChange: _onChange, onEvent: _onEvent, className: _className, ...options } = latest.current;
		const made = new Well({
			...options,
			value: set ?? defaultValue,
			onEvent: (event, of) => {
				latest.current.onEvent?.(event, of);
				if (event === 'change') latest.current.onChange?.(of.value, of);
			},
		});
		holder.current?.appendChild(made.canvas);
		setWell(made);
		return () => {
			made.dispose();
			setWell(null);
		};
	}, [makings, picker]);

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
		well?.setEyedropper(eyedropper ?? null);
	}, [well, eyedropper]);

	useImperativeHandle<Well | null, Well | null>(ref, () => well, [well]);
	return createElement('span', { ref: holder, className });
});
