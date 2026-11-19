/**
 * @fileoverview A prop held the same from one render to the next while it
 * holds the same, for the adapters' components (reactWell.ts, r3fWell.ts):
 * an eyedropper written inline is a new object at each render, which would
 * otherwise be written to the well again at each.
 */

import { useRef } from 'react';

/** Whether two values hold the same: the same value, or objects whose own keys hold the same values. */
export const shallowSame = (a: unknown, b: unknown): boolean => {
	if (Object.is(a, b)) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every((key) => Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
};

/** A value held from one render to the next while it holds the same (`shallowSame`). */
export const useSame = <T>(value: T): T => {
	const held = useRef(value);
	if (!shallowSame(held.current, value)) held.current = value;
	return held.current;
};
