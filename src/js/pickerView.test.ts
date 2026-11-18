/**
 * @fileoverview A colour's picker, pure: its layout from the widget's face,
 * the mode and the host's size, the region under a point, what a press at a
 * point of a region sets, its channel values, fields and bars in each colour
 * space, the HSV and HSL terms held and converted each from the other, and
 * its painting on a recording context, measured with a fixed advance per
 * character.
 */
import { describe, expect, it } from 'vitest';
import { cssColour, readColourOptions, type ColourOptions } from './options.ts';
import { CONTROL, POPOVER_MARGIN, layoutWell, restingState, type Font, type Laid } from './layout.ts';
import { PALETTE } from './paint.ts';
import { CHANNELS, SWATCHES, hslToHsv, hsvToHsl, hsvToRgb, isLightSwatch, rgbToHsl, rgbToHsv } from './colour.ts';
import { hueOfAngle, saturatedOf, triangleColour, triangleOf, unitOfHue, type Rgb } from './wheel.ts';
import { DROPPER_TIPS, HUE_STOPS, PICKER, barShare, barStops, byteAt, channelsOf, colourAtRegion, fieldBox, fieldChain, fieldText, layoutPicker, paintPicker, pickerRegionAt, squareColour, termsAtSquare, termsKeeping, termsOf, termsWithChannel, wheelGeometryOf, withSquare, type DockButton, type PickerLayout, type PickerPaintState, type Region } from './pickerView.ts';

const measure = (text: string, font: Font) => text.length * font.size / 2;

/** Where a case lays its colour widget out, and the widget's options. */
type Placed = ColourOptions & { x?: number; y?: number };

/** A colour widget read from its options, orange unless they say otherwise, and laid out on its own at a point, (10, 20) unless the case moves it. */
const laidOf = ({ x = 10, y = 20, ...options }: Placed = {}): Laid => {
	const read = readColourOptions({ value: '#ff8b30', ...options });
	return layoutWell(read, restingState(read), measure, { x, y });
};

/** A colour's picker laid out in a mode on a host of a size, with an eyedropper whose tooltip is "Pick a colour" unless the case gives other words or none, and the dock button the case gives. */
const open = (widget: Placed = {}, mode: 'wheel' | 'square' | 'sliders' | 'names' = 'wheel', width = 400, height = 500, tip: string | null = DROPPER_TIPS.custom, dock: DockButton | null = null): PickerLayout => {
	const laid = laidOf(widget);
	return layoutPicker(laid, width, height, measure, mode, tip, dock);
};

/** The height of a picker with a number of swatch rows. */
const heightOf = (rows: number) => 2 * PICKER.pad + PICKER.tab + PICKER.gap + PICKER.area + PICKER.gap + PICKER.field + PICKER.gap + PICKER.field + (rows > 0 ? PICKER.gap + rows * PICKER.swatch + (rows - 1) * PICKER.swatchGap : 0);

/** A point of the wheel's square, in the popover's pixels: the centre moved by a distance along an angle, clockwise from the right in screen axes. */
const onWheel = (layout: PickerLayout, radius: number, degrees: number): [number, number] => {
	const wheel = layout.wheel!;
	const mid = wheel.w / 2;
	return [wheel.x + mid + radius * Math.cos(degrees * Math.PI / 180), wheel.y + mid + radius * Math.sin(degrees * Math.PI / 180)];
};

/** A point along the way from the wheel's centre to one of the triangle's corners, by a share of the way. */
const towardCorner = (layout: PickerLayout, corner: [number, number], share: number): [number, number] => {
	const wheel = layout.wheel!;
	const geometry = wheelGeometryOf(wheel, 1);
	return [wheel.x + geometry.mid[0] + corner[0] * share * geometry.dim, wheel.y + geometry.mid[1] - corner[1] * share * geometry.dim];
};

const centre = (box: { x: number; y: number; w: number; h: number }): [number, number] => [box.x + box.w / 2, box.y + box.h / 2];

const region = (layout: PickerLayout, at: [number, number], unit: [number, number] = [1, 0]): Region | null => pickerRegionAt(layout, at[0], at[1], unit);

const ORANGE: Rgb = [255, 139, 48];

describe('layoutPicker', () => {
	it('opens below the field, 288 wide and 308 tall with no swatches, the tabs, the area, the preview row and the channel row stacked inside its room', () => {
		const layout = open();
		expect(layout.box).toEqual({ x: 10, y: 20 + 42, w: PICKER.width, h: heightOf(0) });
		expect(layout.box.h).toBe(308);
		expect(layout.above).toBe(false);
		expect(layout.tabs.map((tab) => tab.mode)).toEqual(['wheel', 'square', 'sliders', 'names']);
		// The close's square is centred at (272, 22), its cross centred across it at 272 and standing on the tabs' words' baseline: its arms reach to 277 and the round cap of its 2-pixel stroke to 278, the contents' right edge; the tabs share the row left of the square and its gap.
		expect(layout.close).toEqual({ x: 260, y: 10, w: 24, h: 24 });
		expect(layout.tabs.map((tab) => tab.box)).toEqual([10, 70.5, 131, 191.5].map((x) => ({ x, y: 10, w: 60.5, h: 24 })));
		expect(layout.area).toEqual({ x: 10, y: 42, w: 268, h: 180 });
		// The wheel's square centred in the area, and with an alpha bar in the room left of it and its gap.
		expect(layout.wheel).toEqual({ x: 54, y: 42, w: 180, h: 180 });
		expect(open({ alpha: true }).wheel).toEqual({ x: 41, y: 42, w: 180, h: 180 });
		expect(layout.alphaBar).toBeNull();
		expect(layout.names).toEqual([]);
		expect(layout.old).toEqual({ x: 10, y: 230, w: 28, h: 30 });
		expect(layout.new).toEqual({ x: 38, y: 230, w: 28, h: 30 });
		// The hex field left of the eyedropper, a field's square at the row's right end, and its gap; no dock button.
		expect(layout.hex).toEqual({ x: 74, y: 230, w: 166, h: 30 });
		expect(layout.dropper).toEqual({ x: 248, y: 230, w: 30, h: 30 });
		expect(layout.tip!.lines).toEqual(['Pick a colour']);
		expect(layout.dock).toBeNull();
		expect(layout.space).toEqual({ x: 10, y: 268, w: 44, h: 30 });
		expect(layout.channels).toHaveLength(3);
		expect(layout.channels[0]).toMatchObject({ x: 62, y: 268, h: 30 });
		expect(layout.channels[2].x + layout.channels[2].w).toBeCloseTo(278, 9);
		expect(layout.alphaField).toBeNull();
		expect(layout.swatches).toEqual([]);
	});

	it('lays out no eyedropper and no tooltip where it is given no words, the hex field reaching the contents\' right edge', () => {
		const layout = open({}, 'wheel', 400, 500, null);
		expect(layout.dropper).toBeNull();
		expect(layout.tip).toBeNull();
		expect(layout.hex).toEqual({ x: 74, y: 230, w: 204, h: 30 });
		expect(region(layout, [263, 245])).toEqual({ kind: 'hex', index: -1 });
		expect(layout.box.h).toBe(308);
	});

	it('stands the dock button its host shows left of the close, a square of the tab row\'s height, the tabs sharing the row left of it', () => {
		for (const kind of ['popout', 'dock'] as const) {
			const layout = open({}, 'wheel', 400, 500, DROPPER_TIPS.custom, kind);
			expect(layout.dock).toEqual({ kind, box: { x: 236, y: 10, w: 24, h: 24 } });
			expect(layout.close).toEqual({ x: 260, y: 10, w: 24, h: 24 });
			expect(layout.tabs.map((tab) => tab.box)).toEqual([10, 64.5, 119, 173.5].map((x) => ({ x, y: 10, w: 54.5, h: 24 })));
			expect(region(layout, [248, 22])).toEqual({ kind: 'dock', index: -1 });
			expect(region(layout, [272, 22])).toEqual({ kind: 'close', index: -1 });
			// Between the last tab, ending at 228, and the dock button.
			expect(region(layout, [232, 22])).toBeNull();
			expect(colourAtRegion(layout, { kind: 'dock', index: -1 }, 248, 22, termsOf(ORANGE, 1), ORANGE)).toBeNull();
			expect(fieldBox(layout, { kind: 'dock', index: -1 })).toBeNull();
		}
	});

	it('opens above where the room below is short and there is more above, and reaches past the edge where neither side has the room', () => {
		const above = open({ y: 400 });
		expect(above.above).toBe(true);
		expect(above.box.y).toBe(400 - 308);
		// A 300 tall host: 238 below the field, 20 above; it opens below and reaches past the foot.
		const past = open({}, 'wheel', 400, 300);
		expect(past.above).toBe(false);
		expect(past.box.y + past.box.h).toBeGreaterThan(300);
		expect(past.box.h).toBe(308);
		// Just the room below: below it.
		const fits = open({}, 'wheel', 400, 20 + 42 + 308 + POPOVER_MARGIN);
		expect(fits.above).toBe(false);
	});

	it('keeps its own width and its parts where they stand whatever the width of the face it opens from', () => {
		for (const width of [60, 301, 452]) {
			const layout = open({ style: { width } });
			expect(layout.box).toMatchObject({ x: 10, w: PICKER.width });
			expect(layout.area.w).toBe(PICKER.width - 2 * PICKER.pad);
			expect(layout.wheel).toEqual(open().wheel);
			expect(layout.dropper!.x + layout.dropper!.w).toBe(PICKER.width - PICKER.pad);
			expect(layout.hex.x + layout.hex.w).toBe(layout.dropper!.x - PICKER.gap);
			expect(open({ alpha: true, style: { width } }, 'square').square).toEqual(open({ alpha: true }, 'square').square);
		}
	});

	it('pulls left at the host\'s right edge, though never past its left edge', () => {
		const pulled = open({ x: 300, style: { width: 150 } });
		expect(pulled.box.x).toBe(400 - 288);
		// Wider than a 200 wide host: from its left edge, reaching past the right.
		expect(open({}, 'wheel', 200).box).toMatchObject({ x: 0, w: 288 });
	});

	it('lays the alpha bar at the area\'s right and a fourth field for the alpha only where the widget carries one', () => {
		const layout = open({ alpha: true });
		expect(layout.alpha).toBe(true);
		expect(layout.alphaBar).toEqual({ x: 278 - 18, y: 42, w: 18, h: 180 });
		expect(layout.channels).toHaveLength(3);
		expect(layout.alphaField).not.toBeNull();
		expect(layout.alphaField!.x + layout.alphaField!.w).toBeCloseTo(278, 9);
		// In names the bar stands at the area's right too, in sliders it is the fourth bar.
		expect(open({ alpha: true }, 'names').alphaBar).toEqual({ x: 278 - 18, y: 42, w: 18, h: 180 });
		expect(open({ alpha: true }, 'sliders').alphaBar).toBeNull();
	});

	it('lays no swatch row with none, one for four and two for fourteen, seven to a row', () => {
		expect(open().box.h).toBe(308);
		const four = open({ swatches: ['#111111', '#222222', '#333333', '#444444'] });
		expect(four.box.h).toBe(344);
		expect(four.swatches).toHaveLength(4);
		expect(four.swatches[0]).toEqual({ x: 10, y: 306, w: 28, h: 28 });
		expect(four.swatches[3].x).toBe(10 + 3 * 34);
		const fourteen = open({ swatches: Array.from({ length: 14 }, (_, i) => `#0000${(i + 10).toString(16).padStart(2, '0')}`) });
		expect(fourteen.box.h).toBe(378);
		expect(fourteen.swatches[7]).toEqual({ x: 10, y: 306 + 34, w: 28, h: 28 });
	});

	it('lays the names out in names as two columns of seven cells, each half the area wide, or of the room left of the alpha bar, and no wheel', () => {
		const layout = open({}, 'names');
		expect(layout.mode).toBe('names');
		expect(layout.wheel).toBeNull();
		expect(layout.names).toHaveLength(SWATCHES.length);
		expect(layout.names[0]).toEqual({ x: 10, y: 42, w: 134, h: 24 });
		expect(layout.names[6]).toEqual({ x: 10, y: 42 + 6 * 24, w: 134, h: 24 });
		expect(layout.names[7]).toEqual({ x: 144, y: 42, w: 134, h: 24 });
		expect(layout.names[13].y + layout.names[13].h).toBeLessThanOrEqual(layout.area.y + layout.area.h);
		expect(layout.box.h).toBe(308);
		// With alpha, the two columns share the room left of the alpha bar.
		const clear = open({ alpha: true }, 'names');
		const cellW = (278 - 18 - 8 - 10) / 2;
		expect(clear.names[0]).toEqual({ x: 10, y: 42, w: cellW, h: 24 });
		expect(clear.names[7]).toEqual({ x: 10 + cellW, y: 42, w: cellW, h: 24 });
		expect(clear.names[7].x + clear.names[7].w).toBe(clear.alphaBar!.x - 8);
	});

	it('lays square out as the square at the area\'s left, the hue strip a gap right of it and the alpha bar at the area\'s right, the square 216 wide with alpha and 242 without', () => {
		const layout = open({ alpha: true }, 'square');
		expect(layout.mode).toBe('square');
		expect(layout.wheel).toBeNull();
		expect(layout.square).toEqual({ x: 10, y: 42, w: 216, h: 180 });
		expect(layout.hueStrip).toEqual({ x: 234, y: 42, w: 18, h: 180 });
		expect(layout.alphaBar).toEqual({ x: 260, y: 42, w: 18, h: 180 });
		expect(layout.bars).toEqual([]);
		expect(layout.names).toEqual([]);
		expect(layout.box.h).toBe(308);
		const flat = open({}, 'square');
		expect(flat.square).toEqual({ x: 10, y: 42, w: 242, h: 180 });
		expect(flat.hueStrip).toEqual({ x: 260, y: 42, w: 18, h: 180 });
		expect(flat.alphaBar).toBeNull();
		// A wider face leaves it as it stands.
		expect(open({ style: { width: 320 } }, 'square').square).toEqual(flat.square);
	});

	it('lays sliders out as four bars 61 wide with alpha and three 84 wide without, a gap apart across the area, and no alpha bar of its own', () => {
		const four = open({ alpha: true }, 'sliders');
		expect(four.bars).toEqual([10, 79, 148, 217].map((x) => ({ x, y: 42, w: 61, h: 180 })));
		expect(four.alphaBar).toBeNull();
		expect(four.wheel).toBeNull();
		expect(four.square).toBeNull();
		expect(four.hueStrip).toBeNull();
		const three = open({}, 'sliders');
		expect(three.bars).toEqual([10, 102, 194].map((x) => ({ x, y: 42, w: 84, h: 180 })));
		expect(three.bars[2].x + three.bars[2].w).toBe(278);
		expect(three.box.h).toBe(308);
		// wheel and names lay no bars, no square and no strip.
		for (const mode of ['wheel', 'names'] as const) {
			const other = open({ alpha: true }, mode);
			expect([other.bars, other.square, other.hueStrip], mode).toEqual([[], null, null]);
		}
	});
});

