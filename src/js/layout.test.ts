/**
 * @fileoverview A colour widget laid out on its own, measured with a fixed
 * advance per character so every box is a number the test can state: each
 * widget laid out alone at a point, and a width, a height and a title that
 * size it.
 */
import { describe, expect, it } from 'vitest';
import { readColourOptions, type ColourOptions } from './options.ts';
import { CONTROL, MONO_FAMILY, inBox, layoutWell, restingState, type Font, type Laid } from './layout.ts';

/** Every character is as wide as half the font size: 8 px at the default 16 px. */
const measure = (text: string, font: Font) => text.length * font.size / 2;

/** A colour widget read from its options and laid out alone at a point. */
const well = (options: ColourOptions, at = { x: 0, y: 0 }): Laid => {
	const read = readColourOptions(options);
	return layoutWell(read, restingState(read), measure, at);
};

/** A number rounded so a sum of line heights compares as one. */
const r = (n: number) => Math.round(n * 1e6) / 1e6;

/** A laid widget's box, each side rounded. */
const box = (laid: Laid) => ({ x: r(laid.box.x), y: r(laid.box.y), w: r(laid.box.w), h: r(laid.box.h) });

describe('layoutWell', () => {
	it('lays a colour out as a field the field\'s width, its swatch\'s square left of its words inside the line and the room, and its title above', () => {
		const colour = well({ value: '#ff8b30' }, { x: 10, y: 20 });
		expect(box(colour)).toEqual({ x: 10, y: 20, w: CONTROL.fieldWidth, h: CONTROL.icon + 2 * (CONTROL.padY + CONTROL.border) });
		expect(colour.inner.x).toBe(10 + CONTROL.border + CONTROL.padX + CONTROL.icon + CONTROL.gap);
		expect(colour.inner.x + colour.inner.w).toBe(10 + CONTROL.fieldWidth - CONTROL.border - CONTROL.padX);
		expect(colour.state.text).toBe('#ff8b30');
		expect(colour.swatch).toEqual({ x: colour.inner.x - CONTROL.gap - CONTROL.icon, y: colour.inner.y + (colour.inner.h - CONTROL.icon) / 2, w: CONTROL.icon, h: CONTROL.icon });
		const titled = well({ value: '#ff8b30', title: 'Tint' }, { x: 10, y: 100 });
		expect(titled.title).not.toBeNull();
		expect(titled.face.y).toBeGreaterThan(titled.box.y);
		expect(titled.face.h).toBe(colour.face.h);
	});

	it('lays a colour that does not show its hex out as a well, the same size, its swatch its whole inner box', () => {
		const shown = well({ value: '#ff8b30' }, { x: 10, y: 20 });
		const filled = well({ value: '#ff8b30', showValue: false }, { x: 10, y: 100 });
		expect(filled.box.w).toBe(shown.box.w);
		expect(filled.box.h).toBe(shown.box.h);
		expect(filled.inner.x).toBe(10 + CONTROL.border + CONTROL.padX);
		expect(filled.inner.x + filled.inner.w).toBe(shown.inner.x + shown.inner.w);
		expect(filled.swatch).toEqual(filled.inner);
	});

	it('grows a colour\'s swatch with the widget\'s font, at its own size on the 16 px font', () => {
		expect(well({ value: '#ff8b30', style: { fontSize: 32 } }, { x: 0, y: 60 }).swatch).toMatchObject({ w: 2 * CONTROL.icon, h: 2 * CONTROL.icon });
		expect(well({ value: '#ff8b30' }).swatch).toMatchObject({ w: CONTROL.icon, h: CONTROL.icon });
	});

	it('measures its title in the monospaced family it is painted in', () => {
		const read = readColourOptions({ value: '#ff8b30', title: 'Tint' });
		const families: string[] = [];
		layoutWell(read, restingState(read), (text, font) => {
			families.push(font.family);
			return measure(text, font);
		});
		expect(families).toEqual([MONO_FAMILY]);
	});

	it('takes a width and a height its style fixes whole, its swatch\'s room and its line kept inside them, and stands as wide as its title where that is the wider', () => {
		const fixed = well({ value: '#ff8b30', style: { width: 120, height: 60 } });
		expect(box(fixed)).toEqual({ x: 0, y: 0, w: 120, h: 60 });
		expect(fixed.inner.w).toBe(120 - 2 * (CONTROL.border + CONTROL.padX) - CONTROL.icon - CONTROL.gap);
		// A title's line is three quarters of the font: 12 px a character at 32 px, so its 31 characters reach 372.
		const wide = well({ value: '#ff8b30', title: 'A title wider than the field is', style: { fontSize: 32 } });
		expect(wide.box.w).toBe(31 * 12);
	});

	it('takes its style\'s line, room and corners in place of the field\'s own, 0 among them', () => {
		const bare = well({ value: '#ff8b30', style: { borderWidth: 0, padding: 0, borderRadius: 0 } });
		expect(bare.inner.x).toBe(CONTROL.icon + CONTROL.gap);
		expect(bare.style.borderRadius).toBe(0);
		expect(bare.style.own).toEqual({ borderWidth: 0, padding: 0, borderRadius: 0 });
		const round = well({ value: '#ff8b30', style: { borderWidth: 3, borderColor: '#c2410c', borderRadius: 12 } });
		expect(round.inner.x).toBe(3 + CONTROL.padX + CONTROL.icon + CONTROL.gap);
		expect(round.style.borderColor).toEqual({ r: 0xc2 / 255, g: 0x41 / 255, b: 0x0c / 255, a: 1 });
		expect(round.style.borderRadius).toBe(12);
	});
});

describe('inBox', () => {
	it('holds a point on its left and top edges, and none on its right and bottom', () => {
		const b = { x: 0, y: 0, w: 10, h: 10 };
		expect(inBox(b, 0, 0)).toBe(true);
		expect(inBox(b, 9.99, 9.99)).toBe(true);
		expect(inBox(b, 10, 5)).toBe(false);
		expect(inBox(b, 5, 10)).toBe(false);
	});
});
