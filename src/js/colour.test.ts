/**
 * @fileoverview The standard colours, the light/dark rule and the bar
 * painter. The colours' names, bytes and light or dark words are checked
 * against the table the colour dialog (picker.js) builds from them, as a
 * browser showed it: its cells in page order, row by row across its two
 * columns of seven, copied here as literals. The painters draw into a
 * context that records each call. The conversions are checked at the sector
 * boundaries, over a grid of colours and at the greys, and the two between
 * hsv and hsl against each other and against rgbToHsl's reading of
 * hsvToRgb's unrounded output, both to nine decimal places; the colour
 * spaces by their channels' reach and the reading of a typed channel.
 */
import { describe, expect, it } from 'vitest';
import { parseColour } from './hex.ts';
import { CHANNELS, COLOUR_SPACES, LIGHT_SWATCH, SWATCHES, hslToHsv, hslToRgb, hsvToHsl, hsvToRgb, isLightSwatch, paintBar, paintChecker, readChannel, rgbToHsl, rgbToHsv } from './colour.ts';

/** The dialog's cells in page order: the name, the class its words were coloured by, the cell's background. */
const TABLE_CELLS: [string, string, string][] = [
	['Black', '___colorBox ___white', 'rgb(0, 0, 0)'], ['Green', '___colorBox ___black', 'rgb(114, 243, 74)'],
	['Dark', '___colorBox ___white', 'rgb(63, 63, 63)'], ['Magenta', '___colorBox ___black', 'rgb(235, 87, 247)'],
	['Grey', '___colorBox ___white', 'rgb(127, 127, 127)'], ['Orange', '___colorBox ___black', 'rgb(240, 151, 55)'],
	['Light', '___colorBox ___black', 'rgb(191, 191, 191)'], ['Purple', '___colorBox ___white', 'rgb(135, 46, 141)'],
	['Blue', '___colorBox ___white', 'rgb(14, 60, 245)'], ['Red', '___colorBox ___white', 'rgb(234, 64, 37)'],
	['Brown', '___colorBox ___white', 'rgb(163, 123, 75)'], ['Yellow', '___colorBox ___black', 'rgb(255, 250, 83)'],
	['Cyan', '___colorBox ___black', 'rgb(115, 249, 253)'], ['White', '___colorBox ___black', 'rgb(255, 255, 255)'],
];

/** The table's cells in the order the colours are offered: down the first column, then the second. */
const OFFERED = TABLE_CELLS.map((_, i) => TABLE_CELLS[(i % 7) * 2 + Math.floor(i / 7)]);

/** One call a painter made, with the fill standing when it was made. */
interface Call {
	op: string;
	args: unknown[];
	fill: unknown;
}

/** A context that records every call; a gradient records its stops. */
const recording = () => {
	const calls: Call[] = [];
	const state = { fillStyle: '' as unknown };
	const stack: (typeof state)[] = [];
	const record = (op: string) => (...args: unknown[]) => { calls.push({ op, args, fill: state.fillStyle }); };
	const ctx = {
		save: () => { stack.push({ ...state }); calls.push({ op: 'save', args: [], fill: state.fillStyle }); },
		restore: () => { Object.assign(state, stack.pop()); calls.push({ op: 'restore', args: [], fill: state.fillStyle }); },
		beginPath: record('beginPath'),
		rect: record('rect'),
		clip: record('clip'),
		fillRect: record('fillRect'),
		createLinearGradient: (...args: number[]) => {
			const stops: [number, string][] = [];
			calls.push({ op: 'createLinearGradient', args, fill: state.fillStyle });
			return { stops, addColorStop: (offset: number, colour: string) => { stops.push([offset, colour]); } };
		},
	};
	Object.defineProperty(ctx, 'fillStyle', { get: () => state.fillStyle, set: (v) => { state.fillStyle = v; } });
	return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
};

const LIGHT_CELL = 'rgb(142,142,142)';

