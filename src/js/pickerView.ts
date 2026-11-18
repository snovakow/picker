/**
 * @fileoverview A colour widget's picker, as its host shows it in a popover:
 * its layout from the widget's face, the mode shown and the host's size, the
 * region a point of it lies on, what a press or a click on a region sets, and
 * its painting into the popover's context.
 *
 * The picker is a frame `PICKER.width` wide, whatever the face's width,
 * holding a row of tabs, one for each mode, with a close at its right end,
 * over a hairline, the mode's area, a preview of the colour the picker
 * opened on beside the colour now, the hex field and the eyedropper at the
 * row's right end, the colour space's word with its three channel fields and
 * an alpha field where the widget carries an alpha, and the colour's own
 * swatches, a script's where it set them, else its options', in rows under
 * them. The wheel mode stands the colour wheel and triangle (wheel.ts) in a
 * square centred in the area or, with alpha, in the room left of a bar at
 * the area's right; the square mode a saturation and value square at the
 * hue, with a hue strip at its right and, with alpha, the alpha bar at the
 * area's right; the sliders mode a bar for each of the space's three
 * channels, red, green and blue in RGB, and the alpha with alpha, side by
 * side across the area; the names mode the standard colours (colour.ts) in
 * two columns of cells from the area's top, with each colour's name written
 * on it, and with alpha the alpha bar at the area's right, the columns in
 * the room left of it. The hex field writes the colour as the widget holds
 * it; the space word names the colour space the three channel fields and, in
 * sliders, the bars read the colour in, `RGB`, `HSV` or `HSL`
 * (`COLOUR_SPACES`), cycled by a click on the word; the alpha field is in
 * percent. The picker hands the page's input to one field at a time
 * (colourPicker.ts), which is painted as its box alone while it has it. Its
 * tab names and colour names are set in the widget's font and its other
 * words in its monospaced version (`pickerMono`), no larger than
 * `PICKER.fontMost`, which its boxes hold. Its fields are rounded and lined
 * as the widget's field is, and the mode's pieces and the preview are
 * rounded as a swatch is (`PICKER.round`).
 *
 * The colour is held as the wheel holds it, as the square holds it and as
 * the HSL channels hold it (`PickerTerms`): the hue's unit vector and its
 * saturated colour with the triangle's saturation and intensity, the
 * square's hue, saturation and value, the hue, saturation and lightness, and
 * the alpha; a grey, whose saturation of 0 names no hue, keeps the hues it
 * is read over, as the colour dialog (picker.js) keeps the wheel's
 * (`termsKeeping`). The wheel's angle on the ring is not the square's hue:
 * the two meet only through the colour each gives. The square's terms and
 * the HSL channels' share their hue and are converted each from the other
 * exactly as one moves (`termsAtSquare`, `termsAtHsl`), never read back from
 * the bytes, which cannot hold every hundredth or degree, so a value set in
 * either space reads back as itself and steps on from there; a saturation
 * the colour names none of, at black in both spaces and at white in HSL, is
 * kept through the conversion, and read as none from the colour. What a
 * point on the ring or in the triangle sets is read by the wheel's own
 * maths, so a point on the picker's wheel gives the colour the dialog gives
 * there, and the colour a region sets is the triangle's bytes for the terms,
 * the square's for its terms, a bar's channel set, to a byte in RGB and to
 * its share of the channel's most in HSV or HSL, a named cell's or a
 * swatch's, or on an alpha bar the colour as it stands, never the wheel's
 * hue term formatted: at the ring's leftmost point the hue's green reads
 * past a byte, which the triangle's colour holds to 255.
 *
 * Pure: the layout is a function of the laid widget, the host's size, the
 * text measure, the mode and the eyedropper's tooltip words, every box past
 * the popover's own in the popover's pixels from its top-left corner; the
 * painter draws into the context it is given, transformed to the host's
 * pixels by the caller, the wheel as an image the caller passes, and holds
 * nothing.
 *
 * The eyedropper takes a colour from outside the picker by the tier its host
 * offers (`DropperTier`): the browser's own eyedropper, anywhere on the
 * screen; the host's view; or none, the eyedropper drawn half as solid. Its
 * tooltip, laid out from the tier's words (`DROPPER_TIPS`) and the host's
 * note where the tier is none, stands over the picker above it, its words
 * wrapped to the picker's width, and is a region of its own while it shows.
 */

import { PICKER_MODES, cssColour, type PickerMode, type ColourWidget } from './options.ts';
import { CONTROL, POPOVER_MARGIN, inBox, monoFont, titleFont, type Box, type Font, type Laid, type ResolvedStyle, type TextMeasure } from './layout.ts';
import { PALETTE, clipRounded, drawCentred, fieldLine, fieldRadius, fillRounded, fontString, paintSwatch, popoverFace, strokeInside } from './paint.ts';
import { CHANNELS, SWATCHES, hslToHsv, hslToRgb, hsvToHsl, hsvToRgb, isLightSwatch, paintBarFill, paintBarLine, paintChecker, rgbToHsl, rgbToHsv, type ColourSpace, type Hsl, type Hsv } from './colour.ts';
import { ringAt, saturatedOf, triangleAt, triangleColour, triangleOf, unitOfHue, wheelGeometry, wheelRegionAt, type Rgb, type Vec2, type WheelGeometry } from './wheel.ts';
import { parseColour } from './hex.ts';

/** The measures the picker is laid out by, in the host's pixels: the same on every host. */
export const PICKER = {
	/** How wide the picker is, whatever the field it opens from. */
	width: 288,
	/** The room inside the picker's edge. */
	pad: 10,
	/** The room between its rows, and between the fields of a row. */
	gap: 8,
	/** How tall the tab row is. */
	tab: 24,
	/** How tall the mode's area is; it is as wide as the room inside the edge. */
	area: 180,
	/** How wide the alpha bar and the hue strip are. */
	strip: 18,
	/** How tall a field is: the preview, the hex field and the channel fields. */
	field: 30,
	/** How wide the preview is, its two halves together. */
	preview: 56,
	/** The side of one of the colour's own swatches, and the room between them. */
	swatch: 28,
	swatchGap: 6,
	/** How many swatches stand in a row. */
	perRow: 7,
	/** How tall a named cell is. */
	cell: 24,
	/** The radius of the square's cursor, its white ring. */
	cursor: 6,
	/** How round the corners of the mode's pieces and the preview are: the square, the strips, the bars, the named cells' block and the preview's pair, as a swatch's. */
	round: 4,
	/** How thick the line under the active tab's word is, and how far it reaches past the word at either end. */
	tabLine: 2,
	tabRoom: 6,
	/** The close's cross: how thick its strokes are, and how far each arm reaches from its centre. */
	closeLine: 2,
	closeArm: 5,
	/** How wide the colour space's word is in the channel fields' row. */
	space: 44,
	/** The largest size the picker's words are set at, so the tabs, the cells and the fields hold them; the widget's own size where it is smaller. */
	fontMost: 16,
	/** The room inside the eyedropper's tooltip, round its words. */
	tipPad: 6,
} as const;

