/**
 * @fileoverview What a colour widget and its picker are laid out by: the
 * box, the font and its monospaced version, a widget's resolved style and its
 * state, a widget laid out, the measures a widget is drawn by, a field's
 * insets, the popover's edge, and `layoutWell`, which lays a colour widget
 * out on its own.
 *
 * Pure: a function of the widget, its state, a text measure and the point
 * its box stands at.
 */

import type { Colour, ColourWidget, WidgetStyle } from './options.ts';

/** A box in the pixels it is laid out in, a host's or a popover's own, from their top-left corner. */
export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** A font as words are measured and painted in it. */
export interface Font {
	size: number;
	weight: number;
	family: string;
	style: 'normal' | 'italic';
}

/** How wide a run of words is in a font, in pixels. */
export type TextMeasure = (text: string, font: Font) => number;

export type TextAlignWord = 'LEFT' | 'CENTER' | 'RIGHT';

/** The font a widget's words are set in where its style says nothing; all but its picker's tab names and colour names are in its monospaced version (`monoFont`). */
export const DEFAULT_FONT: Font = { size: 16, weight: 400, family: 'Roboto', style: 'normal' };

/** The monospaced family every word of a colour widget is set in but its picker's tab names and colour names, so a hex, a channel's number and a percentage keep their columns as they change. */
export const MONO_FAMILY = 'Roboto Mono';

/** A font in the monospaced family (`MONO_FAMILY`), its size, weight and style kept. */
export const monoFont = (font: Font): Font => ({ ...font, family: MONO_FAMILY });

/** The colour of a widget's words where its style says nothing. */
export const DEFAULT_TEXT_COLOUR: Colour = { r: 0x1b / 255, g: 0x1f / 255, b: 0x24 / 255, a: 1 };

/** The colour a widget's title, its focus ring and its picker's marks are drawn in where its style says nothing. */
export const DEFAULT_ACCENT: Colour = { r: 0x2f / 255, g: 0x6f / 255, b: 0xd6 / 255, a: 1 };

/** The colour of a field's line where its style gives a width and no colour. */
const DEFAULT_BORDER_COLOUR: Colour = { r: 0, g: 0, b: 0, a: 0.25 };

/** The measures a colour widget is drawn by, in pixels: the same on every host. */
export const CONTROL = {
	/** How tall a widget is at least where nothing fixes its height, its line and the room inside it counted. */
	height: 38,
	/** The room a field keeps between its line and its words, across and down, where its style gives no padding. */
	padX: 10,
	padY: 8,
	/** How round a field's corners are. */
	radius: 6,
	/** How thick the line round a field is. */
	border: 1,
	/** The space from one line of a widget's words to the next, as a multiple of the font size. */
	lineHeight: 1.25,
	/** The room between a colour's swatch and its words. */
	gap: 8,
	/** The side of a colour's swatch, at `MEASURED_AT`; it scales with the widget's font (`iconOf`). */
	icon: 24,
	/** How round the corners of a colour's swatch are drawn. */
	iconRadius: 4,
	/** How wide a field is where nothing sizes it. */
	fieldWidth: 200,
	/** A widget's title: its size against the widget's words, and the room under it. */
	titleScale: 0.75,
	titleGap: 4,
} as const;

/** The font size `CONTROL.icon` is given at: a widget's own font scales it, so the swatch keeps its size against the words beside it. */
export const MEASURED_AT = 16;

/** The side of a colour's swatch, in a widget of the font. */
export const iconOf = (font: Font): number => CONTROL.icon * font.size / MEASURED_AT;

/** A widget's style as it is laid out and painted: every key given, the widget's own where its style has it, else the widget's default. */
export interface ResolvedStyle {
	color: Colour;
	accent: Colour;
	background: Colour | null;
	font: Font;
	padding: number;
	borderWidth: number;
	borderColor: Colour;
	borderRadius: number;
	opacity: number;
	/** A width or a height the style fixes; null leaves it to the widget's contents. */
	width: number | null;
	height: number | null;
	/** The keys the widget's own style gives: where one names a field's line, room or corners, they are the style's rather than the field's own. */
	own: WidgetStyle;
}

