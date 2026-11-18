/**
 * @fileoverview The standard colours offered by name, whether a colour reads
 * as light (dark words written on it) or dark, the checkerboard a colour with
 * alpha is shown over, and a vertical bar: a gradient through a list of
 * colours with a line across it at a value.
 *
 * A colour's hue, saturation and value read from its red, green and blue and
 * back, its hue, saturation and lightness likewise, and each of the two read
 * from the other exactly, the channels in 0..1 and the hue in degrees; the
 * colour spaces a picker's fields and bars read a colour in, the most each
 * channel of a space reaches, and a channel typed as text read as a whole
 * number held to its range.
 *
 * Pure: the painters draw into the context they are given, in its own pixels,
 * at the box given, and hold nothing. A size in logical pixels is scaled by
 * the pixels per logical pixel the caller passes.
 */

/** A rectangle in the context's own pixels. */
export interface ColourBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** A standard colour: its name, its red, green and blue bytes, and the same as `#rrggbb`. */
export interface Swatch {
	name: string;
	rgb: [number, number, number];
	hex: string;
}

/** The fourteen standard colours, in the order they are offered: black and three greys, darkest first, nine colours in alphabetical order, then white. */
export const SWATCHES: readonly Swatch[] = [
	{ name: 'Black', rgb: [0, 0, 0], hex: '#000000' },
	{ name: 'Dark', rgb: [63, 63, 63], hex: '#3f3f3f' },
	{ name: 'Grey', rgb: [127, 127, 127], hex: '#7f7f7f' },
	{ name: 'Light', rgb: [191, 191, 191], hex: '#bfbfbf' },
	{ name: 'Blue', rgb: [14, 60, 245], hex: '#0e3cf5' },
	{ name: 'Brown', rgb: [163, 123, 75], hex: '#a37b4b' },
	{ name: 'Cyan', rgb: [115, 249, 253], hex: '#73f9fd' },
	{ name: 'Green', rgb: [114, 243, 74], hex: '#72f34a' },
	{ name: 'Magenta', rgb: [235, 87, 247], hex: '#eb57f7' },
	{ name: 'Orange', rgb: [240, 151, 55], hex: '#f09737' },
	{ name: 'Purple', rgb: [135, 46, 141], hex: '#872e8d' },
	{ name: 'Red', rgb: [234, 64, 37], hex: '#ea4025' },
	{ name: 'Yellow', rgb: [255, 250, 83], hex: '#fffa53' },
	{ name: 'White', rgb: [255, 255, 255], hex: '#ffffff' },
];

/** The sum of a colour's three bytes above which it reads as light. */
export const LIGHT_SWATCH = 381;

/** Whether a colour reads as light, so words on it are written in black rather than white. */
export const isLightSwatch = (rgb: ArrayLike<number>): boolean => rgb[0] + rgb[1] + rgb[2] > LIGHT_SWATCH;

/**
 * Fills the box with a checkerboard of 8 logical pixel cells, dark grey with
 * light grey cells, the first column starting light at its top and each next
 * column offset by a cell, clipped to the box.
 */
export const paintChecker = (ctx: CanvasRenderingContext2D, box: ColourBox, ratio: number): void => {
	ctx.save();
	ctx.beginPath();
	ctx.rect(box.x, box.y, box.w, box.h);
	ctx.clip();
	const blockSize = 8 * ratio;
	const blockSize2 = blockSize * 2;
	ctx.fillStyle = "rgb(91,91,91)";
	ctx.fillRect(box.x, box.y, box.w, box.h);
	ctx.fillStyle = "rgb(142,142,142)";
	let alt = 0;
	for (let x = 0; x < box.w; x += blockSize) {
		for (let y = (alt % 2 === 0 ? 0 : blockSize); y < box.h; y += blockSize2) {
			ctx.fillRect(box.x + x, box.y + y, blockSize, blockSize);
		}
		alt++;
	}
	ctx.restore();
};

