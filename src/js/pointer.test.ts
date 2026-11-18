/**
 * @fileoverview Where a picker stands on the page against its colour
 * (`screenPopoverRect`).
 */
import { describe, expect, it } from 'vitest';
import { screenPopoverRect } from './pointer.ts';

describe('a picker standing on the page', () => {
	const field = { x: 100, y: 80, w: 200, h: 40 };
	const below = { x: 100, y: 120, w: 120, h: 60 };
	const bounds = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
	/** The face's left side on the page: its middle, its depth, and its top and foot as a face drawn at a scale stands round it. */
	const at = (x: number, y: number, z: number, scale = 1) => ({ x, y, z, top: y - (field.h / 2) * scale, foot: y + (field.h / 2) * scale });

	it('stands the picker across from its colour\'s face\'s left side as far as the layout puts it, flush on its foot or its top, on the other side where only that one has the room, kept inside the bounds, and nowhere while that point\'s depth is outside -1 to 1', () => {
		expect(screenPopoverRect(at(300, 200, 0.5), field, below, bounds)).toMatchObject({ left: 300, top: 220, width: 120, height: 60 });
		const above = { x: 60, y: 80 - 200, w: 288, h: 200 };
		expect(screenPopoverRect(at(300, 300, 0.5), field, above, bounds)).toMatchObject({ left: 260, top: 80, width: 288, height: 200 });
		// At the bounds' foot, on the colour's other side, mirrored about the anchor: its foot 20 above it, as its top was 20 below; kept inside at their right.
		expect(screenPopoverRect(at(750, 580, 0), field, below, bounds)).toMatchObject({ left: 680, top: 500, width: 120, height: 60 });
		// At their top, below the colour as far as it was above; kept inside at their left.
		expect(screenPopoverRect(at(-40, 30, 0), field, above, bounds)).toMatchObject({ left: 0, top: 50, width: 288, height: 200 });
		// Where neither side holds it, on the layout's side, moved inside the bounds.
		expect(screenPopoverRect(at(300, 300, 0), field, { ...below, h: 350 }, bounds)).toMatchObject({ left: 300, top: 250, width: 120, height: 350 });
		// Larger than the bounds, its top left is kept on them and nothing is cut.
		expect(screenPopoverRect(at(50, 50, 0), field, { x: 100, y: 120, w: 900, h: 700 }, bounds)).toMatchObject({ left: 0, top: 0, width: 900, height: 700 });
		expect(screenPopoverRect(at(300, 200, 1.5), field, below, bounds)).toBeNull();
		expect(screenPopoverRect(at(NaN, 200, 0), field, below, bounds)).toBeNull();
		expect(screenPopoverRect(at(300, 200, 0), field, below, { ...bounds, maxX: 0 })).toBeNull();
	});

	it('keeps the picker its own size whatever the host draws a pixel at, against its colour\'s face as the host draws it', () => {
		// The face drawn half as large again: its foot 30 under the anchor, and the layout's 0 across from its left.
		expect(screenPopoverRect(at(300, 200, 0.5, 1.5), field, below, bounds, undefined, 1.5)).toEqual({ left: 300, top: 230, width: 120, height: 60, side: 'below', shift: { x: 0, y: 0 }, turn: 0 });
		// Opened above a face drawn half as large: its foot 10 over the anchor, and 40 left as the layout pulls it, 20 at that scale.
		const above = { x: 60, y: 80 - 200, w: 288, h: 200 };
		expect(screenPopoverRect(at(300, 400, 0.5, 0.5), field, above, bounds, undefined, 0.5)).toEqual({ left: 280, top: 190, width: 288, height: 200, side: 'above', shift: { x: 0, y: 0 }, turn: 0 });
		expect(screenPopoverRect(at(300, 200, 0.5, 0), field, below, bounds, undefined, 0)).toBeNull();
	});

	it('moves a picker the viewer carried as far as it was carried, on its layout\'s side where an uncarried one would turn, inside the bounds all the same, and tells how far the bounds moved it', () => {
		const carried = { ...below, x: below.x + 10, y: below.y + 5 };
		expect(screenPopoverRect(at(300, 200, 0.5, 2), field, carried, bounds, { x: 10, y: 5 }, 2)).toEqual({ left: 310, top: 245, width: 120, height: 60, side: 'below', shift: { x: 0, y: 0 }, turn: 0 });
		// At the bounds' foot, where an uncarried one stands on the colour's other side.
		expect(screenPopoverRect(at(750, 580, 0), field, carried, bounds, { x: 10, y: 5 })).toEqual({ left: 680, top: 540, width: 120, height: 60, side: 'below', shift: { x: -80, y: -65 }, turn: 0 });
		expect(screenPopoverRect(at(750, 580, 0), field, below, bounds)).toEqual({ left: 680, top: 500, width: 120, height: 60, side: 'above', shift: { x: -70, y: -100 }, turn: -100 });
	});

	it('keeps a carried picker on the side of its colour it stood on as the carry began, its face drawn at any size, and places a face by its top and its foot as drawn', () => {
		// Opened above at the bounds' foot, then carried 10 up from there: above the face it stays, its foot 10 over the face's top, as the face is drawn three times as large.
		const carried = { ...below, y: below.y - 10 };
		expect(screenPopoverRect(at(300, 580, 0, 3), field, carried, bounds, { x: 0, y: -10 }, 3, 'above')).toMatchObject({ top: 580 - 60 - 60 - 10, side: 'above', turn: -120 - 60 });
		// A face drawn short down the page and whole across: the picker's top on its foot as drawn, not as far down as the scale across would put it.
		expect(screenPopoverRect({ x: 300, y: 200, z: 0.5, top: 196, foot: 204 }, field, below, bounds, undefined, 2)).toMatchObject({ left: 300, top: 204 });
	});
});