describe('pickerRegionAt', () => {
	it('names every region but the eyedropper\'s and its tooltip\'s, which are checked below, and nothing between them', () => {
		const layout = open({ alpha: true, swatches: Array.from({ length: 9 }, (_, i) => `#11111${i}`) });
		expect(region(layout, [20, 20])).toEqual({ kind: 'tab', index: 0 });
		expect(region(layout, [80, 20])).toEqual({ kind: 'tab', index: 1 });
		expect(region(layout, [272, 22])).toEqual({ kind: 'close', index: -1 });
		expect(region(layout, [257, 22])).toBeNull();
		expect(region(layout, onWheel(layout, 81, 30))).toEqual({ kind: 'ring', index: -1 });
		expect(region(layout, onWheel(layout, 0, 0))).toEqual({ kind: 'triangle', index: -1 });
		expect(region(layout, [269, 100])).toEqual({ kind: 'alpha', index: -1 });
		expect(region(layout, centre(layout.old))).toEqual({ kind: 'old', index: -1 });
		expect(region(layout, centre(layout.new))).toEqual({ kind: 'new', index: -1 });
		expect(region(layout, centre(layout.hex))).toEqual({ kind: 'hex', index: -1 });
		expect(region(layout, centre(layout.space))).toEqual({ kind: 'space', index: -1 });
		expect(region(layout, centre(layout.channels[1]))).toEqual({ kind: 'channel', index: 1 });
		expect(region(layout, centre(layout.alphaField!))).toEqual({ kind: 'alphaField', index: -1 });
		expect(region(layout, centre(layout.swatches[0]))).toEqual({ kind: 'swatch', index: 0 });
		expect(region(layout, centre(layout.swatches[8]))).toEqual({ kind: 'swatch', index: 8 });
		// The room inside the edge, between the rows, beyond the ring, and past the box.
		expect(region(layout, [5, 5])).toBeNull();
		expect(region(layout, [150, 264])).toBeNull();
		expect(region(layout, onWheel(layout, 95, 45))).toBeNull();
		expect(region(layout, [150, 400])).toBeNull();
		const names = open({}, 'names');
		expect(region(names, centre(names.names[0]))).toEqual({ kind: 'name', index: 0 });
		expect(region(names, centre(names.names[7]))).toEqual({ kind: 'name', index: 7 });
		expect(region(names, centre(names.names[13]))).toEqual({ kind: 'name', index: 13 });
		// With alpha, the names leave the bar its own region.
		const clearNames = open({ alpha: true }, 'names');
		expect(region(clearNames, centre(clearNames.names[7]))).toEqual({ kind: 'name', index: 7 });
		expect(region(clearNames, [269, 100])).toEqual({ kind: 'alpha', index: -1 });
		expect(region(clearNames, [256, 100])).toBeNull();
		const square = open({ alpha: true }, 'square');
		expect(region(square, [10, 42])).toEqual({ kind: 'square', index: -1 });
		expect(region(square, centre(square.square!))).toEqual({ kind: 'square', index: -1 });
		expect(region(square, [243, 100])).toEqual({ kind: 'hue', index: -1 });
		expect(region(square, [269, 100])).toEqual({ kind: 'alpha', index: -1 });
		expect(region(square, [230, 100])).toBeNull();
		expect(region(square, [256, 100])).toBeNull();
		expect(region(square, [80, 20])).toEqual({ kind: 'tab', index: 1 });
		const sliders = open({ alpha: true }, 'sliders');
		sliders.bars.forEach((bar, i) => expect(region(sliders, centre(bar))).toEqual({ kind: 'bar', index: i }));
		expect(region(sliders, [75, 100])).toBeNull();
		expect(region(sliders, [150, 20])).toEqual({ kind: 'tab', index: 2 });
		expect(region(sliders, [220, 20])).toEqual({ kind: 'tab', index: 3 });
	});

	it('tells the ring from the triangle and the gap between by the wheel\'s maths, the triangle following the hue', () => {
		const layout = open();
		// With the hue at the right the triangle's corner reaches the ring's inner edge there, and the gap lies at the left.
		expect(region(layout, onWheel(layout, 71, 0), [1, 0])).toEqual({ kind: 'triangle', index: -1 });
		expect(region(layout, onWheel(layout, 55, 180), [1, 0])).toBeNull();
		// Turned to the left, the triangle stands where the gap was and the gap where the corner was.
		expect(region(layout, onWheel(layout, 71, 0), [-1, 0])).toBeNull();
		expect(region(layout, onWheel(layout, 55, 180), [-1, 0])).toEqual({ kind: 'triangle', index: -1 });
		expect(region(layout, onWheel(layout, 72, 90), [1, 0])).toEqual({ kind: 'ring', index: -1 });
		expect(region(layout, onWheel(layout, 89.9, 90), [1, 0])).toEqual({ kind: 'ring', index: -1 });
	});
});

