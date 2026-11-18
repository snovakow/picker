/**
 * @fileoverview A colour widget as data: the options a page or a host makes
 * one from (`ColourOptions`), the widget they are read into (`ColourWidget`,
 * `readColourOptions`), the picker's modes, the events a widget tells, a
 * colour's channels as a canvas takes them, and a colour's swatches.
 *
 * Pure: it touches no page and no canvas.
 */

import { formatColour, parseColour } from './hex.ts';

/** A colour's channels, each 0..1. */
export interface Colour {
	r: number;
	g: number;
	b: number;
	a: number;
}

/** The modes a picker shows a colour in: the colour wheel and triangle, a saturation and value square, the channel bars, or the standard colours by name. */
export const PICKER_MODES = ['wheel', 'square', 'sliders', 'names'] as const;

export type PickerMode = (typeof PICKER_MODES)[number];

/**
 * What a colour widget tells as the viewer uses it:
 *
 * - `click` — the widget clicked, which opens its picker or shuts it
 * - `change` — a colour taken, which changed its value
 * - `enter` and `leave` — the pointer come onto the widget or its picker, and gone off them
 */
export type WidgetEvent = 'click' | 'change' | 'enter' | 'leave';

/**
 * How a colour widget is drawn: lengths in pixels, colours as hex (`#rgb`,
 * `#rgba`, `#rrggbb` or `#rrggbbaa`). A key left out, or one whose value does
 * not read, takes the widget's own look.
 */
export interface ColourStyle {
	/** How wide and how tall the widget is, its title counted; left out, a field's own width, or its title's where that is wider, and the height its words or its swatch need, whichever is taller, no less than a field's least height. */
	width?: number;
	height?: number;
	/** The room between the field's line and its words; left out, the field's own. */
	padding?: number;
	/** The words' size, weight (100 to 900) and slant. */
	fontSize?: number;
	fontWeight?: number;
	fontStyle?: 'normal' | 'italic';
	/** The face the picker's tab names and colour names are set in; every other word is in the monospaced face. */
	fontFamily?: string;
	/** The colour of the words, of the field's face, and of the title, the ring round the widget while it has the focus and the picker's marks. */
	color?: string;
	background?: string;
	accent?: string;
	/** The line round the field: how thick it is (0 draws none) and its colour; and how round the field's corners are. Left out, the field's own. */
	borderWidth?: number;
	borderColor?: string;
	borderRadius?: number;
	/** How solid the widget is drawn, 0 to 1. */
	opacity?: number;
}

/** What a colour widget is made from, as a page or a host gives it. */
export interface ColourOptions {
	/** The colour it starts on, as hex; black where it does not read. */
	value?: string;
	/** Whether the colour carries an alpha: the picker offers an alpha bar and field, and the value may be `#rrggbbaa`. Without it the alpha is 1, and dropped from every colour read or written. */
	alpha?: boolean;
	/** The mode the picker opens in until the viewer chooses one on a picker's tabs, which every picker then opens in; the wheel where it is left out. */
	mode?: PickerMode;
	/** The widget's own swatches, as hex, offered under the picker's fields; no more than `SWATCHES_MAX` are kept, and one that does not read is left out. */
	swatches?: readonly string[];
	/** A title, drawn above the widget in the accent colour. */
	title?: string;
	/** Whether the hex is written beside the swatch, which it is unless this is false: the colour then fills the field, as a well. */
	showValue?: boolean;
	/** Whether the widget starts unable to be used. */
	disabled?: boolean;
	style?: ColourStyle;
}

/** A colour widget's style as its options are read: each colour read into its channels, each length 0 or more, the weight held to 100..900 and the opacity to 0..1. */
export interface WidgetStyle {
	width?: number;
	height?: number;
	padding?: number;
	fontSize?: number;
	fontWeight?: number;
	fontStyle?: 'normal' | 'italic';
	fontFamily?: string;
	color?: Colour;
	background?: Colour;
	accent?: Colour;
	borderWidth?: number;
	borderColor?: Colour;
	borderRadius?: number;
	opacity?: number;
}

/**
 * A colour widget as its options are read (`readColourOptions`): its value
 * and swatches held as `formatColour` writes a colour, so each reads back in
 * that one spelling, the alpha dropped where the colour carries none; a key
 * the options leave out, or give a value that does not read, absent.
 */