describe('SWATCHES', () => {
	it('lists the fourteen colours by the dialog\'s names, bytes and order', () => {
		expect(SWATCHES.length).toBe(14);
		SWATCHES.forEach((swatch, i) => {
			const [name, , background] = OFFERED[i];
			expect(swatch.name).toBe(name);
			expect(background).toBe(`rgb(${swatch.rgb.join(', ')})`);
		});
	});

	it('writes each as a hex that reads back to its bytes', () => {
		for (const swatch of SWATCHES) {
			const colour = parseColour(swatch.hex)!;
			expect([colour.r, colour.g, colour.b].map((c) => Math.round(c * 255))).toEqual(swatch.rgb);
			expect(colour.a).toBe(1);
		}
	});
});

describe('isLightSwatch', () => {
	it('splits the colours as the dialog coloured its words: black on the light ones, white on the dark', () => {
		SWATCHES.forEach((swatch, i) => {
			expect(isLightSwatch(swatch.rgb)).toBe(OFFERED[i][1].endsWith('___black'));
		});
	});

	it('reads light only past the sum', () => {
		expect(isLightSwatch([127, 127, 127])).toBe(false);
		expect(isLightSwatch([127, 127, 128])).toBe(true);
		expect(isLightSwatch([LIGHT_SWATCH, 0, 0, 0])).toBe(false);
	});
});

describe('paintChecker', () => {
	it('fills the box dark and lays light cells a cell apart, every other column starting a cell lower, clipped to the box', () => {
		const { ctx, calls } = recording();
		paintChecker(ctx, { x: 0, y: 0, w: 24, h: 258 }, 1);
		expect(calls.slice(0, 4).map((c) => [c.op, c.args])).toEqual([['save', []], ['beginPath', []], ['rect', [0, 0, 24, 258]], ['clip', []]]);
		const fills = calls.filter((c) => c.op === 'fillRect');
		expect(fills[0]).toEqual({ op: 'fillRect', args: [0, 0, 24, 258], fill: 'rgb(91,91,91)' });
		const cells = fills.slice(1);
		expect(cells.every((c) => c.fill === LIGHT_CELL)).toBe(true);
		const at = (x: number) => cells.filter((c) => c.args[0] === x).map((c) => c.args[1]);
		expect(at(0)).toEqual(Array.from({ length: 17 }, (_, k) => k * 16));
		expect(at(8)).toEqual(Array.from({ length: 16 }, (_, k) => 8 + k * 16));
		expect(at(16)).toEqual(Array.from({ length: 17 }, (_, k) => k * 16));
		expect(cells.every((c) => c.args[2] === 8 && c.args[3] === 8)).toBe(true);
		expect(calls[calls.length - 1].op).toBe('restore');
	});

	it('scales its cells by the pixels per logical pixel and stands them in a box away from the origin', () => {
		const { ctx, calls } = recording();
		paintChecker(ctx, { x: 100, y: 40, w: 30, h: 50 }, 1.5);
		const cells = calls.filter((c) => c.op === 'fillRect').slice(1);
		expect(cells.map((c) => c.args)).toEqual([
			[100, 40, 12, 12], [100, 64, 12, 12], [100, 88, 12, 12],
			[112, 52, 12, 12], [112, 76, 12, 12],
			[124, 40, 12, 12], [124, 64, 12, 12], [124, 88, 12, 12],
		]);
		expect(calls.find((c) => c.op === 'rect')!.args).toEqual([100, 40, 30, 50]);
	});
});