describe('colourAtRegion', () => {
	const hex = (rgb: Rgb) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');

	it('sets the hue at a point\'s angle on the ring, the triangle\'s terms kept, the colour the triangle\'s bytes, and a hue past a byte at the ring\'s leftmost point held to bytes', () => {
		const layout = open();
		const terms = termsOf([255, 0, 0], 1);
		const ring: Region = { kind: 'ring', index: -1 };
		const at = (degrees: number) => colourAtRegion(layout, ring, ...onWheel(layout, 81, degrees), terms, [255, 0, 0])!;
		expect(at(0).colour).toEqual([255, 0, 0]);
		expect(at(120).colour).toEqual([0, 0, 255]);
		expect(at(-120).colour).toEqual([0, 255, 0]);
		expect(at(50).terms.hue).toEqual(hueOfAngle(50));
		expect(at(50).terms.saturation).toBe(1);
		expect(at(50).terms.intensity).toBe(0.5);
		const wheel = layout.wheel!;
		const leftmost = colourAtRegion(layout, ring, wheel.x, wheel.y + wheel.h / 2, terms, [255, 0, 0])!;
		expect(leftmost.terms.hue).toEqual([0, 256, 255]);
		expect(leftmost.colour).toEqual([0, 255, 255]);
		expect(leftmost.terms.unit[0]).toBe(-1);
		// Far past the ring, the angle is still what counts.
		expect(colourAtRegion(layout, ring, ...onWheel(layout, 500, 120), terms, [255, 0, 0])!.colour).toEqual([0, 0, 255]);
		// The wheel's centre has no angle.
		expect(colourAtRegion(layout, ring, ...onWheel(layout, 0, 0), terms, [255, 0, 0])).toBeNull();
	});

	it('sets the saturation and intensity at a point of the triangle, its corners the hue, white and black, a point beyond an edge taken onto it', () => {
		const layout = open();
		const terms = termsOf(ORANGE, 1);
		const corners = triangleOf(terms.unit, wheelGeometryOf(layout.wheel!, 1));
		const triangle: Region = { kind: 'triangle', index: -1 };
		const at = (corner: [number, number], share: number) => colourAtRegion(layout, triangle, ...towardCorner(layout, corner, share), terms, ORANGE)!;
		expect(at(corners[0], 1.2).colour).toEqual(terms.hue);
		expect(at(corners[1], 1.2).colour).toEqual([255, 255, 255]);
		expect(at(corners[2], 1.2).colour).toEqual([0, 0, 0]);
		const near = at(corners[1], 0.9);
		expect(near.terms.saturation).toBeGreaterThan(0);
		expect(near.terms.saturation).toBeLessThan(0.1);
		expect(near.terms.intensity).toBeGreaterThan(0.9);
		expect(near.colour).toEqual(triangleColour(terms.hue, near.terms.saturation, near.terms.intensity));
		expect(near.terms.hue).toEqual(terms.hue);
	});

	it('sets the alpha at a point\'s height on the bar, held to 0..1, the colour kept', () => {
		const layout = open({ alpha: true });
		const terms = termsOf(ORANGE, 1);
		const bar = layout.alphaBar!;
		const alpha: Region = { kind: 'alpha', index: -1 };
		expect(colourAtRegion(layout, alpha, bar.x + 9, bar.y, terms, ORANGE)!.terms.alpha).toBe(1);
		expect(colourAtRegion(layout, alpha, bar.x + 9, bar.y + bar.h, terms, ORANGE)!.terms.alpha).toBe(0);
		expect(colourAtRegion(layout, alpha, bar.x + 9, bar.y + bar.h / 2, terms, ORANGE)!.terms.alpha).toBe(0.5);
		expect(colourAtRegion(layout, alpha, 0, 1000, terms, ORANGE)!.terms.alpha).toBe(0);
		expect(colourAtRegion(layout, alpha, bar.x, bar.y + 45, terms, ORANGE)!.colour).toEqual(ORANGE);
		expect(colourAtRegion(open(), alpha, 0, 0, terms, ORANGE)).toBeNull();
		// The same bar in names, the colour kept.
		const names = open({ alpha: true }, 'names');
		expect(colourAtRegion(names, alpha, bar.x + 9, bar.y + bar.h / 2, terms, ORANGE)).toEqual({ terms: { ...terms, alpha: 0.5 }, colour: ORANGE });
	});

	it('sets the saturation across the square and the value up it, held to its edges, at the square\'s hue: white, the hue, black and black at its corners', () => {
		const layout = open({}, 'square');
		const terms = termsOf(ORANGE, 1);
		const sq = layout.square!;
		const square: Region = { kind: 'square', index: -1 };
		const at = (x: number, y: number) => colourAtRegion(layout, square, x, y, terms, ORANGE)!;
		const h = terms.square.h;
		expect(at(sq.x, sq.y).colour).toEqual([255, 255, 255]);
		expect(at(sq.x + sq.w, sq.y).colour).toEqual(squareColour({ h, s: 1, v: 1 }));
		expect(at(sq.x + sq.w, sq.y).colour).toEqual([255, 112, 0]);
		expect(at(sq.x, sq.y + sq.h).colour).toEqual([0, 0, 0]);
		expect(at(sq.x + sq.w, sq.y + sq.h).colour).toEqual([0, 0, 0]);
		expect(at(sq.x + sq.w, sq.y + sq.h).terms.square).toEqual({ h, s: 1, v: 0 });
		// Past the corners the point is held to the square.
		expect(at(sq.x - 50, sq.y - 50).terms.square).toEqual({ h, s: 0, v: 1 });
		const mid = at(sq.x + sq.w / 4, sq.y + sq.h / 2);
		expect(mid.terms.square).toEqual({ h, s: 0.25, v: 0.5 });
		expect(mid.colour).toEqual(hsvToRgb({ h, s: 0.25, v: 0.5 }).map((c) => Math.round(c * 255)));
		// The wheel's terms and the alpha are kept.
		expect(mid.terms).toMatchObject({ hue: terms.hue, unit: terms.unit, saturation: terms.saturation, intensity: terms.intensity, alpha: 1 });
		expect(colourAtRegion(open(), square, 50, 50, terms, ORANGE)).toBeNull();
	});

	it('sets the hue up the strip, 0 at its foot and 360 at its top, the square\'s saturation and value kept', () => {
		const layout = open({}, 'square');
		const terms = { ...termsOf(ORANGE, 1), square: { h: 30, s: 1, v: 1 } };
		const strip = layout.hueStrip!;
		const hue: Region = { kind: 'hue', index: -1 };
		const at = (y: number) => colourAtRegion(layout, hue, strip.x + 9, y, terms, ORANGE)!;
		expect(at(strip.y + strip.h).terms.square).toEqual({ h: 0, s: 1, v: 1 });
		expect(at(strip.y + strip.h + 40).colour).toEqual([255, 0, 0]);
		expect(at(strip.y).terms.square.h).toBe(360);
		expect(at(strip.y - 40).colour).toEqual([255, 0, 0]);
		expect(at(strip.y + strip.h / 3).terms.square.h).toBeCloseTo(240, 9);
		expect(at(strip.y + strip.h / 3).colour).toEqual([0, 0, 255]);
		expect(at(strip.y + strip.h / 2).colour).toEqual([0, 255, 255]);
		const grey = colourAtRegion(layout, hue, strip.x, strip.y + strip.h / 2, { ...terms, square: { h: 30, s: 0, v: 0.5 } }, [128, 128, 128])!;
		expect(grey.colour).toEqual([128, 128, 128]);
		expect(grey.terms.square).toEqual({ h: 180, s: 0, v: 0.5 });
	});

	it('sets one channel\'s byte on its bar, the share of 256 from the foot held to 255 at the top, and the alpha on the fourth, the other channels kept', () => {
		const layout = open({ alpha: true }, 'sliders');
		const terms = termsOf(ORANGE, 0.5);
		const at = (i: number, y: number) => colourAtRegion(layout, { kind: 'bar', index: i }, layout.bars[i].x + 5, y, terms, ORANGE)!;
		const { y, h } = layout.bars[0];
		expect(at(0, y + h).colour).toEqual([0, 139, 48]);
		expect(at(0, y).colour).toEqual([255, 139, 48]);
		expect(at(1, y + h + 30).colour).toEqual([255, 0, 48]);
		expect(at(1, y - 30).colour).toEqual([255, 255, 48]);
		expect(at(2, y + h / 2).colour).toEqual([255, 139, 128]);
		expect(at(2, y + h * 0.75).colour).toEqual([255, 139, 64]);
		expect([0, 0.25, 0.5, 0.999, 1].map(byteAt)).toEqual([0, 64, 128, 255, 255]);
		// Each channel set reads the terms afresh from the colour, the alpha kept.
		const set = at(2, y + h / 2);
		expect(set.terms).toEqual(termsKeeping([255, 139, 128], 0.5, terms));
		expect(set.terms.alpha).toBe(0.5);
		expect(at(3, y + h / 4)).toEqual({ terms: { ...terms, alpha: 0.75 }, colour: ORANGE });
		expect(at(3, y + h + 9).terms.alpha).toBe(0);
		// A grey set by a bar keeps the hues it is read over.
		const grey = colourAtRegion(layout, { kind: 'bar', index: 0 }, 20, y + h - 128 * h / 256, terms, [0, 128, 128])!;
		expect(grey.colour).toEqual([128, 128, 128]);
		expect(grey.terms).toMatchObject({ hue: terms.hue, unit: terms.unit, square: { h: terms.square.h, s: 0 } });
		expect(terms.square.h).not.toBe(rgbToHsv([0, 128 / 255, 128 / 255]).h);
		// No fourth bar without alpha, and none outside sliders.
		expect(colourAtRegion(open({}, 'sliders'), { kind: 'bar', index: 3 }, 0, 0, terms, ORANGE)).toBeNull();
		expect(colourAtRegion(open({ alpha: true }), { kind: 'bar', index: 0 }, 0, 0, terms, ORANGE)).toBeNull();
	});

	it('takes a named cell\'s colour and a swatch\'s, each read into the wheel\'s terms, a grey keeping the hue it is read over, a swatch\'s alpha with it where the widget carries one', () => {
		const names = open({}, 'names');
		const terms = termsOf(ORANGE, 0.5);
		SWATCHES.forEach((swatch, i) => {
			const at = colourAtRegion(names, { kind: 'name', index: i }, 0, 0, terms, ORANGE)!;
			expect(at.colour, swatch.name).toEqual(swatch.rgb);
			expect(at.colour, swatch.name).not.toBe(swatch.rgb);
			const grey = saturatedOf(swatch.rgb).saturation === 0;
			expect(at.terms.hue, swatch.name).toEqual(grey ? terms.hue : saturatedOf(swatch.rgb).hue);
			expect(at.terms.unit, swatch.name).toEqual(grey ? terms.unit : termsOf(swatch.rgb, 1).unit);
			expect(at.terms.alpha, swatch.name).toBe(0.5);
			expect(hex(at.colour)).toBe(swatch.hex);
		});
		expect(colourAtRegion(names, { kind: 'name', index: 14 }, 0, 0, terms, ORANGE)).toBeNull();
		const own = open({ alpha: true, swatches: ['#11223380', '#aabbcc'] });
		expect(colourAtRegion(own, { kind: 'swatch', index: 0 }, 0, 0, terms, ORANGE)).toMatchObject({ colour: [17, 34, 51], terms: { alpha: 128 / 255 } });
		expect(colourAtRegion(own, { kind: 'swatch', index: 1 }, 0, 0, terms, ORANGE)).toMatchObject({ colour: [170, 187, 204], terms: { alpha: 1 } });
		// A grey swatch keeps the hue the terms hold, so the triangle stays where it stood.
		const blue = termsOf([0, 0, 255], 1);
		const grey = colourAtRegion(open({ swatches: ['#808080'] }), { kind: 'swatch', index: 0 }, 0, 0, blue, [0, 0, 255])!;
		expect(grey.colour).toEqual([128, 128, 128]);
		expect(grey.terms).toMatchObject({ hue: [0, 0, 255], unit: blue.unit, saturation: 0 });
		const flat = open({ swatches: ['#11223380'] });
		expect(colourAtRegion(flat, { kind: 'swatch', index: 0 }, 0, 0, terms, ORANGE)!.terms.alpha).toBe(1);
		expect(colourAtRegion(flat, { kind: 'swatch', index: 3 }, 0, 0, terms, ORANGE)).toBeNull();
		// A tab, the preview and the fields set no colour at a point.
		for (const kind of ['tab', 'old', 'new', 'hex', 'space', 'channel', 'alphaField'] as const) {
			expect(colourAtRegion(own, { kind, index: 0 }, 0, 0, terms, ORANGE), kind).toBeNull();
		}
	});
});