export interface ColourWidget {
	value: string;
	alpha?: boolean;
	mode?: PickerMode;
	swatches?: string[];
	title?: string;
	showValue?: boolean;
	disabled?: boolean;
	style?: WidgetStyle;
}

/** The longest family name a style is read with. */
const FAMILY_MAX = 200;

/** The most swatches of its own a colour widget is read with. */
export const SWATCHES_MAX = 28;

/**
 * A colour widget's swatches, each held as `formatColour` writes a colour,
 * its alpha dropped where the colour carries none; what does not read as a
 * colour is left out, and no more than {@link SWATCHES_MAX} are kept.
 */
export const swatchesOf = (values: readonly unknown[], alpha: boolean): string[] => {
	const held: string[] = [];
	for (const value of values) {
		const colour = typeof value === 'string' ? parseColour(value) : null;
		if (colour) held.push(formatColour(alpha ? colour : { r: colour.r, g: colour.g, b: colour.b }));
		if (held.length === SWATCHES_MAX) break;
	}
	return held;
};

/** A colour as a canvas takes it. */
export const cssColour = (colour: Colour): string =>
	`rgba(${Math.round(colour.r * 255)},${Math.round(colour.g * 255)},${Math.round(colour.b * 255)},${colour.a})`;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The style's keys by what their values mean: a length, 0 or more; a colour, as hex. */
const LENGTH_KEYS = ['width', 'height', 'padding', 'fontSize', 'borderWidth', 'borderRadius'] as const;
const COLOUR_KEYS = ['color', 'background', 'accent', 'borderColor'] as const;

/** A widget's style read from its options: each key whose value reads as the key means, the rest left out; undefined where none reads. */
const readStyle = (style: unknown): WidgetStyle | undefined => {
	if (!style || typeof style !== 'object') return undefined;
	const source = style as Record<string, unknown>;
	const read: WidgetStyle = {};
	for (const key of LENGTH_KEYS) {
		const value = source[key];
		if (isFiniteNumber(value) && value >= 0) read[key] = value;
	}
	for (const key of COLOUR_KEYS) {
		const value = source[key];
		const colour = typeof value === 'string' ? parseColour(value) : null;
		if (colour) read[key] = colour;
	}
	if (isFiniteNumber(source.fontWeight)) read.fontWeight = Math.max(100, Math.min(900, source.fontWeight));
	if (isFiniteNumber(source.opacity)) read.opacity = Math.max(0, Math.min(1, source.opacity));
	if (source.fontStyle === 'normal' || source.fontStyle === 'italic') read.fontStyle = source.fontStyle;
	if (typeof source.fontFamily === 'string' && source.fontFamily.trim()) read.fontFamily = source.fontFamily.trim().slice(0, FAMILY_MAX);
	return Object.keys(read).length > 0 ? read : undefined;
};

/**
 * A colour widget read from its options: its value and swatches held as
 * `formatColour` writes a colour, the alpha dropped where the colour carries
 * none, black where the value does not read, a mode outside `PICKER_MODES`
 * left out, and its style read key by key. Whatever the options hold, a
 * page's script calling without types among them, the widget reads.
 *
 * @param options - What the widget is made from
 */
export const readColourOptions = (options: ColourOptions = {}): ColourWidget => {
	const source = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>;
	const alpha = source.alpha === true;
	const colour = typeof source.value === 'string' ? parseColour(source.value) : null;
	const widget: ColourWidget = { value: colour ? formatColour(alpha ? colour : { r: colour.r, g: colour.g, b: colour.b }) : '#000000' };
	if (alpha) widget.alpha = true;
	if ((PICKER_MODES as readonly unknown[]).includes(source.mode)) widget.mode = source.mode as PickerMode;
	const swatches = swatchesOf(Array.isArray(source.swatches) ? source.swatches : [], alpha);
	if (swatches.length > 0) widget.swatches = swatches;
	if (typeof source.title === 'string' && source.title) widget.title = source.title;
	if (source.showValue === false) widget.showValue = false;
	if (source.disabled === true) widget.disabled = true;
	const style = readStyle(source.style);
	if (style) widget.style = style;
	return widget;
};