describe('paintBar', () => {
	it('runs its gradient from the first stop at the top to the last at the foot, and lines it at the value', () => {
		const { ctx, calls } = recording();
		paintBar(ctx, { x: 0, y: 0, w: 24, h: 258 }, 1, [[255, 0, 0], [0, 0, 0]], 0.5);
		expect(calls.some((c) => c.op === 'clip')).toBe(false);
		const gradient = calls.find((c) => c.op === 'createLinearGradient')!;
		expect(gradient.args).toEqual([0, 0, 0, 258]);
		const fills = calls.filter((c) => c.op === 'fillRect');
		expect(fills.length).toBe(3);
		expect(fills[0].args).toEqual([0, 0, 24, 258]);
		expect((fills[0].fill as { stops: unknown }).stops).toEqual([[0, 'rgb(255,0,0)'], [1, 'rgb(0,0,0)']]);
		// The line's row: (1 - 0.5) × 257 floored, 128, and its centre half a pixel down.
		expect(fills[1]).toEqual({ op: 'fillRect', args: [0, 127, 24, 3], fill: 'rgb(255,255,255)' });
		expect(fills[2]).toEqual({ op: 'fillRect', args: [0, 128, 24, 1], fill: 'rgb(0,0,0)' });
	});

	it('lays the checkerboard first for a bar with alpha, and writes a four-entry stop as rgba', () => {
		const { ctx, calls } = recording();
		paintBar(ctx, { x: 0, y: 0, w: 48, h: 516 }, 2, [[200, 100, 50, 1], [200, 100, 50, 0]], 1, true);
		const restore = calls.findIndex((c) => c.op === 'restore');
		const gradientAt = calls.findIndex((c) => c.op === 'createLinearGradient');
		expect(restore).toBeGreaterThan(0);
		expect(gradientAt).toBeGreaterThan(restore);
		expect(calls.filter((c, i) => i < restore && c.op === 'fillRect' && c.fill === LIGHT_CELL).length).toBe(17 + 16 + 17);
		const fills = calls.slice(gradientAt).filter((c) => c.op === 'fillRect');
		expect((fills[0].fill as { stops: unknown }).stops).toEqual([[0, 'rgba(200,100,50,1)'], [1, 'rgba(200,100,50,0)']]);
		// At the value 1 the line sits on the top row: its centre half a pixel down, 6 and 2 pixels thick.
		expect(fills[1].args).toEqual([0, -2.5, 48, 6]);
		expect(fills[2].args).toEqual([0, -0.5, 48, 2]);
	});

	it('spaces a list of stops evenly and places everything in the box it is given', () => {
		const { ctx, calls } = recording();
		paintBar(ctx, { x: 10, y: 20, w: 18, h: 101 }, 1, [[255, 0, 0], [0, 255, 0], [0, 0, 255]], 0);
		expect(calls.find((c) => c.op === 'createLinearGradient')!.args).toEqual([10, 20, 10, 121]);
		const fills = calls.filter((c) => c.op === 'fillRect');
		expect((fills[0].fill as { stops: unknown }).stops).toEqual([[0, 'rgb(255,0,0)'], [0.5, 'rgb(0,255,0)'], [1, 'rgb(0,0,255)']]);
		expect(fills[0].args).toEqual([10, 20, 18, 101]);
		expect(fills[1].args).toEqual([10, 119, 18, 3]);
		expect(fills[2].args).toEqual([10, 120, 18, 1]);
	});
});