/** What the eyedropper picks from, as its host offers it: anywhere on the screen, through the browser's own eyedropper; the host's view; or nothing, where neither is offered. */
export type DropperTier = 'screen' | 'frame' | 'off';

/** The eyedropper's tooltip in each tier; the host's note follows the words where the tier is none, on a line of its own. */
export const DROPPER_TIPS: Readonly<Record<DropperTier, string>> = {
	screen: 'Pick a colour from anywhere on the screen',
	frame: 'Pick a colour from the view. Picking from anywhere on the screen needs Chrome or Edge on a computer',
	off: 'Eyedropper not available',
};

/** The colour of the tooltip's words, over its bubble in `PALETTE.tip`. */
const TIP_WORDS = '#ffffff';

/** The word each mode's tab is written with. */
export const MODE_WORDS: Readonly<Record<PickerMode, string>> = { wheel: 'Wheel', square: 'Square', sliders: 'Sliders', names: 'Names' };

/** The hue strip's stops from its top to its foot: the hue falling from 360 through each sector's colour to 0, red at both ends. */
export const HUE_STOPS: readonly Rgb[] = [[255, 0, 0], [255, 0, 255], [0, 0, 255], [0, 255, 255], [0, 255, 0], [255, 255, 0], [255, 0, 0]];

/** The colour each channel bar runs from at its top in RGB, to black at its foot: red, green and blue in full. */
const BAR_TOPS: readonly Rgb[] = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];

/** How wide the ring round the chosen cell and swatch, the bar the keys act on and the armed eyedropper is, in the accent. */
const CHOSEN_RING = 2;

/** A part of the picker a point lies on: the kind, and the index of a tab, a named cell, a channel bar, a channel field or a swatch, -1 for the rest. */
export interface Region {
	kind: 'tab' | 'close' | 'ring' | 'triangle' | 'name' | 'square' | 'hue' | 'alpha' | 'bar' | 'old' | 'new' | 'hex' | 'dropper' | 'tip' | 'space' | 'channel' | 'alphaField' | 'swatch';
	index: number;
}

/** Whether two regions are the same part; two nulls are. */
export const sameRegion = (a: Region | null, b: Region | null): boolean =>
	a === b || (a !== null && b !== null && a.kind === b.kind && a.index === b.index);

/** The regions a press on sets the colour at the point, and a drag from follows the pointer. */
export const DRAGGED_REGIONS: readonly Region['kind'][] = ['ring', 'triangle', 'alpha', 'square', 'hue', 'bar'];

/** A colour as the picker holds it: the hue's unit vector on the ring and its saturated colour, the triangle's saturation and intensity, the square's hue, saturation and value, the HSL channels' hue, saturation and lightness, the hue the square's, and the alpha. */
export interface PickerTerms {
	unit: Vec2;
	hue: Rgb;
	saturation: number;
	intensity: number;
	square: Hsv;
	hsl: Hsl;
	alpha: number;
}

/** The picker laid out: the popover's box in the host's pixels, and every part in the popover's own pixels from its top-left corner. */
export interface PickerLayout {
	/** The colour widget the picker belongs to. */
	widget: ColourWidget;
	/** Where the picker stands: from the widget's face down, or up from it where the room below is short of the picker and there is more room above. */
	box: Box;
	/** Whether it opens above the widget. */
	above: boolean;
	/** The mode laid out. */
	mode: PickerMode;
	/** Whether the widget carries an alpha: the bar and the alpha field are laid out only then. */
	alpha: boolean;
	/** The tab of each mode, in the order of `PICKER_MODES`. */
	tabs: { mode: PickerMode; box: Box }[];
	/** The close, a square at the right end of the tab row, its cross across its middle standing on the tabs' words' baseline, its right end flush with the contents' right edge; it shuts the picker. */
	close: Box;
	/** The mode's area. */
	area: Box;
	/** The wheel's square, in wheel; null in the other modes. */
	wheel: Box | null;
	/** The saturation and value square, and the hue strip at its right, in square; null in the other modes. */
	square: Box | null;
	hueStrip: Box | null;
	/** The channel bars, in sliders: the space's three channels, and the alpha where the widget carries one; empty in the other modes. */
	bars: Box[];
	/** The alpha bar at the area's right, where the widget carries an alpha, in wheel, square and names; null otherwise. */
	alphaBar: Box | null;
	/** The named cells, by the standard colours' index, in names; empty in the other modes. */
	names: Box[];
	/** The preview's two halves: the colour the picker opened on, and the colour now. */
	old: Box;
	new: Box;
	hex: Box;
	/** The eyedropper, a field's square at the right end of the hex's row. */
	dropper: Box;
	/** The eyedropper's tooltip as laid out from its words: its bubble, right-aligned to the contents' right edge and standing its gap's half above the eyedropper, its words a line each, and their font; null where it was given no words. */
	tip: { box: Box; lines: string[]; font: Font } | null;
	/** The colour space's word, and the three channel fields. */
	space: Box;
	channels: Box[];
	/** The alpha field, as a percentage, where the widget carries an alpha; null otherwise. */
	alphaField: Box | null;
	/** The colour's own swatches, by index: a script's where it set them, else its options'. */
	swatches: Box[];
	/** Each of those swatches' colours, written as the widget holds its colour. */
	swatchHexes: readonly string[];
	style: ResolvedStyle;
}

/** A colour's bytes from its channels in 0..1. */
const bytesOf = (colour: { r: number; g: number; b: number }): Rgb => [Math.round(colour.r * 255), Math.round(colour.g * 255), Math.round(colour.b * 255)];

/** A colour's bytes from its channels in 0..1, as a tuple. */
const bytesOfUnits = ([r, g, b]: readonly [number, number, number]): Rgb => bytesOf({ r, g, b });

/** A colour's channels in 0..1 from its bytes. */
const unitsOf = (colour: Rgb): [number, number, number] => [colour[0] / 255, colour[1] / 255, colour[2] / 255];

/** The terms a colour is read into: the wheel's, the square's, the HSL channels' and the alpha given; the hues 0 for a grey, and a saturation the colour names none of, at black in both spaces and at white in HSL, 0. */
export const termsOf = (colour: Rgb, alpha: number): PickerTerms => {
	const { hue, saturation, intensity } = saturatedOf(colour);
	const units = unitsOf(colour);
	return { unit: unitOfHue(hue), hue, saturation, intensity, square: rgbToHsv(units), hsl: rgbToHsl(units), alpha };
};

/**
 * The terms a colour is read into over the terms it replaces: a grey, whose
 * saturation of 0 names no hue, keeps the wheel's hue and its place on the
 * ring, so the triangle stays where it stood, as the dialog keeps it, and the
 * square's hue, the HSL channels' with it, so the square stays at it.
 */
export const termsKeeping = (colour: Rgb, alpha: number, was: PickerTerms): PickerTerms => {
	const read = termsOf(colour, alpha);
	const units = unitsOf(colour);
	const square = rgbToHsv(units, was.square.h);
	const hsl = rgbToHsl(units, was.square.h);
	return read.saturation > 0 ? { ...read, square, hsl } : { ...read, unit: was.unit, hue: was.hue, square, hsl };
};