describe('paintPicker', () => {
	/** One call the painter made, with the style standing when it was made. */
	interface Call {
		op: string;
		args: unknown[];
		fill: unknown;
		stroke: string;
		font: string;
		/** How solid what is painted is, as the call is made. */
		alpha: number;
	}

	/** A context that records each call the painter makes, with the style standing as it is made, a restore bringing back the style its save kept as a canvas's does, but `beginPath`, which does nothing, and `createLinearGradient` and `measureText`, which answer unrecorded: a gradient that holds its arguments and stands as a fill where it is set, and fixed measures. */
	const recording = () => {
		const calls: Call[] = [];
		const state: Record<string, unknown> = { fillStyle: '', strokeStyle: '', globalAlpha: 1, font: '', lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic', globalCompositeOperation: 'source-over' };
		const saved: Record<string, unknown>[] = [];
		const record = (op: string) => (...args: unknown[]) => { calls.push({ op, args, fill: state.fillStyle, stroke: state.strokeStyle as string, font: state.font as string, alpha: state.globalAlpha as number }); };
		const ctx: Record<string, unknown> = {
			save: () => { record('save')(); saved.push({ ...state }); }, restore: () => { record('restore')(); Object.assign(state, saved.pop()); }, clearRect: record('clearRect'), beginPath: () => { }, roundRect: record('roundRect'), rect: record('rect'), clip: record('clip'),
			fill: record('fill'), stroke: record('stroke'), arc: record('arc'), fillRect: record('fillRect'), fillText: record('fillText'), drawImage: record('drawImage'), setTransform: record('setTransform'),
			createLinearGradient: (...args: unknown[]) => ({ args, addColorStop: record('addColorStop') }),
			// A capital at 16 px: 11.4 above the middle line and 5.5 below it, to the baseline.
			measureText: (text: string) => ({ width: text.length * 8, actualBoundingBoxAscent: 11.4, actualBoundingBoxDescent: 5.5 }), moveTo: record('moveTo'), lineTo: record('lineTo'),
		};
		for (const key of Object.keys(state)) Object.defineProperty(ctx, key, { get: () => state[key], set: (v) => { state[key] = v; } });
		return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
	};

	const stateOf = (over: Partial<PickerPaintState> = {}): PickerPaintState => ({ colour: ORANGE, hex: '#ff8b30', old: ORANGE, oldAlpha: 1, lit: null, name: -1, terms: termsOf(ORANGE, 1), bar: 0, space: 'RGB', field: null, dropper: { armed: false, tip: false, unavailable: false }, ...over });

	const paint = (layout: PickerLayout, state: PickerPaintState, wheel: CanvasImageSource | null = null) => {
		const { ctx, calls } = recording();
		paintPicker(ctx, layout, state, wheel);
		return calls;
	};

	const image = { width: 360, height: 360 } as unknown as CanvasImageSource;

	it('edges and rounds the body as the colour is while it has the focus, its own line and the accent\'s ring over it, so it reads apart from what it opens over', () => {
		const calls = paint(open({ style: { borderWidth: 1, borderColor: '#804000', borderRadius: 8, accent: '#ff8000' } }), stateOf(), image);
		expect(calls[2]).toMatchObject({ op: 'roundRect', args: [0, 0, 288, 308, 8] });
		expect(calls.filter((c) => c.op === 'stroke').slice(0, 2).map((c) => c.stroke)).toEqual(['rgba(128,64,0,1)', 'rgba(255,128,0,1)']);
		// Unstyled, the control's own line, darker as under the pointer, under the ring.
		expect(paint(open(), stateOf(), image).filter((c) => c.op === 'stroke').slice(0, 2).map((c) => c.stroke)).toEqual([PALETTE.lineHover, 'rgba(47,111,214,1)']);
	});

	it('draws the body, the wheel image into its square in wheel and none in names, the tabs over a hairline with the active one\'s word in the accent and a line under it, and the checkerboard under the alpha bar', () => {
		const layout = open({ alpha: true });
		const calls = paint(layout, stateOf(), image);
		expect(calls[1]).toMatchObject({ op: 'clearRect', args: [0, 0, 288, 308] });
		expect(calls[2]).toMatchObject({ op: 'roundRect', args: [0, 0, 288, 308, CONTROL.radius] });
		expect(calls[3]).toMatchObject({ op: 'fill', fill: PALETTE.field });
		const drawn = calls.filter((c) => c.op === 'drawImage');
		expect(drawn).toEqual([{ op: 'drawImage', args: [image, 41, 42, 180, 180], fill: expect.anything(), stroke: expect.anything(), font: expect.anything(), alpha: 1 }]);
		// The hairline across the tab row's foot in the field's line, and under "Wheel", 40 wide at 8 a character, the accent's line reaching 6 past it either side of the tab's middle at 40.25.
		expect(calls.some((c) => c.op === 'fillRect' && c.fill === PALETTE.line && c.args.join() === [10, 33, 268, 1].join())).toBe(true);
		expect(calls.some((c) => c.op === 'fillRect' && c.fill === 'rgba(47,111,214,1)' && c.args.join() === [14.25, 32, 52, 2].join())).toBe(true);
		// The close's cross, 10 across the square's middle at 272, its right ends at 277, a half line short of the contents' right edge at 278, and its feet at 26.5, a half line above the words' baseline at 27.5 (the middle line at 22 plus a capital's 5.5 below it), so its round caps touch the baseline; in the words' colour, and in the accent under the pointer.
		// The cross's strokes are the first; the eyedropper's pipette is painted after every other part.
		const arms = calls.filter((c) => c.op === 'moveTo' || c.op === 'lineTo').map((c) => c.args);
		expect(arms.slice(0, 4)).toEqual([[267, 16.5], [277, 26.5], [277, 16.5], [267, 26.5]]);
		const crossAt = calls.findIndex((c) => c.op === 'lineTo' && c.args.join() === [267, 26.5].join());
		expect(calls[crossAt + 1]).toMatchObject({ op: 'stroke', stroke: 'rgba(27,31,36,1)' });
		const litClose = paint(layout, stateOf({ lit: { kind: 'close', index: -1 } }), image);
		const litAt = litClose.findIndex((c) => c.op === 'lineTo' && c.args.join() === [267, 26.5].join());
		expect(litClose[litAt + 1]).toMatchObject({ op: 'stroke', stroke: 'rgba(47,111,214,1)' });
		expect(calls.some((c) => c.op === 'roundRect' && layout.tabs.some((tab) => c.args[1] === tab.box.y && c.args[2] === tab.box.w))).toBe(false);
		expect(calls.filter((c) => c.op === 'fillText').slice(0, 4).map((c) => [c.args[0], c.fill])).toEqual([['Wheel', 'rgba(47,111,214,1)'], ['Square', 'rgba(27,31,36,1)'], ['Sliders', 'rgba(27,31,36,1)'], ['Names', 'rgba(27,31,36,1)']]);
		const bar = layout.alphaBar!;
		const cells = calls.filter((c) => c.op === 'fillRect' && c.fill === 'rgb(142,142,142)' && (c.args[0] as number) >= bar.x && (c.args[0] as number) < bar.x + bar.w);
		expect(cells.length).toBeGreaterThan(10);
		const stops = calls.filter((c) => c.op === 'addColorStop').map((c) => c.args);
		expect(stops).toEqual([[0, 'rgba(255,139,48,1)'], [1, 'rgba(255,139,48,0)']]);
		expect(paint(open({}, 'names'), stateOf(), image).filter((c) => c.op === 'drawImage')).toEqual([]);
		expect(paint(open(), stateOf(), image).filter((c) => c.op === 'addColorStop')).toEqual([]);
	});

	it('fills each named cell with its colour, its name on it in black where the colour is light and white otherwise, the one equal to the colour ringed in the accent', () => {
		const layout = open({}, 'names');
		const blue = SWATCHES[4];
		const calls = paint(layout, stateOf({ colour: blue.rgb, hex: blue.hex }));
		const cells = calls.filter((c) => c.op === 'fillRect' && typeof c.fill === 'string' && c.fill.startsWith('rgb('));
		expect(cells.map((c) => c.fill)).toEqual(SWATCHES.map((swatch) => `rgb(${swatch.rgb.join(',')})`));
		expect(cells.map((c) => c.args)).toEqual(layout.names.map((cell) => [cell.x, cell.y, cell.w, cell.h]));
		const names = calls.filter((c) => c.op === 'fillText' && SWATCHES.some((swatch) => swatch.name === c.args[0]));
		expect(names.map((c) => c.fill)).toEqual(SWATCHES.map((swatch) => (isLightSwatch(swatch.rgb) ? '#000000' : '#ffffff')));
		const ring = calls.findIndex((c) => c.op === 'roundRect' && c.args[0] === layout.names[4].x + 1 && c.args[1] === layout.names[4].y + 1);
		expect(ring).toBeGreaterThan(0);
		expect(calls[ring + 1]).toMatchObject({ op: 'stroke', stroke: 'rgba(47,111,214,1)' });
	});

	it('writes the space word and the channel values in its space, leaves the field the page\'s input stands over as its box alone, and runs the bars through the space\'s stops', () => {
		const layout = open({ alpha: true }, 'sliders');
		const terms = termsOf(ORANGE, 0.5);
		const { square } = terms;
		const calls = paint(layout, stateOf({ space: 'HSV', terms, field: { kind: 'channel', index: 1 } }));
		const words = calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
		expect(words).toEqual(['Wheel', 'Square', 'Sliders', 'Names', '#ff8b30', 'HSV', '26', '100', '50']);
		// The focused field keeps its box: its face and its line.
		const field = layout.channels[1];
		expect(calls.some((c) => c.op === 'roundRect' && c.args[0] === field.x && c.args[1] === field.y && c.args[2] === field.w)).toBe(true);
		expect(calls.some((c) => c.op === 'roundRect' && c.args[0] === field.x + 0.5 && c.args[2] === field.w - 1)).toBe(true);
		const stops = calls.filter((c) => c.op === 'addColorStop').map((c) => c.args);
		expect(stops.slice(0, 7)).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => [i / 6, `rgb(${barStops('HSV', 0, terms)[i].join(',')})`]));
		expect(stops.slice(7, 9)).toEqual([[0, 'rgb(255,112,0)'], [1, 'rgb(255,255,255)']]);
		expect(stops.slice(9, 11)).toEqual([[0, 'rgb(255,139,48)'], [1, 'rgb(0,0,0)']]);
		expect(stops.slice(11)).toEqual([[0, 'rgba(255,139,48,1)'], [1, 'rgba(255,139,48,0)']]);
		const shares = [barShare('HSV', 0, ORANGE, terms), square.s, 1, 0.5];
		layout.bars.forEach((bar, i) => {
			const loc = bar.y + Math.floor((1 - shares[i]) * (bar.h - 1)) + 0.5;
			expect(calls.some((c) => c.op === 'fillRect' && c.fill === 'rgb(0,0,0)' && c.args.join() === [bar.x, loc - 0.5, bar.w, 1].join()), String(i)).toBe(true);
		});
		const hsl = paint(layout, stateOf({ space: 'HSL', terms, field: { kind: 'hex', index: -1 } }));
		expect(hsl.filter((c) => c.op === 'fillText').map((c) => c.args[0])).toEqual(['Wheel', 'Square', 'Sliders', 'Names', 'HSL', '26', '100', '59', '50']);
		expect(hsl.filter((c) => c.op === 'addColorStop').map((c) => c.args).slice(9, 12)).toEqual([[0, 'rgb(255,255,255)'], [0.5, 'rgb(255,112,0)'], [1, 'rgb(0,0,0)']]);
	});

	it('paints the old half solid and the new half over the checkerboard, the hex and the channel fields with the colour\'s bytes, the alpha as a percentage, and the colour\'s own swatches, the one equal to the colour ringed', () => {
		const layout = open({ alpha: true, swatches: ['#11223380', '#ff8b30'] });
		const calls = paint(layout, stateOf({ colour: [17, 34, 51], terms: termsOf([17, 34, 51], 128 / 255), hex: '#11223380', old: ORANGE, oldAlpha: 1 }));
		const words = calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
		expect(words).toEqual(['Wheel', 'Square', 'Sliders', 'Names', '#11223380', 'RGB', '17', '34', '51', '50']);
		// The old half is solid, the new half over the checkerboard: light cells inside the new half alone.
		const inside = (box: { x: number; y: number; w: number; h: number }) => calls.filter((c) => c.op === 'fillRect' && c.fill === 'rgb(142,142,142)' && (c.args[0] as number) >= box.x && (c.args[0] as number) < box.x + box.w && (c.args[1] as number) >= box.y - 8 && (c.args[1] as number) < box.y + box.h);
		expect(inside(layout.old)).toHaveLength(0);
		expect(inside(layout.new).length).toBeGreaterThan(0);
		// The first swatch is the colour, ringed in the accent two wide; the second has its line alone.
		const swatch = layout.swatches[0];
		const ringed = calls.findIndex((c) => c.op === 'roundRect' && c.args[0] === swatch.x + 1 && c.args[1] === swatch.y + 1 && c.args[2] === swatch.w - 2);
		expect(ringed).toBeGreaterThan(0);
		expect(calls[ringed + 1]).toMatchObject({ op: 'stroke', stroke: 'rgba(47,111,214,1)' });
		const second = layout.swatches[1];
		expect(calls.some((c) => c.op === 'roundRect' && c.args[0] === second.x + 1 && c.args[2] === second.w - 2)).toBe(false);
		expect(calls.some((c) => c.op === 'roundRect' && c.args[0] === second.x + 0.5 && c.args[2] === second.w - 1)).toBe(true);
	});

	it('draws the lit region: a tab\'s word in the accent with no line under it, a swatch, a cell and the old half outlined in the hovered line', () => {
		const layout = open({ swatches: ['#112233'] });
		const lit = (region: Region) => paint(layout, stateOf({ lit: region }));
		const tab = lit({ kind: 'tab', index: 1 });
		expect(tab.filter((c) => c.op === 'fillText').slice(0, 2).map((c) => c.fill)).toEqual([cssColour(layout.style.accent), cssColour(layout.style.accent)]);
		expect(tab.filter((c) => c.op === 'fillRect' && c.fill === cssColour(layout.style.accent) && c.args[3] === PICKER.tabLine)).toHaveLength(1);
		const swatch = lit({ kind: 'swatch', index: 0 });
		const box = layout.swatches[0];
		const outlined = swatch.findIndex((c) => c.op === 'roundRect' && c.args[0] === box.x + 0.5 && c.args[1] === box.y + 0.5 && c.args[2] === box.w - 1);
		// The swatch's own two strokes; the eyedropper's are painted after it.
		expect(swatch.slice(outlined).filter((c) => c.op === 'stroke').slice(0, 2).map((c) => c.stroke)).toEqual([PALETTE.line, PALETTE.lineHover]);
		const old = lit({ kind: 'old', index: -1 });
		expect(old.filter((c) => c.op === 'stroke' && c.stroke === PALETTE.lineHover)).toHaveLength(paint(layout, stateOf()).filter((c) => c.op === 'stroke' && c.stroke === PALETTE.lineHover).length + 1);
		const names = open({}, 'names');
		const cell = paint(names, stateOf({ lit: { kind: 'name', index: 2 } }));
		const edge = cell.findIndex((c) => c.op === 'roundRect' && c.args[0] === names.names[2].x + 0.5 && c.args[1] === names.names[2].y + 0.5);
		expect(cell[edge + 1]).toMatchObject({ op: 'stroke', stroke: PALETTE.lineHover });
	});

	it('rounds and lines its fields as the colour\'s field is, writes the space word in the accent, and paints the preview as one rounded pair with a line between its halves', () => {
		const styled = open({ style: { borderWidth: 2, borderColor: '#804000', borderRadius: 8, accent: '#ff8000' } });
		const calls = paint(styled, stateOf());
		const hex = styled.hex;
		const face = calls.findIndex((c) => c.op === 'roundRect' && c.args.join() === [hex.x, hex.y, hex.w, hex.h, 8].join());
		expect(calls[face + 1]).toMatchObject({ op: 'fill', fill: PALETTE.field });
		expect(calls[face + 2]).toMatchObject({ op: 'roundRect', args: [hex.x + 1, hex.y + 1, hex.w - 2, hex.h - 2, 7] });
		expect(calls[face + 3]).toMatchObject({ op: 'stroke', stroke: 'rgba(128,64,0,1)' });
		expect(calls.find((c) => c.op === 'fillText' && c.args[0] === 'RGB')).toMatchObject({ fill: 'rgba(255,128,0,1)' });
		expect(calls.find((c) => c.op === 'fillText' && c.args[0] === '#ff8b30')).toMatchObject({ fill: 'rgba(27,31,36,1)' });
		// The tab row's hairline takes the style's line colour.
		expect(calls.some((c) => c.op === 'fillRect' && c.fill === 'rgba(128,64,0,1)' && c.args.join() === [10, 33, 268, 1].join())).toBe(true);
		// Unstyled, the control's line and corners, darker under the pointer.
		const plain = open();
		const litHex = paint(plain, stateOf({ lit: { kind: 'hex', index: -1 } }));
		const at = litHex.findIndex((c) => c.op === 'roundRect' && c.args.join() === [plain.hex.x + 0.5, plain.hex.y + 0.5, plain.hex.w - 1, plain.hex.h - 1, CONTROL.radius - 0.5].join());
		expect(litHex[at + 1]).toMatchObject({ op: 'stroke', stroke: PALETTE.lineHover });
		// The preview: clipped to the pair, the two halves filled, a line between them, and another round the pair.
		const pair = [plain.old.x, plain.old.y, plain.old.w + plain.new.w, plain.old.h, PICKER.round];
		const clipAt = litHex.findIndex((c) => c.op === 'roundRect' && c.args.join() === pair.join());
		expect(litHex[clipAt + 1]).toMatchObject({ op: 'clip' });
		expect(litHex.slice(clipAt).find((c) => c.op === 'fillRect' && c.fill === PALETTE.line)).toMatchObject({ args: [plain.new.x - 0.5, plain.old.y, 1, plain.old.h] });
		const edge = litHex.findIndex((c) => c.op === 'roundRect' && c.args.join() === [plain.old.x + 0.5, plain.old.y + 0.5, plain.old.w + plain.new.w - 1, plain.old.h - 1, PICKER.round - 0.5].join());
		expect(litHex[edge + 1]).toMatchObject({ op: 'stroke', stroke: PALETTE.line });
	});

	it('lays a bar\'s line over its rounded fill uncut, so at the end of its value it reaches past the bar', () => {
		const layout = open({ alpha: true });
		const calls = paint(layout, stateOf(), image);
		const bar = layout.alphaBar!;
		// Which save levels a clip is set in, at each call.
		const clipped: boolean[] = [];
		let black = -1;
		calls.forEach((c, i) => {
			if (c.op === 'save') clipped.push(false);
			else if (c.op === 'restore') clipped.pop();
			else if (c.op === 'clip') clipped[clipped.length - 1] = true;
			else if (black < 0 && c.op === 'fillRect' && c.fill === 'rgb(0,0,0)' && c.args.join() === [bar.x, bar.y, bar.w, 1].join()) {
				black = i;
				expect(clipped.some(Boolean)).toBe(false);
			}
		});
		// At an alpha of 1 the line's white reaches a pixel above the bar's top.
		expect(black).toBeGreaterThan(0);
		expect(calls[black - 1]).toMatchObject({ op: 'fillRect', fill: 'rgb(255,255,255)', args: [bar.x, bar.y - 1, bar.w, 3] });
	});

	it('rounds the named cells as one block, from the area\'s top to the last cell\'s foot', () => {
		const names = open({}, 'names');
		const calls = paint(names, stateOf());
		const block = [names.area.x, names.area.y, names.area.w, 7 * PICKER.cell, PICKER.round];
		const at = calls.findIndex((c) => c.op === 'roundRect' && c.args.join() === block.join());
		expect(at).toBeGreaterThan(0);
		expect(calls[at + 1].op).toBe('clip');
		expect(calls.some((c) => c.op === 'roundRect' && c.args.join() === [names.area.x, names.area.y, names.area.w, names.area.h, PICKER.round].join())).toBe(false);
	});

	it('fills its fields as the widget\'s face is, sets its words no larger than PICKER.fontMost, rings a swatch by the text the colour is written as, and restores every save', () => {
		const dark = open({ alpha: true, swatches: ['#11223380'], style: { background: '#1a1a1a', color: '#ffffff', fontSize: 30 } });
		// An alpha reached by steps of a twentieth, written as the byte the swatch holds.
		const calls = paint(dark, stateOf({ colour: [17, 34, 51], terms: termsOf([17, 34, 51], 0.5), hex: '#11223380' }));
		const hexAt = calls.findIndex((c) => c.op === 'fillText' && c.args[0] === '#11223380');
		const face = calls.slice(0, hexAt).reverse().find((c) => c.op === 'fill')!;
		expect(face.fill).toBe('rgba(26,26,26,1)');
		// Asked for at 30, every word is set at 16.
		const fonts = calls.filter((c) => c.op === 'fillText').map((c) => c.font);
		expect(fonts.length).toBeGreaterThan(0);
		expect(fonts.every((font) => font.includes('16px'))).toBe(true);
		const swatch = dark.swatches[0];
		expect(calls.some((c) => c.op === 'roundRect' && c.args[0] === swatch.x + 1 && c.args[2] === swatch.w - 2)).toBe(true);
		expect(calls.filter((c) => c.op === 'save')).toHaveLength(calls.filter((c) => c.op === 'restore').length);
	});

	it('sets its tab names and colour names in the widget\'s font, and its fields\' words and its tooltip\'s in the monospaced family', () => {
		const names = open({ alpha: true }, 'names', 400, 500, 'Pick a colour');
		const calls = paint(names, stateOf({ dropper: { armed: false, tip: true, unavailable: false } }));
		const fontOf = (words: string) => calls.find((c) => c.op === 'fillText' && c.args[0] === words)?.font;
		const mono = '"Roboto Mono", ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';
		expect(fontOf('Names')).toBe('400 16px "Roboto", Roboto, sans-serif');
		expect(fontOf(SWATCHES[0].name)).toBe('400 16px "Roboto", Roboto, sans-serif');
		for (const words of ['#ff8b30', 'RGB', '255', '139', '48', '100']) expect(fontOf(words), words).toBe(`400 16px ${mono}`);
		expect(fontOf('Pick a colour')).toBe(`400 12px ${mono}`);
	});

	it('paints square: the square in its hue in full under a white from its left and a black from its foot, the cursor at the saturation and value, the strip through the seven stops with its line at the hue, the alpha bar, and the Square tab in the accent', () => {
		const layout = open({ alpha: true }, 'square');
		const sq = layout.square!;
		const calls = paint(layout, stateOf({ terms: termsAtSquare(termsOf(ORANGE, 0.5), { h: 240, s: 0.25, v: 0.75 }) }), image);
		expect(calls.filter((c) => c.op === 'drawImage')).toEqual([]);
		const fill = calls.findIndex((c) => c.op === 'fillRect' && c.args.join() === [sq.x, sq.y, sq.w, sq.h].join());
		expect(calls[fill].fill).toBe('rgb(0,0,255)');
		const gradients = calls.slice(fill + 1, fill + 9).filter((c) => c.op === 'fillRect').map((c) => (c.fill as { args: number[] }).args);
		expect(gradients).toEqual([[sq.x, sq.y, sq.x + sq.w, sq.y], [sq.x, sq.y, sq.x, sq.y + sq.h]]);
		const stops = calls.filter((c) => c.op === 'addColorStop').map((c) => c.args);
		expect(stops.slice(0, 4)).toEqual([[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)'], [0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,1)']]);
		expect(stops.slice(4, 11)).toEqual(HUE_STOPS.map((rgb, i) => [i / 6, `rgb(${rgb.join(',')})`]));
		expect(stops.slice(11)).toEqual([[0, 'rgba(255,139,48,1)'], [1, 'rgba(255,139,48,0)']]);
		const rings = calls.filter((c) => c.op === 'arc');
		expect(rings.map((c) => c.args.slice(0, 3))).toEqual([[sq.x + 54, sq.y + 45, PICKER.cursor + 1.5], [sq.x + 54, sq.y + 45, PICKER.cursor]]);
		expect(calls.filter((c) => c.op === 'stroke').map((c) => c.stroke)).toContain('#ffffff');
		// The strip's line at 240 of 360 from the foot, and the alpha bar's at a half, over its checkerboard.
		const strip = layout.hueStrip!;
		const lineAt = (box: { x: number; y: number; h: number }, value: number) => calls.some((c) => c.op === 'fillRect' && c.fill === 'rgb(0,0,0)' && c.args[0] === box.x && c.args[1] === box.y + Math.floor((1 - value) * (box.h - 1)) + 0.5 - 0.5);
		expect(lineAt(strip, 240 / 360)).toBe(true);
		expect(lineAt(layout.alphaBar!, 0.5)).toBe(true);
		const bar = layout.alphaBar!;
		expect(calls.filter((c) => c.op === 'fillRect' && c.fill === 'rgb(142,142,142)' && (c.args[0] as number) >= bar.x && (c.args[0] as number) < bar.x + bar.w).length).toBeGreaterThan(10);
		const words = calls.filter((c) => c.op === 'fillText').slice(0, 4).map((c) => [c.args[0], c.fill]);
		expect(words).toEqual([['Wheel', 'rgba(27,31,36,1)'], ['Square', 'rgba(47,111,214,1)'], ['Sliders', 'rgba(27,31,36,1)'], ['Names', 'rgba(27,31,36,1)']]);
		// "Square", 48 wide, underlined 6 past it either side of its tab's middle at 100.75.
		expect(calls.some((c) => c.op === 'fillRect' && c.fill === 'rgba(47,111,214,1)' && c.args.join() === [70.75, 32, 60, 2].join())).toBe(true);
		// The square, the strip and the alpha bar are painted inside their rounded corners and outlined with them.
		expect(calls.filter((c) => c.op === 'clip').length).toBeGreaterThanOrEqual(3);
		expect(calls.some((c) => c.op === 'roundRect' && c.args[0] === sq.x + 0.5 && c.args[2] === sq.w - 1 && c.args[4] === PICKER.round - 0.5)).toBe(true);
		// Lit, the square and the strip take the hovered line.
		const lit = (region: Region) => paint(layout, stateOf({ lit: region })).filter((c) => c.op === 'stroke' && c.stroke === PALETTE.lineHover).length;
		expect(lit({ kind: 'square', index: -1 })).toBe(lit({ kind: 'new', index: -1 }) + 1);
		expect(lit({ kind: 'hue', index: -1 })).toBe(lit({ kind: 'new', index: -1 }) + 1);
	});

	it('paints sliders in RGB: each channel\'s bar from the channel in full to black with its line at the byte, the alpha\'s from the colour solid to clear over the checkerboard, and the bar the keys act on ringed in the accent', () => {
		const layout = open({ alpha: true }, 'sliders');
		const calls = paint(layout, stateOf({ colour: [255, 128, 0], terms: termsOf([255, 128, 0], 0.25), bar: 2 }));
		const stops = calls.filter((c) => c.op === 'addColorStop').map((c) => c.args);
		expect(stops).toEqual([
			[0, 'rgb(255,0,0)'], [1, 'rgb(0,0,0)'],
			[0, 'rgb(0,255,0)'], [1, 'rgb(0,0,0)'],
			[0, 'rgb(0,0,255)'], [1, 'rgb(0,0,0)'],
			[0, 'rgba(255,128,0,1)'], [1, 'rgba(255,128,0,0)'],
		]);
		const values = [1, 128 / 255, 0, 0.25];
		layout.bars.forEach((bar, i) => {
			const loc = bar.y + Math.floor((1 - values[i]) * (bar.h - 1)) + 0.5;
			expect(calls.some((c) => c.op === 'fillRect' && c.fill === 'rgb(0,0,0)' && c.args.join() === [bar.x, loc - 0.5, bar.w, 1].join()), String(i)).toBe(true);
		});
		const checkered = (bar: { x: number; y: number; w: number; h: number }) => calls.filter((c) => c.op === 'fillRect' && c.fill === 'rgb(142,142,142)' && (c.args[0] as number) >= bar.x && (c.args[0] as number) < bar.x + bar.w && (c.args[1] as number) >= bar.y && (c.args[1] as number) < bar.y + bar.h).length;
		expect(checkered(layout.bars[0])).toBe(0);
		expect(checkered(layout.bars[3])).toBeGreaterThan(10);
		const acted = layout.bars[2];
		const ring = calls.findIndex((c) => c.op === 'roundRect' && c.args[0] === acted.x + 1 && c.args[1] === acted.y + 1 && c.args[2] === acted.w - 2);
		expect(calls[ring + 1]).toMatchObject({ op: 'stroke', stroke: 'rgba(47,111,214,1)' });
		const other = layout.bars[1];
		const edge = calls.findIndex((c) => c.op === 'roundRect' && c.args[0] === other.x + 0.5 && c.args[2] === other.w - 1);
		expect(calls[edge + 1]).toMatchObject({ op: 'stroke', stroke: PALETTE.line });
		const lit = paint(layout, stateOf({ lit: { kind: 'bar', index: 1 } }));
		const litEdge = lit.findIndex((c) => c.op === 'roundRect' && c.args[0] === other.x + 0.5 && c.args[2] === other.w - 1);
		expect(lit[litEdge + 1]).toMatchObject({ op: 'stroke', stroke: PALETTE.lineHover });
		expect(calls.filter((c) => c.op === 'arc')).toEqual([]);
	});

	it('paints the eyedropper after every other part: a field\'s box, its line hovered under the pointer, with a pipette across it in the words\' colour, the pipette and a ring in the accent while armed, the whole half as solid where it is unavailable, and none where there is no eyedropper', () => {
		const layout = open();
		const box = layout.dropper!;
		const rest = paint(layout, stateOf(), image);
		const face = rest.findIndex((c) => c.op === 'roundRect' && c.args.join() === [box.x, box.y, box.w, box.h, CONTROL.radius].join());
		expect(face).toBeGreaterThan(0);
		// The last of the picker: its face, its line, the pipette's tube and collar, and the bulb.
		const after = rest.slice(face);
		expect(after.filter((c) => c.op === 'moveTo' || c.op === 'lineTo').map((c) => c.args)).toEqual([[256, 252], [265, 243], [262, 240], [268, 246]]);
		expect(after.filter((c) => c.op === 'stroke').map((c) => c.stroke)).toEqual([PALETTE.line, 'rgba(27,31,36,1)']);
		expect(after.filter((c) => c.op === 'fill').map((c) => c.fill)).toEqual([PALETTE.field, 'rgba(27,31,36,1)']);
		expect(after.find((c) => c.op === 'roundRect' && c.args[0] === 264.5)?.args).toEqual([264.5, 237.5, 6, 6, 3]);
		expect(after.every((c) => c.alpha === 1)).toBe(true);
		// Hovered: the line darker.
		const lit = paint(layout, stateOf({ lit: { kind: 'dropper', index: -1 } }), image);
		expect(lit.slice(face).filter((c) => c.op === 'stroke')[0].stroke).toBe(PALETTE.lineHover);
		// Armed: the pipette in the accent, and a ring round the box.
		const armed = paint(layout, stateOf({ dropper: { armed: true, tip: false, unavailable: false } }), image).slice(face);
		expect(armed.filter((c) => c.op === 'stroke').map((c) => c.stroke)).toEqual([PALETTE.line, 'rgba(47,111,214,1)', 'rgba(47,111,214,1)']);
		// Unavailable: the whole of it half as solid, its line not hovered under the pointer, and its tooltip, while it shows, solid over it.
		const unavailable = paint(layout, stateOf({ lit: { kind: 'dropper', index: -1 }, dropper: { armed: false, tip: true, unavailable: true } }), image);
		const restored = unavailable.findIndex((c, i) => i > face && c.op === 'restore');
		const own = unavailable.slice(face, restored);
		expect(own.filter((c) => c.op === 'moveTo' || c.op === 'lineTo').map((c) => c.args)).toEqual([[256, 252], [265, 243], [262, 240], [268, 246]]);
		expect(own.every((c) => c.alpha === PALETTE.disabled)).toBe(true);
		expect(own.filter((c) => c.op === 'stroke')[0].stroke).toBe(PALETTE.line);
		const bubble = unavailable.findIndex((c) => c.op === 'fill' && c.fill === PALETTE.tip);
		expect(bubble).toBeGreaterThan(restored);
		expect(unavailable.slice(bubble).filter((c) => c.op === 'fill' || c.op === 'fillText').every((c) => c.alpha === 1)).toBe(true);
		// Without an eyedropper: no pipette and no tooltip, whatever the state says, and the hex field's face reaching the row's end.
		const none = open({}, 'wheel', 400, 500, null);
		const bare = paint(none, stateOf({ dropper: { armed: true, tip: true, unavailable: false } }), image);
		expect(bare.some((c) => c.op === 'moveTo' && c.args.join() === '256,252')).toBe(false);
		expect(bare.some((c) => c.op === 'fill' && c.fill === PALETTE.tip)).toBe(false);
		expect(bare.some((c) => c.op === 'roundRect' && c.args.join() === [74, 230, 204, 30, CONTROL.radius].join())).toBe(true);
	});

	it('paints the dock button beside the close in the cross\'s stroke, as tall as the cross and on its baseline: a window open at its top-right corner with an arrow out of it to pop out, or into it to dock, in the accent under the pointer', () => {
		const third = 10 / 3;
		const marks = (calls: Call[]) => calls.filter((c) => c.op === 'moveTo' || c.op === 'lineTo').map((c) => c.args);
		// The cross's four strokes first, then the window from the gap's left end round to its foot, 10 across centred at 248.
		const window = [[248, 16.5], [243, 16.5], [243, 26.5], [253, 26.5], [253, 21.5]];
		const out = paint(open({}, 'wheel', 400, 500, DROPPER_TIPS.custom, 'popout'), stateOf(), image);
		expect(marks(out).slice(4, 14)).toEqual([...window, [248, 21.5], [254, 15.5], [254 - third, 15.5], [254, 15.5], [254, 15.5 + third]]);
		const into = paint(open({}, 'wheel', 400, 500, DROPPER_TIPS.custom, 'dock'), stateOf({ lit: { kind: 'dock', index: -1 } }), image);
		expect(marks(into).slice(4, 14)).toEqual([...window, [254, 15.5], [248, 21.5], [248 + third, 21.5], [248, 21.5], [248, 21.5 - third]]);
		// In the words' colour, and in the accent under the pointer.
		const strokeAfter = (calls: Call[], at: number[]) => calls[calls.findIndex((c) => c.op === 'lineTo' && c.args.join() === at.join()) + 1];
		expect(strokeAfter(out, [254, 15.5 + third])).toMatchObject({ op: 'stroke', stroke: 'rgba(27,31,36,1)' });
		expect(strokeAfter(into, [248, 21.5 - third])).toMatchObject({ op: 'stroke', stroke: 'rgba(47,111,214,1)' });
		// No dock button, no window.
		expect(marks(paint(open(), stateOf(), image)).some((at) => at.join() === '243,16.5')).toBe(false);
	});

	it('keeps the line under the active tab\'s word within its tab, which the dock button narrows', () => {
		// "Sliders", 56 wide at 8 a character, would reach 34 either side of its tab's middle at 146.25; its tab is 54.5 wide.
		const calls = paint(open({}, 'sliders', 400, 500, DROPPER_TIPS.custom, 'popout'), stateOf(), image);
		expect(calls.some((c) => c.op === 'fillRect' && c.fill === 'rgba(47,111,214,1)' && c.args.join() === [119, 32, 54.5, 2].join())).toBe(true);
	});

	it('paints the eyedropper\'s tooltip only while it shows, last: a bubble in the tooltip\'s colour, its words in white a line each at the left of its room', () => {
		const layout = open({}, 'wheel', 400, 500, 'Pick a colour from the feed\nEscape puts it away');
		const tip = layout.tip!;
		expect(paint(layout, stateOf(), image).some((c) => c.op === 'fill' && c.fill === PALETTE.tip)).toBe(false);
		const shown = paint(layout, stateOf({ dropper: { armed: false, tip: true, unavailable: false } }), image);
		const bubble = shown.findIndex((c) => c.op === 'fill' && c.fill === PALETTE.tip);
		expect(shown[bubble - 1]).toMatchObject({ op: 'roundRect', args: [tip.box.x, tip.box.y, tip.box.w, tip.box.h, PICKER.round] });
		const words = shown.slice(bubble).filter((c) => c.op === 'fillText');
		expect(words.map((c) => [c.args[0], c.args[1], c.fill])).toEqual([['Pick a colour from the feed', tip.box.x + PICKER.tipPad, '#ffffff'], ['Escape puts it away', tip.box.x + PICKER.tipPad, '#ffffff']]);
		expect(words[1].args[2] as number - (words[0].args[2] as number)).toBe(12 * CONTROL.lineHeight);
		expect(shown.filter((c) => c.op === 'save')).toHaveLength(shown.filter((c) => c.op === 'restore').length);
	});

	it('lays out the names and the swatches its options give it, and opens in the mode they name', () => {
		const widget = readColourOptions({ value: '#abc', mode: 'names', swatches: ['#123'] });
		expect(widget).toEqual({ value: '#aabbcc', mode: 'names', swatches: ['#112233'] });
		const layout = layoutPicker(laidOf({ mode: 'names', swatches: ['#123'] }), 400, 500, measure, widget.mode!);
		expect(layout.names).toHaveLength(SWATCHES.length);
		expect(layout.wheel).toBeNull();
		expect(layout.swatches).toHaveLength(1);
		for (const mode of ['square', 'sliders'] as const) {
			const read = readColourOptions({ mode });
			expect(read.mode).toBe(mode);
			const opened = layoutPicker(laidOf({ mode }), 400, 500, measure, read.mode!);
			expect(opened.mode).toBe(mode);
			expect(mode === 'square' ? opened.square : opened.bars[0]).not.toBeNull();
		}
	});
});