describe('rgbToHsv and hsvToRgb', () => {
	const units = (bytes: number[]): [number, number, number] => [bytes[0] / 255, bytes[1] / 255, bytes[2] / 255];
	const bytes = (rgb: [number, number, number]) => rgb.map((c) => Math.round(c * 255));

	it('reads each sector\'s boundary colour as its hue, in full, and back', () => {
		const sectors: [number, number[]][] = [[0, [255, 0, 0]], [60, [255, 255, 0]], [120, [0, 255, 0]], [180, [0, 255, 255]], [240, [0, 0, 255]], [300, [255, 0, 255]]];
		for (const [h, rgb] of sectors) {
			expect(rgbToHsv(units(rgb)), String(h)).toEqual({ h, s: 1, v: 1 });
			expect(bytes(hsvToRgb({ h, s: 1, v: 1 })), String(h)).toEqual(rgb);
		}
		// A hue of 360, or past it either way, is the same turn.
		expect(bytes(hsvToRgb({ h: 360, s: 1, v: 1 }))).toEqual([255, 0, 0]);
		expect(bytes(hsvToRgb({ h: -60, s: 1, v: 1 }))).toEqual([255, 0, 255]);
		expect(bytes(hsvToRgb({ h: 420, s: 1, v: 1 }))).toEqual([255, 255, 0]);
		// Half way between two boundaries, and a colour of every term.
		expect(rgbToHsv(units([255, 128, 0])).h).toBeCloseTo(30.1176, 3);
		expect(rgbToHsv(units([255, 139, 48]))).toMatchObject({ s: 1 - 48 / 255, v: 1 });
		expect(bytes(hsvToRgb({ h: 30, s: 0.5, v: 0.5 }))).toEqual([128, 96, 64]);
	});

	it('round-trips a grid of colours within a byte, the hue from 0 to under 360', () => {
		const steps = [0, 1, 17, 64, 127, 128, 200, 254, 255];
		let worst = 0;
		for (const r of steps) for (const g of steps) for (const b of steps) {
			const hsv = rgbToHsv(units([r, g, b]));
			expect(hsv.h).toBeGreaterThanOrEqual(0);
			expect(hsv.h).toBeLessThan(360);
			const back = hsvToRgb(hsv).map((c) => c * 255);
			worst = Math.max(worst, ...back.map((c, i) => Math.abs(c - [r, g, b][i])));
			expect(bytes(hsvToRgb(hsv)), `${r},${g},${b}`).toEqual([r, g, b]);
		}
		expect(worst).toBeLessThan(1e-9);
	});

	it('holds the hue given at zero saturation, black and white among the greys, and gives a grey at any hue with none', () => {
		expect(rgbToHsv(units([128, 128, 128]))).toEqual({ h: 0, s: 0, v: 128 / 255 });
		expect(rgbToHsv(units([128, 128, 128]), 200)).toEqual({ h: 200, s: 0, v: 128 / 255 });
		expect(rgbToHsv([0, 0, 0], 75)).toEqual({ h: 75, s: 0, v: 0 });
		expect(rgbToHsv([1, 1, 1], 310)).toEqual({ h: 310, s: 0, v: 1 });
		// A colour with a saturation reads its own hue, whatever is given.
		expect(rgbToHsv([1, 0, 0], 200).h).toBe(0);
		for (const h of [0, 45, 200, 359]) expect(bytes(hsvToRgb({ h, s: 0, v: 0.5 }))).toEqual([128, 128, 128]);
		for (const h of [0, 45, 200, 359]) expect(hsvToRgb({ h, s: 1, v: 0 })).toEqual([0, 0, 0]);
	});
});

describe('rgbToHsl and hslToRgb', () => {
	const bytes = (rgb: readonly number[]) => rgb.map((c) => Math.round(c * 255));

	it('reads each sector\'s boundary colour as its hue at full saturation and half lightness, and back, a hue past a turn either way the same', () => {
		const boundaries: [number, [number, number, number]][] = [[0, [1, 0, 0]], [60, [1, 1, 0]], [120, [0, 1, 0]], [180, [0, 1, 1]], [240, [0, 0, 1]], [300, [1, 0, 1]]];
		for (const [h, rgb] of boundaries) {
			expect(rgbToHsl(rgb)).toEqual({ h, s: 1, l: 0.5 });
			expect(hslToRgb({ h, s: 1, l: 0.5 })).toEqual(rgb);
		}
		expect(hslToRgb({ h: 120, s: 1, l: 0.25 })).toEqual([0, 0.5, 0]);
		expect(hslToRgb({ h: -240, s: 1, l: 0.5 })).toEqual([0, 1, 0]);
		expect(hslToRgb({ h: 480, s: 1, l: 0.5 })).toEqual([0, 1, 0]);
	});

	it('round-trips a grid of colours within a byte, the hue from 0 to under 360, the saturation never past 1 and the lightness the mean of the largest and smallest channels', () => {
		for (let r = 0; r <= 8; r++) {
			for (let g = 0; g <= 8; g++) {
				for (let b = 0; b <= 8; b++) {
					const rgb: [number, number, number] = [r / 8, g / 8, b / 8];
					const hsl = rgbToHsl(rgb);
					expect(hsl.h).toBeGreaterThanOrEqual(0);
					expect(hsl.h).toBeLessThan(360);
					expect(hsl.s).toBeLessThanOrEqual(1);
					expect(hsl.l).toBeCloseTo((Math.max(r, g, b) + Math.min(r, g, b)) / 16, 12);
					const back = bytes(hslToRgb(hsl));
					bytes(rgb).forEach((byte, i) => expect(Math.abs(back[i] - byte)).toBeLessThanOrEqual(1));
				}
			}
		}
		// A channel at 0 beside one at a share of 255 divides to a hair past 1, which is held.
		expect(rgbToHsl([114 / 255, 0, 0]).s).toBe(1);
	});

	it('holds the hue given at zero saturation, black and white among the greys, and gives a grey at any hue with none', () => {
		expect(rgbToHsl([0.5, 0.5, 0.5], 77)).toEqual({ h: 77, s: 0, l: 0.5 });
		expect(rgbToHsl([1, 1, 1], 77)).toEqual({ h: 77, s: 0, l: 1 });
		expect(rgbToHsl([0, 0, 0], 77)).toEqual({ h: 77, s: 0, l: 0 });
		expect(rgbToHsl([0.3, 0.3, 0.3])).toEqual({ h: 0, s: 0, l: 0.3 });
		expect(hslToRgb({ h: 200, s: 0, l: 0.3 })).toEqual([0.3, 0.3, 0.3]);
	});
});