/** The colour the terms give: the triangle's bytes at the saturation and the intensity. */
export const termsColour = (terms: PickerTerms): Rgb => triangleColour(terms.hue, terms.saturation, terms.intensity);

/** The colour the square's terms give, as bytes. */
export const squareColour = (square: Hsv): Rgb => bytesOfUnits(hsvToRgb(square));

/**
 * The terms with the square's hue, saturation and value and the HSL
 * channels' read from the colour the wheel's terms give, a grey at the hue
 * the wheel stands at: the wheel's ring angle is not the square's hue, so a
 * move of the wheel reads the square afresh through the colour, and the
 * fields and the square follow it.
 */
export const withSquare = (terms: PickerTerms): PickerTerms => {
	const units = unitsOf(termsColour(terms));
	const h = rgbToHsv(unitsOf(terms.hue)).h;
	return { ...terms, square: rgbToHsv(units, h), hsl: rgbToHsl(units, h) };
};

/** The terms with the square moved to a hue, saturation and value, the HSL channels converted from it exactly (`hsvToHsl`), their saturation kept at black and white, which name none. */
export const termsAtSquare = (terms: PickerTerms, square: Hsv): PickerTerms => ({ ...terms, square, hsl: hsvToHsl(square, terms.hsl.s) });

/** The terms with the HSL channels moved to a hue, saturation and lightness, the square converted from them exactly (`hslToHsv`), its saturation kept at black, which names none. */
export const termsAtHsl = (terms: PickerTerms, hsl: Hsl): PickerTerms => ({ ...terms, hsl, square: hslToHsv(hsl, terms.square.s) });

/** The wheel's hue term and its place on the ring for a hue in degrees: the saturated colour at the hue, read as the wheel reads one. */
const hueTerms = (h: number): { unit: Vec2; hue: Rgb } => {
	const { hue } = saturatedOf(squareColour({ h, s: 1, v: 1 }));
	return { unit: unitOfHue(hue), hue };
};

/**
 * The three channel values a colour reads as in a space, whole numbers: its
 * bytes in RGB; its hue in degrees and its saturation and value in percent
 * in HSV, from the square's terms; its hue, saturation and lightness in HSL,
 * from the HSL channels' terms. The terms are held exactly, so a value set
 * reads back as itself.
 */
export const channelsOf = (space: ColourSpace, colour: Rgb, terms: PickerTerms): [number, number, number] => {
	switch (space) {
		case 'HSV': {
			const { h, s, v } = terms.square;
			return [Math.round(h), Math.round(s * 100), Math.round(v * 100)];
		}
		case 'HSL': {
			const { h, s, l } = terms.hsl;
			return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
		}
		default:
			return [...colour];
	}
};

/**
 * The terms and the colour with one channel of a space set to a value in the
 * channel's own units, held to its range (`CHANNELS`): in RGB the byte, the
 * other two kept, the hues kept where that gives a grey; in HSV the square's
 * term, the colour the square's bytes; in HSL the HSL channels' term, the
 * colour the bytes `hslToRgb` gives; the other space's terms converted from
 * the one set (`termsAtSquare`, `termsAtHsl`) and the wheel's read from the
 * colour. A hue set on a grey, which its bytes cannot hold, moves the square
 * and the wheel to it all the same.
 */
export const termsWithChannel = (space: ColourSpace, index: number, value: number, terms: PickerTerms, colour: Rgb): { terms: PickerTerms; colour: Rgb } => {
	const held = Math.max(0, Math.min(CHANNELS[space][index], value));
	if (space === 'RGB') {
		const set: Rgb = [...colour];
		set[index] = Math.round(held);
		return { terms: termsKeeping(set, terms.alpha, terms), colour: set };
	}
	let moved: PickerTerms;
	let set: Rgb;
	if (space === 'HSV') {
		const square: Hsv = index === 0 ? { ...terms.square, h: held } : index === 1 ? { ...terms.square, s: held / 100 } : { ...terms.square, v: held / 100 };
		moved = termsAtSquare(terms, square);
		set = squareColour(square);
	} else {
		const hsl: Hsl = index === 0 ? { ...terms.hsl, h: held } : index === 1 ? { ...terms.hsl, s: held / 100 } : { ...terms.hsl, l: held / 100 };
		moved = termsAtHsl(terms, hsl);
		set = bytesOfUnits(hslToRgb(hsl));
	}
	const read = termsKeeping(set, terms.alpha, terms);
	return { terms: { ...read, ...(read.saturation === 0 && index === 0 ? hueTerms(moved.square.h) : {}), square: moved.square, hsl: moved.hsl }, colour: set };
};

/** The hue's seven stops at the other channels' values, 360 at the top falling by a sector to 0 at the foot. */
const hueStops = (colourAt: (h: number) => Rgb): Rgb[] => Array.from({ length: 7 }, (_, i) => colourAt(360 - 60 * i));

/**
 * The stops a channel's bar runs through, from its top to its foot: in RGB
 * the channel in full to black, as the dialog paints it; in HSV and HSL the
 * channel from its most to its least at the other channels' current values,
 * the hue through the six sector colours, the saturation and the value
 * between two stops, and the lightness through white, the colour at half
 * and black, between which it runs straight.
 */
export const barStops = (space: ColourSpace, index: number, terms: PickerTerms): Rgb[] => {
	switch (space) {
		case 'HSV': {
			const { h, s, v } = terms.square;
			if (index === 0) return hueStops((hue) => squareColour({ h: hue, s, v }));
			return index === 1 ? [squareColour({ h, s: 1, v }), squareColour({ h, s: 0, v })] : [squareColour({ h, s, v: 1 }), squareColour({ h, s, v: 0 })];
		}
		case 'HSL': {
			const { h, s, l } = terms.hsl;
			const at = (hsl: Hsl): Rgb => bytesOfUnits(hslToRgb(hsl));
			if (index === 0) return hueStops((hue) => at({ h: hue, s, l }));
			return index === 1 ? [at({ h, s: 1, l }), at({ h, s: 0, l })] : [at({ h, s, l: 1 }), at({ h, s, l: 0.5 }), at({ h, s, l: 0 })];
		}
		default:
			return [BAR_TOPS[index], [0, 0, 0]];
	}
};

/** Where a channel's bar stands, 0..1 from the foot: the channel's share of its most in the space. */
export const barShare = (space: ColourSpace, index: number, colour: Rgb, terms: PickerTerms): number => {
	switch (space) {
		case 'HSV':
			return [terms.square.h / 360, terms.square.s, terms.square.v][index];
		case 'HSL':
			return [terms.hsl.h / 360, terms.hsl.s, terms.hsl.l][index];
		default:
			return colour[index] / 255;
	}
};

/** A share of a bar's height from its foot at a point's height, held to 0..1: 1 at the top. */
const shareUp = (bar: Box, y: number): number => Math.max(0, Math.min(1, 1 - (y - bar.y) / bar.h));

/** A channel's byte at a share of its bar from the foot: the share of 256 rounded down, the top's 256 held to 255. */
export const byteAt = (share: number): number => Math.min(255, Math.floor(share * 256));

