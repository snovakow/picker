/**
 * @fileoverview What a picker standing on a page is placed and pressed by:
 * how far a press moves before it is a drag, a touch's and anything else's,
 * and where a picker stands on the screen against its colour
 * (`screenPopoverRect`).
 *
 * Pure.
 */

import type { Box } from './layout.ts';

/** How far a press that is not a touch moves on the screen, in CSS pixels, before it is a drag rather than a click: as far as the browser's own drag of the canvas needs. */
export const DRAG_SLOP = 4;

/** How far a touch moves on the screen, in CSS pixels, before it is a drag rather than a tap: further than a mouse's, as a finger is wider than a pointer. */
export const TOUCH_SLOP = 10;

/** A rectangle of the page, in its CSS pixels. */
export interface ScreenRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** A rectangle of the page where a picker stands: the side of its colour it stands on, how far the screen's rule moved it from where its layout and the viewer's carry put it, in pixels of the page, which are the picker's, and how far down of that its standing on the side its layout does not give takes. */
export interface ScreenPlace extends ScreenRect {
	side: 'above' | 'below';
	shift: { x: number; y: number };
	turn: number;
}

/**
 * Where a picker stands on the screen, one pixel of its layout to a pixel of
 * the page whatever its host draws a pixel at: against its colour's face as
 * the host draws it, across from the face's left side as far as the layout
 * moves it, scaled as the host draws a pixel, and below the face or above it,
 * its top on the face's foot as drawn or its foot on the face's top: on the
 * side the layout opens it on, or the colour's other side where only that
 * side holds it inside the bounds; carried, on the side it stood on as the
 * carry began, moved from there as far as the viewer carried it; and moved
 * to keep it inside the bounds, its top left on their top left where it is
 * larger than they are. Null where the anchor's place on the page or the
 * scale is not a finite number, where the anchor's depth lies outside the
 * range -1 to 1, where the host draws its pixels at no size, or where the
 * bounds hold nothing.
 *
 * @param anchor - The face's left side on the page: its middle, its depth, which places it nowhere outside -1 to 1, and how far down the page its top and its foot are drawn
 * @param field - The colour's face, in the host's pixels
 * @param box - The picker's box as laid out and carried, in the host's pixels
 * @param bounds - What the picker is kept inside, in pixels of the page, such as the window
 * @param offset - How far the viewer has carried the picker from where its layout stands it
 * @param scale - How large the host draws one of its pixels at the anchor, in pixels of the page
 * @param side - The side of its colour a carried picker keeps; null for one not carried
 */
export const screenPopoverRect = (anchor: { x: number; y: number; z: number; top: number; foot: number }, field: Box, box: Box, bounds: { minX: number; minY: number; maxX: number; maxY: number }, offset: { x: number; y: number } = { x: 0, y: 0 }, scale = 1, side: 'above' | 'below' | null = null): ScreenPlace | null => {
	if (!Number.isFinite(anchor.x + anchor.y + anchor.top + anchor.foot + scale) || scale <= 0 || Math.abs(anchor.z) > 1 || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) return null;
	const left = anchor.x + (box.x - offset.x - field.x) * scale + offset.x;
	// The face's top and foot as drawn, whichever way up it stands on the page.
	const faceTop = Math.min(anchor.top, anchor.foot);
	const faceFoot = Math.max(anchor.top, anchor.foot);
	const topOn = (on: 'above' | 'below'): number => (on === 'above' ? faceTop - box.h : faceFoot);
	const laid: 'above' | 'below' = box.y - offset.y < field.y ? 'above' : 'below';
	const other = laid === 'above' ? 'below' : 'above';
	const fits = (top: number) => top >= bounds.minY && top + box.h <= bounds.maxY;
	const carried = offset.x !== 0 || offset.y !== 0;
	const on = side ?? (!carried && !fits(topOn(laid)) && fits(topOn(other)) ? other : laid);
	const top = topOn(on) + offset.y;
	const at = {
		left: Math.max(bounds.minX, Math.min(left, bounds.maxX - box.w)),
		top: Math.max(bounds.minY, Math.min(top, bounds.maxY - box.h)),
		width: box.w,
		height: box.h,
	};
	return { ...at, side: on, shift: { x: at.left - left, y: at.top - (topOn(laid) + offset.y) }, turn: topOn(on) - topOn(laid) };
};