/** What a colour widget is in beyond its options, which its layout carries and its painter and picker read. */
export interface WidgetState {
	/** Its colour as it stands, as `formatColour` writes one. */
	text: string;
	disabled: boolean;
	hovered: boolean;
	focused: boolean;
	/** Whether its picker is open. */
	open: boolean;
	/** Its swatches as a script set them, held over its options'; null takes its options'. */
	swatches: string[] | null;
}

/** A colour widget laid out: where it stands and what it is drawn from. */
export interface Laid {
	widget: ColourWidget;
	/** Its box: its title, where it has one, and its face below. */
	box: Box;
	/** Where its field is drawn: its box below its title, the whole box where it has none. */
	face: Box;
	/** The box its words stand in: inside the face's line and room. */
	inner: Box;
	/** Its title's box, where it has one: across the top of its box, over its face. */
	title: Box | null;
	/** The square its colour is shown in, left of its words; a well's whole inner box. */
	swatch: Box;
	style: ResolvedStyle;
	state: WidgetState;
}

/** What a colour widget starts in: its options, read into state. */
export const restingState = (widget: ColourWidget): WidgetState => ({
	text: widget.value,
	disabled: widget.disabled === true,
	hovered: false,
	focused: false,
	open: false,
	swatches: null,
});

/** The style a colour widget is laid out and painted with: its own keys, and the widget's defaults for the rest. */
export const resolveStyle = (widget: ColourWidget): ResolvedStyle => {
	const style: WidgetStyle = widget.style ?? {};
	return {
		color: style.color ?? DEFAULT_TEXT_COLOUR,
		accent: style.accent ?? DEFAULT_ACCENT,
		background: style.background ?? null,
		font: {
			size: style.fontSize ?? DEFAULT_FONT.size,
			weight: style.fontWeight ?? DEFAULT_FONT.weight,
			family: style.fontFamily ?? DEFAULT_FONT.family,
			style: style.fontStyle ?? DEFAULT_FONT.style,
		},
		padding: style.padding ?? 0,
		borderWidth: style.borderWidth ?? 0,
		borderColor: style.borderColor ?? DEFAULT_BORDER_COLOUR,
		borderRadius: style.borderRadius ?? 0,
		opacity: style.opacity ?? 1,
		width: style.width ?? null,
		height: style.height ?? null,
		own: style,
	};
};

/** The font a widget's title is drawn in: the widget's own, smaller. */
export const titleFont = (font: Font): Font => ({ ...font, size: font.size * CONTROL.titleScale });

/** How tall a line of words is in a font at a line height. */
const lineOf = (font: Font, lineHeight: number): number => font.size * lineHeight;