/** The wheel's geometry for its square at a number of texels per logical pixel: the canvas's texels, the wheel's logical size and the ratio. */
export const wheelGeometryOf = (wheel: Box, ratio: number): WheelGeometry =>
	wheelGeometry(Math.round(wheel.w * ratio), Math.round(wheel.h * ratio), wheel.w, ratio);

/** The box of one of the picker's fields, in the popover's own pixels; null for a region that is no field, and for the alpha field where the widget carries none. */
export const fieldBox = (layout: PickerLayout, region: Region): Box | null => {
	switch (region.kind) {
		case 'hex':
			return layout.hex;
		case 'channel':
			return layout.channels[region.index] ?? null;
		case 'alphaField':
			return layout.alphaField;
		default:
			return null;
	}
};

/** The picker's fields in the order Tab walks them: the hex, the three channels, and the alpha where the widget carries one. */
export const fieldChain = (layout: PickerLayout): Region[] => [
	{ kind: 'hex', index: -1 },
	...layout.channels.map((_, index): Region => ({ kind: 'channel', index })),
	...(layout.alphaField ? [{ kind: 'alphaField', index: -1 } as Region] : []),
];

/** The words a field shows: the hex as the widget holds it, a channel's value in the space, or the alpha in percent; empty for a region that is no field. */
export const fieldText = (region: Region, space: ColourSpace, hex: string, colour: Rgb, terms: PickerTerms): string => {
	switch (region.kind) {
		case 'hex':
			return hex;
		case 'channel':
			return String(channelsOf(space, colour, terms)[region.index] ?? '');
		case 'alphaField':
			return String(Math.round(terms.alpha * 100));
		default:
			return '';
	}
};

/** One of a picker's swatches read as bytes and an alpha; null for an index past them or a swatch that does not read. */
export const swatchColour = (layout: Pick<PickerLayout, 'swatchHexes'>, index: number): { rgb: Rgb; alpha: number } | null => {
	const hex = layout.swatchHexes[index];
	const colour = hex === undefined ? null : parseColour(hex);
	return colour ? { rgb: bytesOf(colour), alpha: colour.a } : null;
};

/**
 * Lays a colour's picker out: `PICKER.width` wide, whatever the widget's
 * face's width, across from the face's left and pulled left where it would
 * pass the host's right edge, though never past its left edge, so one wider
 * than the host reaches past the right; below the face, or above
 * it where the room below is short of the picker's height and there is more
 * room above, a margin from the edge. Its height is never cut, so where
 * neither side has the room it reaches past the host's edge on the side with
 * more room. The rows inside: the tabs, the mode's area, the preview and the
 * hex field, the space word and the channel fields, and the colour's own
 * swatches seven to a row. A tab stands for every mode, the tabs sharing
 * the row left of the close, a square as tall as the row at its right end,
 * whose cross stands on the words' baseline with its right end flush with
 * the contents' right edge. The eyedropper is a field's square at the right
 * end of the hex's row, the hex field left of it and its gap, and its
 * tooltip, where it is given words, a bubble over the picker above it.
 *
 * @param laid - The colour widget, as laid out
 * @param width - The host's width in its own pixels
 * @param height - The host's height
 * @param measure - How wide a run of words is in a font, which the eyedropper's tooltip is wrapped by
 * @param mode - The mode to lay out
 * @param tip - The eyedropper's tooltip, a line break before the host's note where it has one; null for none
 */
export const layoutPicker = (laid: Laid, width: number, height: number, measure: TextMeasure, mode: PickerMode, tip: string | null = null): PickerLayout => {
	const { widget, face, style } = laid;
	const alpha = widget.alpha === true;
	const swatchHexes = laid.state.swatches ?? widget.swatches ?? [];
	const swatchCount = swatchHexes.length;
	const w = PICKER.width;
	const innerW = w - 2 * PICKER.pad;
	const tabsY = PICKER.pad;
	const areaY = tabsY + PICKER.tab + PICKER.gap;
	const previewY = areaY + PICKER.area + PICKER.gap;
	const channelY = previewY + PICKER.field + PICKER.gap;
	const rows = Math.ceil(swatchCount / PICKER.perRow);
	const swatchesY = channelY + PICKER.field + PICKER.gap;
	const h = (rows > 0 ? swatchesY + rows * PICKER.swatch + (rows - 1) * PICKER.swatchGap : channelY + PICKER.field) + PICKER.pad;
	const below = height - (face.y + face.h);
	const aboveRoom = face.y;
	const above = h > below - POPOVER_MARGIN && aboveRoom > below;
	const box: Box = { x: Math.max(0, Math.min(face.x, width - w)), y: above ? face.y - h : face.y + face.h, w, h };

	// The close's cross stands level with the tabs' words, the round cap of its stroke flush with the contents' right edge, the room under it; its square is centred on it across.
	const close: Box = { x: PICKER.pad + innerW - PICKER.closeLine / 2 - PICKER.closeArm - PICKER.tab / 2, y: tabsY, w: PICKER.tab, h: PICKER.tab };
	const tabW = (close.x - PICKER.gap - PICKER.pad) / PICKER_MODES.length;
	const tabs = PICKER_MODES.map((each, i) => ({ mode: each, box: { x: PICKER.pad + i * tabW, y: tabsY, w: tabW, h: PICKER.tab } }));
	const area: Box = { x: PICKER.pad, y: areaY, w: innerW, h: PICKER.area };
	const alphaBar: Box | null = alpha && mode !== 'sliders' ? { x: area.x + area.w - PICKER.strip, y: area.y, w: PICKER.strip, h: area.h } : null;
	// The wheel's square is as tall as the area, centred in the room left of the alpha bar, or in the area without one, on a whole pixel.
	const wheelRoom = (alphaBar ? alphaBar.x - PICKER.gap : area.x + area.w) - area.x;
	const wheel: Box | null = mode === 'wheel' ? { x: area.x + Math.round((wheelRoom - area.h) / 2), y: area.y, w: area.h, h: area.h } : null;
	// The hue strip stands at the alpha bar's left, or at the area's right
	// without one, and the square takes the room left of it.
	const stripX = (alphaBar ? alphaBar.x - PICKER.gap : area.x + area.w) - PICKER.strip;
	const hueStrip: Box | null = mode === 'square' ? { x: stripX, y: area.y, w: PICKER.strip, h: area.h } : null;
	const square: Box | null = mode === 'square' ? { x: area.x, y: area.y, w: stripX - PICKER.gap - area.x, h: area.h } : null;
	const barCount = alpha ? 4 : 3;
	const barW = (area.w - (barCount - 1) * PICKER.gap) / barCount;
	const bars: Box[] = mode === 'sliders'
		? Array.from({ length: barCount }, (_, i) => ({ x: area.x + i * (barW + PICKER.gap), y: area.y, w: barW, h: area.h }))
		: [];
	// Two columns of cells, each colour below the one before it and the second column after the first, as the dialog's table stands, in the room left of the alpha bar where there is one.
	const perColumn = Math.ceil(SWATCHES.length / 2);
	const cellW = ((alphaBar ? alphaBar.x - PICKER.gap : area.x + area.w) - area.x) / 2;
	const names: Box[] = mode === 'names'
		? SWATCHES.map((_, i) => ({ x: area.x + Math.floor(i / perColumn) * cellW, y: area.y + (i % perColumn) * PICKER.cell, w: cellW, h: PICKER.cell }))
		: [];
	const half = PICKER.preview / 2;
	const old: Box = { x: PICKER.pad, y: previewY, w: half, h: PICKER.field };
	const current: Box = { x: PICKER.pad + half, y: previewY, w: half, h: PICKER.field };
	const dropper: Box = { x: PICKER.pad + innerW - PICKER.field, y: previewY, w: PICKER.field, h: PICKER.field };
	const hexX = PICKER.pad + PICKER.preview + PICKER.gap;
	const hex: Box = { x: hexX, y: previewY, w: dropper.x - PICKER.gap - hexX, h: PICKER.field };
	const space: Box = { x: PICKER.pad, y: channelY, w: PICKER.space, h: PICKER.field };
	const fieldCount = alpha ? 4 : 3;
	const fieldW = (innerW - PICKER.space - fieldCount * PICKER.gap) / fieldCount;
	const fields = Array.from({ length: fieldCount }, (_, i): Box => ({ x: PICKER.pad + PICKER.space + PICKER.gap + i * (fieldW + PICKER.gap), y: channelY, w: fieldW, h: PICKER.field }));
	const swatches = Array.from({ length: swatchCount }, (_, i): Box => ({
		x: PICKER.pad + (i % PICKER.perRow) * (PICKER.swatch + PICKER.swatchGap),
		y: swatchesY + Math.floor(i / PICKER.perRow) * (PICKER.swatch + PICKER.swatchGap),
		w: PICKER.swatch,
		h: PICKER.swatch,
	}));
	// The picker's words' font at a control's title's size.
	const tipLaid = tip ? layoutTip(tip, titleFont(monoFont({ ...style.font, size: Math.min(style.font.size, PICKER.fontMost) })), measure, innerW, dropper) : null;
	return { widget, box, above, mode, alpha, tabs, close, area, wheel, square, hueStrip, bars, alphaBar, names, old, new: current, hex, dropper, tip: tipLaid, space, channels: fields.slice(0, 3), alphaField: alpha ? fields[3] : null, swatches, swatchHexes, style };
};