describe('hsvToHsl and hslToHsv', () => {
	it('convert hsv to hsl and back within nine decimal places, over every hundredth of saturation and every non-zero hundredth of value, and agree within nine with rgbToHsl\'s reading of hsvToRgb\'s unrounded output', () => {
		for (let s = 0; s <= 100; s++) {
			for (let v = 1; v <= 100; v++) {
				const hsv = { h: 200, s: s / 100, v: v / 100 };
				const hsl = hsvToHsl(hsv);
				expect(hsl.s).toBeLessThanOrEqual(1);
				const read = rgbToHsl(hsvToRgb(hsv), 200);
				expect(hsl.h).toBe(200);
				expect(hsl.s).toBeCloseTo(read.s, 9);
				expect(hsl.l).toBeCloseTo(read.l, 9);
				const back = hslToHsv(hsl);
				expect(back.s).toBeLessThanOrEqual(1);
				if (hsl.l < 1) expect(back.s).toBeCloseTo(hsv.s, 9);
				expect(back.v).toBeCloseTo(hsv.v, 9);
			}
		}
		expect(hsvToHsl({ h: 30, s: 1, v: 1 })).toEqual({ h: 30, s: 1, l: 0.5 });
		expect(hslToHsv({ h: 30, s: 1, l: 0.5 })).toEqual({ h: 30, s: 1, v: 1 });
	});

	it('return the saturation given where the colour names none, black and white for the lightness and black for the value, and 0 where none is given', () => {
		expect(hsvToHsl({ h: 10, s: 0.7, v: 0 }, 0.4)).toEqual({ h: 10, s: 0.4, l: 0 });
		expect(hsvToHsl({ h: 10, s: 0, v: 1 }, 0.4)).toEqual({ h: 10, s: 0.4, l: 1 });
		expect(hsvToHsl({ h: 10, s: 0, v: 1 })).toEqual({ h: 10, s: 0, l: 1 });
		expect(hslToHsv({ h: 10, s: 0.7, l: 0 }, 0.4)).toEqual({ h: 10, s: 0.4, v: 0 });
		expect(hslToHsv({ h: 10, s: 0.7, l: 0 })).toEqual({ h: 10, s: 0, v: 0 });
		expect(hslToHsv({ h: 10, s: 0.7, l: 1 }, 0.4)).toEqual({ h: 10, s: 0, v: 1 });
	});
});

describe('the colour spaces', () => {
	it('run RGB, HSV and HSL, each channel from 0 to its bytes, its degrees or its percent', () => {
		expect(COLOUR_SPACES).toEqual(['RGB', 'HSV', 'HSL']);
		expect(CHANNELS).toEqual({ RGB: [255, 255, 255], HSV: [360, 100, 100], HSL: [360, 100, 100] });
	});

	it('read a typed channel as the nearest whole number held to its range, and nothing from text that is no decimal number', () => {
		expect(readChannel('128', 255)).toBe(128);
		expect(readChannel(' 300 ', 255)).toBe(255);
		expect(readChannel('-5', 100)).toBe(0);
		expect(readChannel('12.6', 100)).toBe(13);
		expect(readChannel('.5', 100)).toBe(1);
		expect(readChannel('+7', 360)).toBe(7);
		for (const text of ['', ' ', 'abc', '1e2', '0x10', '12a', '#ff']) expect(readChannel(text, 255)).toBeNull();
	});
});