/** How far a widget's words stand inside its face, side by side. */
interface Insets {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/**
 * How far a colour widget's words stand inside its face: the field's line and
 * room, its style's border width standing for the line and its padding for
 * the room where its style gives them ({@link ResolvedStyle.own}); and, where
 * it shows its hex, its swatch's square left of its words, the gap between.
 * A well keeps none.
 */
const insetsOf = (widget: ColourWidget, style: ResolvedStyle): Insets => {
	const { own } = style;
	const line = typeof own.borderWidth === 'number' ? style.borderWidth : CONTROL.border;
	const padded = typeof own.padding === 'number';
	const across = line + (padded ? style.padding : CONTROL.padX);
	const down = line + (padded ? style.padding : CONTROL.padY);
	// A colour keeps room left of its hex for its swatch; a well, its hex not shown, keeps none, its colour filling the field.
	const swatch = widget.showValue !== false ? iconOf(style.font) + CONTROL.gap : 0;
	return { left: across + swatch, right: across, top: down, bottom: down };
};

/** Holds a measure under a limit, where there is one. */
const under = (value: number, limit: number | null): number => (limit === null ? value : Math.min(value, limit));

/** Whether a point lies in a box: on or past its left and top edges, short of its right and bottom. */
export const inBox = (box: Box, x: number, y: number): boolean =>
	x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;

/** The room a picker keeps from the host's top or bottom edge, where there is the room: it opens above its colour only where the room below, less this, is short of it and there is more room above. */
export const POPOVER_MARGIN = 8;

/** How thick the ring round what has the focus is. */
export const FOCUS_RING = 2;

/**
 * How far in from a popover's edge the line round it and the focus ring over
 * it reach: its widget's own line where the widget's style gives one, 0
 * among them, else the field's, or the ring where that is wider.
 * paint.ts's `popoverFace` edges a popover to it.
 *
 * @param control - The widget the popover opens from: the style it is drawn with, which holds what its own style gives
 */
export const popoverEdge = (control: Pick<Laid, 'style'>): number =>
	Math.max(typeof control.style.own.borderWidth === 'number' ? control.style.borderWidth : CONTROL.border, FOCUS_RING);

/**
 * Lays a colour widget out on its own, its box's top-left corner at a point,
 * nothing around it sizing, filling or bounding it: its title's line across
 * the top of its box where it has a title, its face below, a field the
 * field's own width, at least as wide as its title, its words' line as tall
 * as its swatch's square where that is the taller, no shorter than the
 * widget's least height, a width or a height its style fixes taken whole;
 * its swatch's square left of its hex, the gap between, or a well's swatch
 * its whole inner box. Its words are its hex, on one line.
 *
 * @param widget - The colour widget
 * @param state - What it is in now
 * @param measure - How wide a run of words is in a font
 * @param at - Where its box's top-left corner stands
 */
export const layoutWell = (widget: ColourWidget, state: WidgetState, measure: TextMeasure, at: { x: number; y: number } = { x: 0, y: 0 }): Laid => {
	const style = resolveStyle(widget);
	const insets = insetsOf(widget, style);
	const insetW = insets.left + insets.right;
	const insetH = insets.top + insets.bottom;
	const titled = !!widget.title;
	const titleHeight = titled ? lineOf(titleFont(style.font), CONTROL.lineHeight) + CONTROL.titleGap : 0;
	// A widget is at least as wide as its title line, unless something fixes its
	// width; the title is measured in the monospaced family it is painted in.
	const titleWidth = titled ? measure(widget.title!, monoFont(titleFont(style.font))) : 0;
	const fixedW = style.width;
	const fixedH = style.height;
	const boundW = fixedW !== null ? fixedW - insetW : null;
	// A field the field's own width, its words' line as tall as its swatch's
	// square where that is the taller.
	const contentW = under(Math.max(0, CONTROL.fieldWidth - insetW), boundW);
	const contentH = Math.max(lineOf(style.font, CONTROL.lineHeight), iconOf(style.font));
	const w = fixedW ?? Math.max(contentW + insetW, titleWidth);
	// A field nothing fixes the height of is no shorter than the widget's
	// least height, its line and its room counted in it.
	const h = fixedH ?? Math.max(contentH + insetH, CONTROL.height) + titleHeight;
	const inner: Box = { x: at.x + insets.left, y: at.y + titleHeight + insets.top, w: Math.max(0, w - insetW), h: Math.max(0, h - titleHeight - insetH) };
	// In the room the colour keeps left of its words, its swatch's square; a well's swatch is its whole inner box.
	const swatch: Box = widget.showValue === false
		? { ...inner }
		: { x: inner.x - CONTROL.gap - iconOf(style.font), y: inner.y + (inner.h - iconOf(style.font)) / 2, w: iconOf(style.font), h: iconOf(style.font) };
	return {
		widget,
		box: { x: at.x, y: at.y, w, h },
		face: { x: at.x, y: at.y + titleHeight, w, h: h - titleHeight },
		inner,
		title: titleHeight > 0 ? { x: at.x, y: at.y, w, h: titleHeight - CONTROL.titleGap } : null,
		swatch,
		style,
		state,
	};
};