/** A colour as CSS: `rgb(r,g,b)` for three entries, `rgba(r,g,b,a)` for four. */
const cssOf = (colour: readonly number[]): string => (colour.length === 3 ? 'rgb' : 'rgba') + '(' + colour.join(",") + ')';

/**
 * Paints a vertical bar into the box: the checkerboard first where asked, then
 * a gradient from the first stop at the top to the last at the foot, two or
 * more stops evenly spaced, and a line across at the value (1 at the top, 0 at
 * the foot), 3 logical pixels of white with 1 of black at its centre, centred
 * on a pixel row. The line is not clipped to the box, and the value is not
 * held to 0..1: near 1 or 0 the line reaches up to half its width past the
 * box's top or foot.
 */
export const paintBar = (ctx: CanvasRenderingContext2D, box: ColourBox, ratio: number, stops: readonly (readonly number[])[], value: number, checker?: boolean): void => {
	paintBarFill(ctx, box, ratio, stops, checker);
	paintBarLine(ctx, box, ratio, value);
};

/** Paints a bar's checkerboard, where asked, and its gradient, as `paintBar` does, without its line. */
export const paintBarFill = (ctx: CanvasRenderingContext2D, box: ColourBox, ratio: number, stops: readonly (readonly number[])[], checker?: boolean): void => {
	if (checker) paintChecker(ctx, box, ratio);

	const grd = ctx.createLinearGradient(box.x, box.y, box.x, box.y + box.h);
	const last = stops.length - 1;
	stops.forEach((stop, i) => grd.addColorStop(i / last, cssOf(stop)));
	ctx.fillStyle = grd;
	ctx.fillRect(box.x, box.y, box.w, box.h);
};

/** Paints a bar's line at the value, as `paintBar` does, unclipped. */
export const paintBarLine = (ctx: CanvasRenderingContext2D, box: ColourBox, ratio: number, value: number): void => {
	const barInnerWidth = 1 * ratio;
	const barWidth = 3 * ratio;

	const loc = box.y + Math.floor((1.0 - value) * (box.h - 1)) + 0.5;
	ctx.fillStyle = 'rgb(255,255,255)';
	ctx.fillRect(box.x, loc - barWidth / 2, box.w, barWidth);

	ctx.fillStyle = 'rgb(0,0,0)';
	ctx.fillRect(box.x, loc - barInnerWidth / 2, box.w, barInnerWidth);
};

/** A colour's hue in degrees, 0 to 360, and its saturation and value, 0..1. */
export interface Hsv {
	h: number;
	s: number;
	v: number;
}

/**
 * A colour's hue, saturation and value from its red, green and blue in 0..1:
 * the value the largest channel, the saturation the spread over the value, 0
 * where the value is 0, and the hue the sector of the largest channel moved
 * by the other two, 0 to 360. A colour of no saturation names no hue,
 * so the hue given is returned for it.
 *
 * @param rgb - The red, green and blue, each 0..1
 * @param hue - The hue returned where the saturation is 0
 */
export const rgbToHsv = (rgb: readonly [number, number, number], hue = 0): Hsv => {
	const [r, g, b] = rgb;
	const v = Math.max(r, g, b);
	const spread = v - Math.min(r, g, b);
	const s = v > 0 ? spread / v : 0;
	if (spread === 0) return { h: hue, s, v };
	let h: number;
	if (v === r) h = (g - b) / spread;
	else if (v === g) h = (b - r) / spread + 2;
	else h = (r - g) / spread + 4;
	h *= 60;
	if (h < 0) h += 360;
	return { h, s, v };
};

/**
 * A colour's red, green and blue in 0..1 from its hue in degrees, any number
 * of turns either way, and its saturation and value in 0..1.
 */
export const hsvToRgb = ({ h, s, v }: Hsv): [number, number, number] => {
	const sector = ((h % 360) + 360) % 360 / 60;
	const at = (n: number): number => {
		const k = (n + sector) % 6;
		return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
	};
	return [at(5), at(3), at(1)];
};