describe('the eyedropper\'s layout and region', () => {
	it('lays its tooltip out from its words in the picker\'s monospaced font at a title\'s size, a line break starting another line and each line wrapped to the picker\'s width, right-aligned above the eyedropper', () => {
		// 6 a character at 12 px.
		const layout = open({}, 'wheel', 400, 500, 'Pick a colour from the feed\nEscape puts it away');
		expect(layout.tip!.font.size).toBe(12);
		expect(layout.tip!.font.family).toBe('Roboto Mono');
		expect(layout.tip!.lines).toEqual(['Pick a colour from the feed', 'Escape puts it away']);
		const w = 27 * 6 + 2 * PICKER.tipPad;
		const h = 2 * 12 * CONTROL.lineHeight + 2 * PICKER.tipPad;
		expect(layout.tip!.box).toEqual({ x: 278 - w, y: 230 - PICKER.gap / 2 - h, w, h });
		// Words longer than the room wrap at the last space that fits, every word kept.
		const words = DROPPER_TIPS.fallback;
		const wrapped = open({}, 'wheel', 400, 500, words).tip!;
		expect(wrapped.lines.length).toBeGreaterThan(1);
		expect(wrapped.lines.join(' ')).toBe(words);
		for (const line of wrapped.lines) expect(line.length * 6).toBeLessThanOrEqual(268 - 2 * PICKER.tipPad);
		expect(wrapped.box.x + wrapped.box.w).toBe(278);
		expect(wrapped.box.y + wrapped.box.h).toBe(230 - PICKER.gap / 2);
	});

	it('names the eyedropper, and its tooltip over what lies under it only while it shows', () => {
		const layout = open({}, 'wheel', 400, 500, 'Pick a colour from the feed\nEscape puts it away');
		const dropper = layout.dropper!;
		expect(region(layout, centre(dropper))).toEqual({ kind: 'dropper', index: -1 });
		expect(region(layout, [layout.hex.x + layout.hex.w - 1, 245])).toEqual({ kind: 'hex', index: -1 });
		expect(region(layout, [dropper.x - 4, 245])).toBeNull();
		const under = centre(layout.tip!.box);
		const terms = termsOf(ORANGE, 1);
		expect(pickerRegionAt(layout, under[0], under[1], terms.unit, true)).toEqual({ kind: 'tip', index: -1 });
		expect(pickerRegionAt(layout, under[0], under[1], terms.unit, false)).toEqual(region(layout, under));
		expect(colourAtRegion(layout, { kind: 'dropper', index: -1 }, ...centre(dropper), terms, ORANGE)).toBeNull();
		expect(fieldBox(layout, { kind: 'dropper', index: -1 })).toBeNull();
	});
});