/**
 * The eyedropper's tooltip laid out: each line of its words, a line break
 * starting another, wrapped at the last space that fits the picker's width
 * inside the bubble's room, a word that fits nowhere on a line of its own;
 * the bubble as wide as its widest line, no wider than the picker's inside,
 * and as tall as its lines, its room round them, its right edge on the
 * contents' right edge and its foot the gap's half above the eyedropper.
 */
const layoutTip = (words: string, font: Font, measure: TextMeasure, innerW: number, dropper: Box): { box: Box; lines: string[]; font: Font } => {
	const most = innerW - 2 * PICKER.tipPad;
	const lines: string[] = [];
	for (const paragraph of words.split('\n')) {
		let line = '';
		for (const word of paragraph.split(' ').filter(Boolean)) {
			const longer = line ? `${line} ${word}` : word;
			if (line && measure(longer, font) > most) {
				lines.push(line);
				line = word;
			} else line = longer;
		}
		lines.push(line);
	}
	const w = Math.min(innerW, Math.max(...lines.map((line) => measure(line, font))) + 2 * PICKER.tipPad);
	const h = lines.length * font.size * CONTROL.lineHeight + 2 * PICKER.tipPad;
	return { box: { x: PICKER.pad + innerW - w, y: dropper.y - PICKER.gap / 2 - h, w, h }, lines, font };
};

/**
 * The region under a point of the picker, in the popover's own pixels; null
 * between the regions. Inside the wheel's square the ring and the triangle
 * are told apart by the wheel's own maths, the triangle standing where the
 * hue's unit vector puts it. The eyedropper's tooltip, while it shows, stands
 * over every region under it.
 *
 * @param layout - The picker laid out
 * @param x - The point's distance from the popover's left edge
 * @param y - The point's distance from the popover's top edge
 * @param unit - The hue's unit vector, which places the triangle
 * @param tipShown - Whether the eyedropper's tooltip shows
 */
export const pickerRegionAt = (layout: PickerLayout, x: number, y: number, unit: Vec2, tipShown = false): Region | null => {
	const at = (kind: Region['kind'], boxes: readonly Box[]): Region | null => {
		const index = boxes.findIndex((box) => inBox(box, x, y));
		return index < 0 ? null : { kind, index };
	};
	const one = (kind: Region['kind'], box: Box | null): Region | null => (box && inBox(box, x, y) ? { kind, index: -1 } : null);
	if (tipShown && layout.tip && inBox(layout.tip.box, x, y)) return { kind: 'tip', index: -1 };
	const tab = at('tab', layout.tabs.map((each) => each.box)) ?? one('close', layout.close);
	if (tab) return tab;
	if (layout.wheel && inBox(layout.wheel, x, y)) {
		const geometry = wheelGeometryOf(layout.wheel, 1);
		const part = wheelRegionAt(geometry, triangleOf(unit, geometry), x - layout.wheel.x, y - layout.wheel.y);
		return part ? { kind: part, index: -1 } : null;
	}
	return at('name', layout.names)
		?? one('square', layout.square)
		?? one('hue', layout.hueStrip)
		?? at('bar', layout.bars)
		?? one('alpha', layout.alphaBar)
		?? one('old', layout.old)
		?? one('new', layout.new)
		?? one('hex', layout.hex)
		?? one('dropper', layout.dropper)
		?? one('space', layout.space)
		?? at('channel', layout.channels)
		?? one('alphaField', layout.alphaField)
		?? at('swatch', layout.swatches);
};

/**
 * What a press or a click at a point of a region sets: on the ring the hue
 * at the point's angle from the wheel's centre, wherever the point lies but
 * the centre itself; in the triangle the saturation and intensity at the
 * point, one beyond an edge taken onto it; on the square the saturation at
 * the point's share across it and the value at its share up it, held to
 * 0..1; on the hue strip the hue at the point's share up it, 0 at the foot
 * and 360 at the top; on a channel bar that channel at the point's share up
 * it, in RGB the dialog's byte (`byteAt`) and in HSV or HSL the share of the
 * channel's most (`termsWithChannel`), the other two kept; on the alpha bar,
 * or the alpha's channel bar, the alpha at the point's share up it; on a
 * named cell the standard colour; on a swatch the swatch's colour, its
 * alpha with it; where a channel bar, a cell or a swatch gives a grey, the
 * hues of the terms given are kept (`termsKeeping`), but for the hue bar in
 * HSV or HSL, which moves the wheel to the hue set. A move of the wheel
 * reads the square's terms and the HSL channels' afresh from the colour
 * (`withSquare`); a move of the square or the hue strip converts the HSL
 * channels' from the square's (`termsAtSquare`). Null for a region that
 * sets no colour at a point. The colour given is the triangle's bytes for
 * the terms, the square's, the bar's channel set, the cell's or the
 * swatch's bytes, or on an alpha bar the colour given.
 *
 * @param layout - The picker laid out
 * @param region - The region pressed
 * @param x - The point, in the popover's own pixels
 * @param y - The point
 * @param terms - The colour's terms as they stand
 * @param colour - The colour's bytes as they stand, which an alpha bar keeps and, in RGB, a channel bar sets one of
 * @param space - The colour space the channel bars read the colour in
 */