/** A colour's hue in degrees, 0 to 360, and its saturation and lightness, 0..1. */
export interface Hsl {
	h: number;
	s: number;
	l: number;
}

/**
 * A colour's hue, saturation and lightness from its red, green and blue in
 * 0..1: the lightness the mean of the largest and smallest channels, the
 * saturation the spread over the room the lightness leaves, held to 1 where
 * the division passes it and 0 where the lightness leaves no room, and the
 * hue as `rgbToHsv` reads it, the hue given returned for a colour of no
 * saturation.
 *
 * @param rgb - The red, green and blue, each 0..1
 * @param hue - The hue returned where the saturation is 0
 */
export const rgbToHsl = (rgb: readonly [number, number, number], hue = 0): Hsl => {
	const [r, g, b] = rgb;
	const most = Math.max(r, g, b);
	const least = Math.min(r, g, b);
	const l = (most + least) / 2;
	const room = 1 - Math.abs(2 * l - 1);
	return { h: rgbToHsv(rgb, hue).h, s: room > 0 ? Math.min(1, (most - least) / room) : 0, l };
};

/**
 * A colour's red, green and blue in 0..1 from its hue in degrees, any number
 * of turns either way, and its saturation and lightness in 0..1.
 */
export const hslToRgb = ({ h, s, l }: Hsl): [number, number, number] => {
	const turn = ((h % 360) + 360) % 360 / 30;
	const reach = s * Math.min(l, 1 - l);
	const at = (n: number): number => {
		const k = (n + turn) % 12;
		return l - reach * Math.max(-1, Math.min(k - 3, 9 - k, 1));
	};
	return [at(0), at(8), at(4)];
};

/**
 * A colour's hue, saturation and lightness from its hue, saturation and
 * value, exactly: the lightness the value less half its saturated share,
 * the saturation the value's reach over the lightness over the room the
 * lightness leaves, held to 1. Black and white leave no room and name no
 * saturation, so the one given is returned there.
 *
 * @param hsv - The hue, saturation and value
 * @param saturation - The saturation returned for black and white
 */
export const hsvToHsl = ({ h, s, v }: Hsv, saturation = 0): Hsl => {
	const l = v * (1 - s / 2);
	const room = Math.min(l, 1 - l);
	return { h, s: room > 0 ? Math.min(1, (v - l) / room) : saturation, l };
};

/**
 * A colour's hue, saturation and value from its hue, saturation and
 * lightness, exactly: the value the lightness plus the saturation's share
 * of the room the lightness leaves, the saturation twice the value's share
 * above the lightness, held to 1. Black names no saturation, so the one
 * given is returned there.
 *
 * @param hsl - The hue, saturation and lightness
 * @param saturation - The saturation returned for black
 */
export const hslToHsv = ({ h, s, l }: Hsl, saturation = 0): Hsv => {
	const v = l + s * Math.min(l, 1 - l);
	return { h, s: v > 0 ? Math.min(1, 2 * (1 - l / v)) : saturation, v };
};

/** The colour spaces a picker's channel fields and bars read a colour in, in the order its space word cycles through them. */
export const COLOUR_SPACES = ['RGB', 'HSV', 'HSL'] as const;

export type ColourSpace = (typeof COLOUR_SPACES)[number];

/** The most each channel of a space reaches, from 0: the bytes in RGB; the hue in degrees, then the saturation and the value or the lightness in percent. */
export const CHANNELS: Readonly<Record<ColourSpace, readonly [number, number, number]>> = { RGB: [255, 255, 255], HSV: [360, 100, 100], HSL: [360, 100, 100] };

/** A channel typed as text: a decimal number read as the nearest whole number held to 0..most; null for text that reads as none. */
export const readChannel = (text: string, most: number): number | null => {
	const trimmed = text.trim();
	if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
	return Math.max(0, Math.min(most, Math.round(Number(trimmed))));
};