describe('the channel values, the fields and the bars in a colour space', () => {
	const terms = termsOf(ORANGE, 1);
	const GREY: Rgb = [128, 128, 128];

	it('reads a colour as its bytes in RGB, its hue in degrees and its saturation and value in percent in HSV, and its hue, saturation and lightness in HSL, a grey at the square\'s hue', () => {
		expect(channelsOf('RGB', ORANGE, terms)).toEqual([255, 139, 48]);
		expect(channelsOf('HSV', ORANGE, terms)).toEqual([26, 81, 100]);
		expect(channelsOf('HSL', ORANGE, terms)).toEqual([26, 100, 59]);
		expect(terms.hsl).toEqual(rgbToHsl([1, 139 / 255, 48 / 255]));
		const grey = termsKeeping(GREY, 1, terms);
		expect(channelsOf('HSV', GREY, grey)).toEqual([26, 0, 50]);
		expect(channelsOf('HSL', GREY, grey)).toEqual([26, 0, 50]);
	});

	it('sets one channel of a space, held to its range, and a value set reads back as itself and steps on from there, over every value of every HSV and HSL channel from several colours, a hue of 360 as 360', () => {
		expect(termsWithChannel('RGB', 1, 300, terms, ORANGE).colour).toEqual([255, 255, 48]);
		expect(termsWithChannel('RGB', 2, -1, terms, ORANGE).colour).toEqual([255, 139, 0]);
		const sat = termsWithChannel('HSV', 1, 50, terms, ORANGE);
		expect(sat.terms.square).toEqual({ h: terms.square.h, s: 0.5, v: 1 });
		expect(sat.terms.hsl).toEqual(hsvToHsl(sat.terms.square));
		expect(sat.colour).toEqual(squareColour({ h: terms.square.h, s: 0.5, v: 1 }));
		expect(sat.terms.hue).toEqual(saturatedOf(sat.colour).hue);
		const light = termsWithChannel('HSL', 2, 25, terms, ORANGE);
		expect(channelsOf('HSL', light.colour, light.terms)).toEqual([26, 100, 25]);
		expect(light.terms.hsl).toEqual({ h: terms.hsl.h, s: 1, l: 0.25 });
		expect(light.terms.square).toEqual(hslToHsv(light.terms.hsl));
		expect(light.colour).toEqual([128, 56, 0]);
		// From a saturated orange, a purple, a brown, a dark red, a pale cream and a blued grey: a percent or a degree the bytes cannot hold reads back all the same, and a step from the value shown moves it.
		const starts: Rgb[] = [ORANGE, [135, 46, 141], [163, 123, 75], [40, 20, 20], [250, 245, 240], [128, 128, 136]];
		for (const start of starts) {
			const from = termsOf(start, 1);
			for (const space of ['HSV', 'HSL'] as const) {
				for (let i = 0; i < 3; i++) {
					const most = CHANNELS[space][i];
					for (let value = 0; value <= most; value++) {
						const at = termsWithChannel(space, i, value, from, start);
						expect(channelsOf(space, at.colour, at.terms)[i], `${start} ${space} ${i} ${value}`).toBe(value);
						if (value < most) {
							const up = termsWithChannel(space, i, value + 1, at.terms, at.colour);
							expect(channelsOf(space, up.colour, up.terms)[i], `${start} ${space} ${i} ${value} up`).toBe(value + 1);
						}
					}
				}
			}
		}
	});

	it('moves the square and the wheel to a hue set on a grey, which its bytes cannot hold, and keeps the wheel\'s hue for a value set on one', () => {
		const grey = termsOf(GREY, 1);
		const turned = termsWithChannel('HSV', 0, 200, grey, GREY);
		expect(turned.colour).toEqual(GREY);
		expect(turned.terms.square).toEqual({ h: 200, s: 0, v: 128 / 255 });
		expect(turned.terms.hsl.h).toBe(200);
		expect(turned.terms.hue).toEqual([0, 170, 255]);
		expect(turned.terms.unit).toEqual(unitOfHue([0, 170, 255]));
		const lit = termsWithChannel('HSL', 0, 90, grey, GREY);
		expect(lit.terms.hue).toEqual([128, 255, 0]);
		expect(lit.terms.square.h).toBe(90);
		expect(lit.terms.hsl.h).toBe(90);
		const darker = termsWithChannel('HSV', 2, 30, grey, GREY);
		expect(darker.colour).toEqual([77, 77, 77]);
		expect(darker.terms.hue).toEqual(grey.hue);
		expect(darker.terms.square).toEqual({ h: 0, s: 0, v: 0.3 });
	});

	it('keeps a saturation the colour cannot name through the conversion: the HSL saturation through the lightness\'s ends, the square\'s through black, and reads it as none from the colour', () => {
		const white = termsWithChannel('HSL', 2, 100, terms, ORANGE);
		expect(white.colour).toEqual([255, 255, 255]);
		expect(white.terms.hsl).toEqual({ h: terms.hsl.h, s: 1, l: 1 });
		expect(white.terms.square).toEqual({ h: terms.hsl.h, s: 0, v: 1 });
		const back = termsWithChannel('HSL', 2, 59, white.terms, white.colour);
		expect(channelsOf('HSL', back.colour, back.terms)).toEqual([26, 100, 59]);
		expect(back.colour).toEqual([255, 138, 46]);
		const black = termsWithChannel('HSL', 2, 0, terms, ORANGE);
		expect(black.colour).toEqual([0, 0, 0]);
		expect(black.terms.hsl.s).toBe(1);
		expect(black.terms.square.s).toBe(terms.square.s);
		const dark = termsWithChannel('HSV', 2, 0, terms, ORANGE);
		expect(dark.terms.square.s).toBe(terms.square.s);
		expect(dark.terms.hsl.s).toBe(terms.hsl.s);
		expect(termsWithChannel('HSV', 2, 100, dark.terms, dark.colour).colour).toEqual(ORANGE);
		// Read from the bytes, white and black name no saturation.
		expect(termsKeeping([255, 255, 255], 1, terms).hsl.s).toBe(0);
		expect(termsKeeping([0, 0, 0], 1, terms).square.s).toBe(0);
	});

	it('reads the square afresh from the wheel\'s colour as the wheel moves, a grey at the wheel\'s hue', () => {
		expect(withSquare(terms).square).toEqual(rgbToHsv([1, 139 / 255, 48 / 255]));
		expect(withSquare(terms).hsl).toEqual(rgbToHsl([1, 139 / 255, 48 / 255]));
		const grey = termsOf(GREY, 1);
		const turned = withSquare({ ...grey, unit: unitOfHue([0, 0, 255]), hue: [0, 0, 255] });
		expect(turned.square).toEqual({ h: 240, s: 0, v: 128 / 255 });
		expect(turned.hsl).toEqual({ h: 240, s: 0, l: 128 / 255 });
		const layout = open();
		const ring = colourAtRegion(layout, { kind: 'ring', index: -1 }, ...onWheel(layout, 81, 120), grey, GREY)!;
		expect(ring.terms.square.h).toBe(240);
		expect(ring.colour).toEqual(GREY);
	});

	it('runs each bar from the channel in full to black in RGB, and in HSV and HSL from its most to its least at the other channels\' values, the hue through seven stops and the lightness through three, its line at the channel\'s share', () => {
		expect(barStops('RGB', 0, terms)).toEqual([[255, 0, 0], [0, 0, 0]]);
		expect(barShare('RGB', 1, ORANGE, terms)).toBeCloseTo(139 / 255, 12);
		expect(barStops('HSV', 0, terms)).toEqual([[255, 48, 48], [255, 48, 255], [48, 48, 255], [48, 255, 255], [48, 255, 48], [255, 255, 48], [255, 48, 48]]);
		expect(barStops('HSV', 1, terms)).toEqual([[255, 112, 0], [255, 255, 255]]);
		expect(barStops('HSV', 2, terms)).toEqual([[255, 139, 48], [0, 0, 0]]);
		expect(barShare('HSV', 0, ORANGE, terms)).toBeCloseTo(terms.square.h / 360, 12);
		expect(barShare('HSV', 2, ORANGE, terms)).toBe(1);
		expect(barStops('HSL', 0, terms)).toEqual(barStops('HSV', 0, terms));
		expect(barStops('HSL', 1, terms)).toEqual([[255, 139, 48], [152, 152, 152]]);
		expect(barStops('HSL', 2, terms)).toEqual([[255, 255, 255], [255, 112, 0], [0, 0, 0]]);
		expect(barShare('HSL', 2, ORANGE, terms)).toBeCloseTo((1 + 48 / 255) / 2, 12);
		// The line stands where a point set the channel, in HSL as in HSV.
		const lit = termsWithChannel('HSL', 1, 37, terms, ORANGE);
		expect(barShare('HSL', 1, lit.colour, lit.terms)).toBe(0.37);
	});

	it('sets a bar\'s channel by the share up it in HSV and HSL, the hue 360 at the top of either, and the dialog\'s byte in RGB', () => {
		const layout = open({}, 'sliders');
		const [first, second, third] = layout.bars;
		const top = colourAtRegion(layout, { kind: 'bar', index: 0 }, first.x + 5, first.y, terms, ORANGE, 'HSV')!;
		expect(top.terms.square.h).toBe(360);
		expect(top.colour).toEqual(squareColour({ ...terms.square, h: 360 }));
		const mid = colourAtRegion(layout, { kind: 'bar', index: 1 }, second.x + 5, second.y + second.h / 2, terms, ORANGE, 'HSV')!;
		expect(mid.terms.square.s).toBe(0.5);
		const turned = colourAtRegion(layout, { kind: 'bar', index: 0 }, first.x + 5, first.y - 20, terms, ORANGE, 'HSL')!;
		expect(turned.terms.hsl.h).toBe(360);
		expect(channelsOf('HSL', turned.colour, turned.terms)[0]).toBe(360);
		expect(barShare('HSL', 0, turned.colour, turned.terms)).toBe(1);
		const foot = colourAtRegion(layout, { kind: 'bar', index: 2 }, third.x, third.y + third.h, terms, ORANGE, 'HSL')!;
		expect(foot.colour).toEqual([0, 0, 0]);
		// Back up from black, the saturation is as it was.
		const half = colourAtRegion(layout, { kind: 'bar', index: 2 }, third.x, third.y + third.h / 2, foot.terms, foot.colour, 'HSL')!;
		expect(half.colour).toEqual([255, 112, 0]);
		expect(colourAtRegion(layout, { kind: 'bar', index: 0 }, first.x, first.y + first.h / 2, terms, ORANGE)!.colour).toEqual([128, 139, 48]);
	});

	it('walks the fields as hex, the channels and the alpha where the widget carries one, names each one\'s box, and gives each its words', () => {
		const layout = open({ alpha: true });
		expect(fieldChain(layout)).toEqual([{ kind: 'hex', index: -1 }, { kind: 'channel', index: 0 }, { kind: 'channel', index: 1 }, { kind: 'channel', index: 2 }, { kind: 'alphaField', index: -1 }]);
		expect(fieldChain(open())).toHaveLength(4);
		expect(fieldBox(layout, { kind: 'hex', index: -1 })).toBe(layout.hex);
		expect(fieldBox(layout, { kind: 'channel', index: 2 })).toBe(layout.channels[2]);
		expect(fieldBox(layout, { kind: 'channel', index: 3 })).toBeNull();
		expect(fieldBox(layout, { kind: 'alphaField', index: -1 })).toBe(layout.alphaField);
		expect(fieldBox(open(), { kind: 'alphaField', index: -1 })).toBeNull();
		expect(fieldBox(layout, { kind: 'space', index: -1 })).toBeNull();
		const half = { ...terms, alpha: 0.5 };
		expect(fieldText({ kind: 'hex', index: -1 }, 'HSV', '#ff8b3080', ORANGE, half)).toBe('#ff8b3080');
		expect(fieldText({ kind: 'channel', index: 1 }, 'HSV', '#ff8b30', ORANGE, half)).toBe('81');
		expect(fieldText({ kind: 'channel', index: 2 }, 'RGB', '#ff8b30', ORANGE, half)).toBe('48');
		expect(fieldText({ kind: 'channel', index: 2 }, 'HSL', '#ff8b30', ORANGE, half)).toBe('59');
		expect(fieldText({ kind: 'alphaField', index: -1 }, 'RGB', '#ff8b30', ORANGE, half)).toBe('50');
		expect(fieldText({ kind: 'old', index: -1 }, 'RGB', '#ff8b30', ORANGE, half)).toBe('');
	});
});