export const colourAtRegion = (layout: PickerLayout, region: Region, x: number, y: number, terms: PickerTerms, colour: Rgb, space: ColourSpace = 'RGB'): { terms: PickerTerms; colour: Rgb } | null => {
	switch (region.kind) {
		case 'ring': {
			if (!layout.wheel) return null;
			const at = ringAt(wheelGeometryOf(layout.wheel, 1), x - layout.wheel.x, y - layout.wheel.y);
			if (!at) return null;
			const moved = withSquare({ ...terms, unit: at.unit, hue: at.hue });
			return { terms: moved, colour: termsColour(moved) };
		}
		case 'triangle': {
			if (!layout.wheel) return null;
			const geometry = wheelGeometryOf(layout.wheel, 1);
			const at = triangleAt(geometry, triangleOf(terms.unit, geometry), x - layout.wheel.x, y - layout.wheel.y);
			const moved = withSquare({ ...terms, saturation: at.saturation, intensity: at.intensity });
			return { terms: moved, colour: termsColour(moved) };
		}
		case 'alpha':
			return layout.alphaBar ? { terms: { ...terms, alpha: shareUp(layout.alphaBar, y) }, colour } : null;
		case 'square': {
			const square = layout.square;
			if (!square) return null;
			const moved = { ...terms.square, s: Math.max(0, Math.min(1, (x - square.x) / square.w)), v: shareUp(square, y) };
			return { terms: termsAtSquare(terms, moved), colour: squareColour(moved) };
		}
		case 'hue': {
			if (!layout.hueStrip) return null;
			const moved = { ...terms.square, h: shareUp(layout.hueStrip, y) * 360 };
			return { terms: termsAtSquare(terms, moved), colour: squareColour(moved) };
		}
		case 'bar': {
			const bar = layout.bars[region.index];
			if (!bar) return null;
			const share = shareUp(bar, y);
			if (region.index === 3) return { terms: { ...terms, alpha: share }, colour };
			return termsWithChannel(space, region.index, space === 'RGB' ? byteAt(share) : share * CHANNELS[space][region.index], terms, colour);
		}
		case 'name': {
			const swatch = SWATCHES[region.index];
			return swatch ? { terms: termsKeeping(swatch.rgb, terms.alpha, terms), colour: [...swatch.rgb] } : null;
		}
		case 'swatch': {
			const own = swatchColour(layout, region.index);
			return own ? { terms: termsKeeping(own.rgb, layout.alpha ? own.alpha : 1, terms), colour: own.rgb } : null;
		}
	}
	return null;
};

/** What the picker is in as it is painted. */
export interface PickerPaintState {
	/** The colour now. */
	colour: Rgb;
	/** The colour as the widget holds it, `#rrggbb` or `#rrggbbaa`, written in the hex field. */
	hex: string;
	/** The colour the picker opened on, and its alpha. */
	old: Rgb;
	oldAlpha: number;
	/** The region under the pointer; null for none. */
	lit: Region | null;
	/** The named cell the keys point at; -1 for none. */
	name: number;
	/** The colour's terms: the square's hue, saturation and value, which place its cursor, its hue and the hue strip's line, the HSL channels', and the alpha. */
	terms: PickerTerms;
	/** The channel bar the keys act on, in sliders. */
	bar: number;
	/** The colour space the channel fields and the bars read the colour in. */
	space: ColourSpace;
	/** The field the page's input is handed to, painted as its box alone; null for none. */
	field: Region | null;
	/** The eyedropper: what it picks from, whether it is armed (as it is while the browser's own eyedropper is open), and whether its tooltip shows. */
	dropper: { tier: DropperTier; armed: boolean; tip: boolean };
}

/** Whether two colours' bytes are equal. */
const sameBytes = (a: Rgb, b: Rgb): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** The font the picker's tab names and colour names are set in: the widget's, no larger than `PICKER.fontMost`. */
export const pickerFont = (layout: PickerLayout): Font => ({ ...layout.style.font, size: Math.min(layout.style.font.size, PICKER.fontMost) });

/** The font the picker's fields' words are set in: the picker's font in the monospaced family (`monoFont`), as its tooltip's is. */
export const pickerMono = (layout: PickerLayout): Font => monoFont(pickerFont(layout));

/** A field of the picker: a face filled as the widget's face is, in its background or the field colour, rounded and lined as the widget's field is (`fieldRadius`, `fieldLine`), the line darker under the pointer where it draws the control's, and words centred in it in a colour, in the monospaced family (`pickerMono`); no words for the field the page's input stands over. */
const paintField = (ctx: CanvasRenderingContext2D, box: Box, words: string, layout: PickerLayout, lit: boolean, colour: string): void => {
	const radius = fieldRadius(layout);
	ctx.fillStyle = layout.style.background ? cssColour(layout.style.background) : PALETTE.field;
	fillRounded(ctx, box, radius);
	const line = fieldLine(layout, lit);
	if (line.width > 0) {
		ctx.strokeStyle = line.colour;
		strokeInside(ctx, box, radius, line.width);
	}
	if (words) drawCentred(ctx, words, box, pickerMono(layout), 'CENTER', colour);
};

/**
 * Paints the picker into the popover's context, at the popover's own origin:
 * the body in the widget's background, or the field colour, edged and
 * rounded as the widget is while it has the focus (`popoverFace`); the tab
 * row, a hairline across its foot in the field's line with each mode's word
 * over it (`MODE_WORDS`), the active one in the accent with a line in the
 * accent under its word, `PICKER.tabLine` thick and reaching
 * `PICKER.tabRoom` past the word at either end, and the close at the row's
 * right end, a cross in the words' colour standing on their baseline; the
 * mode's area, its square, strips and bars each filled inside corners
 * rounded by `PICKER.round` and outlined with them, a bar's line laid over
 * its fill uncut: in wheel the wheel's image drawn into its square and the
 * alpha bar over the checkerboard, in square the square filled with its hue
 * under a white from its left and a black from its foot with a white-ringed
 * cursor at the saturation and value, the hue strip through `HUE_STOPS` and
 * the alpha bar, in sliders each channel's bar through the stops its space
 * gives it (`barStops`) with its line at the channel's share of its most
 * (`barShare`) and the alpha's bar from the colour solid to clear over the
 * checkerboard, the bar the keys act on outlined in the accent, in names the
 * alpha bar as in wheel and each standard colour's cell with its name
 * written on it in black where the colour is light and white otherwise, the
 * cells one block rounded at its corners, the one equal to the colour ringed
 * in the accent; the preview's two halves in one rounded pair with a line
 * between them, each over the checkerboard where it has alpha; the hex
 * field, the space word and the channel fields in the space's units
 * (`channelsOf`), the alpha field in percent, each filled, rounded and lined
 * as the widget's field is, the space word in the accent, the one the page's
 * input stands over as its box alone; and the colour's own swatches, the one
 * the colour is written as ringed in the accent. A tab under the pointer has
 * its word in the accent, the close its cross, and the square, the hue
 * strip, a bar but the one the keys act on, a named cell, the old half, a
 * field where it draws the control's line, the eyedropper where it can pick,
 * or a swatch under it is drawn with the hovered line; the ring, the
 * triangle and the new half are not marked. The eyedropper is painted after
 * them: a field's box with a pipette across it in the words' colour, the
 * pipette and a ring round the box in the accent while it is armed, and the
 * whole half as solid where it can pick nothing; then its tooltip while it
 * shows, a bubble in `PALETTE.tip` with its words in white. The tab names
 * and colour names are set in the widget's font, every other word in its
 * monospaced version (`pickerMono`), no larger than `PICKER.fontMost`, the
 * tooltip's at a control's title's size.
 *
 * @param ctx - The popover's context, its transform set by the caller to the host's own pixels
 * @param layout - The picker laid out
 * @param state - The colours, the hex, and what is lit
 * @param wheel - The wheel drawn for the colour, to be copied into its square; null draws none
 */
export const paintPicker = (ctx: CanvasRenderingContext2D, layout: PickerLayout, state: PickerPaintState, wheel: CanvasImageSource | null): void => {
	const { box, style } = layout;
	const font = pickerFont(layout);
	const whole: Box = { x: 0, y: 0, w: box.w, h: box.h };
	const accent = cssColour(style.accent);
	const words = cssColour(style.color);
	const lit = (kind: Region['kind'], index = -1) => sameRegion(state.lit, { kind, index });
	ctx.save();
	ctx.globalAlpha = 1;
	ctx.clearRect(0, 0, box.w, box.h);
	popoverFace(ctx, whole, layout);

	// The tab row: a hairline across its foot in the field's line, each
	// mode's word over it, the active one and the one under the pointer in
	// the accent, and under the active word a line in the accent reaching a
	// little past it at either end, over the hairline.
	const foot = layout.tabs[0].box.y + layout.tabs[0].box.h;
	ctx.fillStyle = fieldLine(layout).colour;
	ctx.fillRect(layout.area.x, foot - CONTROL.border, layout.area.w, CONTROL.border);
	layout.tabs.forEach((tab, i) => {
		const active = tab.mode === layout.mode;
		drawCentred(ctx, MODE_WORDS[tab.mode], tab.box, font, 'CENTER', active || lit('tab', i) ? accent : words);
		if (active) {
			const reach = ctx.measureText(MODE_WORDS[tab.mode]).width / 2 + PICKER.tabRoom;
			const mid = tab.box.x + tab.box.w / 2;
			ctx.fillStyle = accent;
			ctx.fillRect(mid - reach, foot - PICKER.tabLine, 2 * reach, PICKER.tabLine);
		}
	});
	// The close: a cross in the words' colour, in the accent under the pointer,
	// across the middle of its square and standing on the words' baseline,
	// which a capital's descent from the middle line gives, its round feet
	// touching the baseline rather than the descenders' line.
	const cross = layout.close;
	const cx = cross.x + cross.w / 2;
	ctx.font = fontString(font);
	ctx.textBaseline = 'middle';
	const baseline = cross.y + cross.h / 2 + ctx.measureText('H').actualBoundingBoxDescent;
	const crossFoot = baseline - PICKER.closeLine / 2;
	const crossTop = crossFoot - 2 * PICKER.closeArm;
	ctx.strokeStyle = lit('close') ? accent : words;
	ctx.lineWidth = PICKER.closeLine;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo(cx - PICKER.closeArm, crossTop);
	ctx.lineTo(cx + PICKER.closeArm, crossFoot);
	ctx.moveTo(cx + PICKER.closeArm, crossTop);
	ctx.lineTo(cx - PICKER.closeArm, crossFoot);
	ctx.stroke();
	ctx.lineCap = 'butt';

	if (layout.wheel && wheel) ctx.drawImage(wheel, layout.wheel.x, layout.wheel.y, layout.wheel.w, layout.wheel.h);
	const outline = (box: Box, hovered: boolean): void => {
		ctx.strokeStyle = hovered ? PALETTE.lineHover : PALETTE.line;
		strokeInside(ctx, box, PICKER.round, CONTROL.border);
	};
	// Paints a piece inside its rounded corners, then restores the context.
	const rounded = (box: Box, paint: () => void): void => {
		ctx.save();
		clipRounded(ctx, box, PICKER.round);
		paint();
		ctx.restore();
	};
	const alphaStops = [[...state.colour, 1], [...state.colour, 0]];
	if (layout.square) {
		const square = layout.square;
		rounded(square, () => {
			ctx.fillStyle = `rgb(${squareColour({ h: state.terms.square.h, s: 1, v: 1 }).join(',')})`;
			ctx.fillRect(square.x, square.y, square.w, square.h);
			const white = ctx.createLinearGradient(square.x, square.y, square.x + square.w, square.y);
			white.addColorStop(0, 'rgba(255,255,255,1)');
			white.addColorStop(1, 'rgba(255,255,255,0)');
			ctx.fillStyle = white;
			ctx.fillRect(square.x, square.y, square.w, square.h);
			const black = ctx.createLinearGradient(square.x, square.y, square.x, square.y + square.h);
			black.addColorStop(0, 'rgba(0,0,0,0)');
			black.addColorStop(1, 'rgba(0,0,0,1)');
			ctx.fillStyle = black;
			ctx.fillRect(square.x, square.y, square.w, square.h);
		});
		outline(square, lit('square'));
		// A white ring with a dark edge outside it, seen on light and dark alike; the room round the square holds it at the corners.
		const cx = square.x + state.terms.square.s * square.w;
		const cy = square.y + (1 - state.terms.square.v) * square.h;
		ctx.beginPath();
		ctx.arc(cx, cy, PICKER.cursor + 1.5, 0, 2 * Math.PI);
		ctx.lineWidth = 1;
		ctx.strokeStyle = 'rgba(0,0,0,0.6)';
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(cx, cy, PICKER.cursor, 0, 2 * Math.PI);
		ctx.lineWidth = 2;
		ctx.strokeStyle = '#ffffff';
		ctx.stroke();
	}
	if (layout.hueStrip) {
		const strip = layout.hueStrip;
		rounded(strip, () => paintBarFill(ctx, strip, 1, HUE_STOPS));
		paintBarLine(ctx, strip, 1, state.terms.square.h / 360);
		outline(strip, lit('hue'));
	}
	// A bar's line reaches a pixel past its top or its foot at either end of
	// its value, into the gap above or below the area.
	layout.bars.forEach((bar, i) => {
		if (i < 3) {
			rounded(bar, () => paintBarFill(ctx, bar, 1, barStops(state.space, i, state.terms)));
			paintBarLine(ctx, bar, 1, barShare(state.space, i, state.colour, state.terms));
		} else {
			rounded(bar, () => paintBarFill(ctx, bar, 1, alphaStops, true));
			paintBarLine(ctx, bar, 1, state.terms.alpha);
		}
		if (i === state.bar) {
			ctx.strokeStyle = accent;
			strokeInside(ctx, bar, PICKER.round, CHOSEN_RING);
		} else outline(bar, lit('bar', i));
	});
	if (layout.alphaBar) {
		const bar = layout.alphaBar;
		rounded(bar, () => paintBarFill(ctx, bar, 1, alphaStops, true));
		paintBarLine(ctx, bar, 1, state.terms.alpha);
		outline(bar, lit('alpha'));
	}
	// The named cells tile one block from the area's top, rounded at its corners, their rings cut with them.
	const namesFoot = layout.names.reduce((most, cell) => Math.max(most, cell.y + cell.h), layout.area.y);
	const namesRight = layout.names.reduce((most, cell) => Math.max(most, cell.x + cell.w), layout.area.x);
	if (layout.names.length > 0) rounded({ ...layout.area, w: namesRight - layout.area.x, h: namesFoot - layout.area.y }, () => layout.names.forEach((cell, i) => {
		const swatch = SWATCHES[i];
		ctx.fillStyle = `rgb(${swatch.rgb.join(',')})`;
		ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
		drawCentred(ctx, swatch.name, cell, font, 'CENTER', isLightSwatch(swatch.rgb) ? '#000000' : '#ffffff');
		if (sameBytes(swatch.rgb, state.colour)) {
			ctx.strokeStyle = accent;
			strokeInside(ctx, cell, 0, CHOSEN_RING);
		} else if (lit('name', i) || state.name === i) {
			ctx.strokeStyle = PALETTE.lineHover;
			strokeInside(ctx, cell, 0, CONTROL.border);
		}
	}));

	// The preview's two halves in one rounded pair, each over the checkerboard
	// where it has alpha, a line between them and another round the pair.
	const pair: Box = { x: layout.old.x, y: layout.old.y, w: layout.old.w + layout.new.w, h: layout.old.h };
	rounded(pair, () => {
		const half = (box: Box, rgb: Rgb, a: number): void => {
			if (a < 1) paintChecker(ctx, box, 1);
			ctx.fillStyle = cssColour({ r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255, a });
			ctx.fillRect(box.x, box.y, box.w, box.h);
		};
		half(layout.old, state.old, state.oldAlpha);
		half(layout.new, state.colour, state.terms.alpha);
		ctx.fillStyle = PALETTE.line;
		ctx.fillRect(layout.new.x - CONTROL.border / 2, pair.y, CONTROL.border, pair.h);
		if (lit('old')) {
			ctx.strokeStyle = PALETTE.lineHover;
			strokeInside(ctx, layout.old, 0, CONTROL.border);
		}
	});
	ctx.strokeStyle = PALETTE.line;
	strokeInside(ctx, pair, PICKER.round, CONTROL.border);
	const shown = (region: Region): string => (sameRegion(state.field, region) ? '' : fieldText(region, state.space, state.hex, state.colour, state.terms));
	paintField(ctx, layout.hex, shown({ kind: 'hex', index: -1 }), layout, lit('hex'), words);
	// The space's word in the accent: it is the switch between the spaces, not a value.
	paintField(ctx, layout.space, state.space, layout, lit('space'), accent);
	layout.channels.forEach((field, i) => paintField(ctx, field, shown({ kind: 'channel', index: i }), layout, lit('channel', i), words));
	if (layout.alphaField) paintField(ctx, layout.alphaField, shown({ kind: 'alphaField', index: -1 }), layout, lit('alphaField'), words);

	layout.swatches.forEach((square, i) => {
		const own = swatchColour(layout, i);
		paintSwatch(ctx, square, own ? { r: own.rgb[0] / 255, g: own.rgb[1] / 255, b: own.rgb[2] / 255, a: layout.alpha ? own.alpha : 1 } : null, CONTROL.iconRadius);
		// By the text, as both are written, so an alpha a byte holds rings it whatever the share it was reached at.
		const chosen = own !== null && layout.swatchHexes[i] === state.hex;
		if (chosen || lit('swatch', i)) {
			ctx.strokeStyle = chosen ? accent : PALETTE.lineHover;
			strokeInside(ctx, square, CONTROL.iconRadius, chosen ? CHOSEN_RING : CONTROL.border);
		}
	});
	paintDropper(ctx, layout, state.dropper, lit('dropper'), words, accent);
	if (state.dropper.tip && layout.tip) paintTip(ctx, layout.tip);
	ctx.restore();
};

/**
 * Paints the eyedropper: a field's box, the hovered line under the pointer
 * where it can pick, with a pipette across its diagonal, the tube from the
 * tip at the lower left to the collar across it and the bulb beyond, in the
 * words' colour, the pipette and a ring round the box in the accent while it
 * is armed; the whole half as solid where it can pick nothing.
 */
const paintDropper = (ctx: CanvasRenderingContext2D, layout: PickerLayout, dropper: PickerPaintState['dropper'], lit: boolean, words: string, accent: string): void => {
	const box = layout.dropper;
	ctx.save();
	if (dropper.tier === 'off') ctx.globalAlpha *= PALETTE.disabled;
	paintField(ctx, box, '', layout, lit && dropper.tier !== 'off', words);
	const ink = dropper.armed ? accent : words;
	// In the field's own units: one to a pixel at the field's height.
	const unit = box.h / PICKER.field;
	const cx = box.x + box.w / 2;
	const cy = box.y + box.h / 2;
	ctx.strokeStyle = ink;
	ctx.lineWidth = PICKER.closeLine;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo(cx - 7 * unit, cy + 7 * unit);
	ctx.lineTo(cx + 2 * unit, cy - 2 * unit);
	ctx.moveTo(cx - unit, cy - 5 * unit);
	ctx.lineTo(cx + 5 * unit, cy + unit);
	ctx.stroke();
	ctx.lineCap = 'butt';
	ctx.fillStyle = ink;
	fillRounded(ctx, { x: cx + 1.5 * unit, y: cy - 7.5 * unit, w: 6 * unit, h: 6 * unit }, 3 * unit);
	if (dropper.armed) {
		ctx.strokeStyle = accent;
		strokeInside(ctx, box, fieldRadius(layout), CHOSEN_RING);
	}
	ctx.restore();
};

/** Paints the eyedropper's tooltip: its bubble rounded as the picker's pieces are, in `PALETTE.tip`, and its words a line each in white, at the left of its room. */
const paintTip = (ctx: CanvasRenderingContext2D, tip: NonNullable<PickerLayout['tip']>): void => {
	ctx.fillStyle = PALETTE.tip;
	fillRounded(ctx, tip.box, PICKER.round);
	const line = tip.font.size * CONTROL.lineHeight;
	tip.lines.forEach((words, i) => drawCentred(ctx, words, { x: tip.box.x + PICKER.tipPad, y: tip.box.y + PICKER.tipPad + i * line, w: tip.box.w - 2 * PICKER.tipPad, h: line }, tip.font, 'LEFT', TIP_WORDS));
};
