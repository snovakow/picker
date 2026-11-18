/**
 * @fileoverview What the colour well and its picker are painted with: the
 * faces the words are set in, the palette, the rounded fill and the inset
 * stroke, a centred line of words, a field's corners and line, a popover's
 * face, a colour's swatch, and `paintWell`, which paints a colour laid out
 * on its own.
 *
 * The painters draw into the context they are given and hold nothing;
 * `loadFaces` alone reaches past them, putting the faces' style element in a
 * document's head, once. The context's transform is the caller's, so a well
 * painted at a resolution above one is scaled by the caller and drawn here
 * in its own pixels.
 */

import { CONTROL, FOCUS_RING, MONO_FAMILY, monoFont, popoverEdge, titleFont, type Box, type Font, type Laid, type TextAlignWord } from './layout.ts';
import { cssColour, type Colour } from './options.ts';
import { paintChecker } from './colour.ts';
import { parseColour } from './hex.ts';

/**
 * The faces the well's and its picker's words are set in, from the font
 * files in src/css/fonts, so their words are the same letters in every
 * browser rather than whatever each system has: Roboto for the picker's tab
 * names and colour names, and Roboto Mono (`MONO_FAMILY`) for every other
 * word. Each is its regular weight alone, cut to the Latin characters; a
 * bold or an italic a widget's style asks for is synthesised by the browser.
 */
const FONT_FACES = [
	['Roboto', new URL('../css/fonts/roboto/Roboto-Regular-latin.woff2', import.meta.url).href],
	[MONO_FAMILY, new URL('../css/fonts/roboto-mono/RobotoMono-Regular-latin.woff2', import.meta.url).href],
] as const;

/** The id the faces' style element is put in a document under, so it is put there once. */
const FACES_ID = 'colourPickerFaces';

/** Puts the faces in the document, once, so a canvas can set its words in them. */
export const loadFaces = (doc: Document = document): void => {
	if (doc.getElementById(FACES_ID)) return;
	const style = doc.createElement('style');
	style.id = FACES_ID;
	style.textContent = FONT_FACES
		.map(([family, url]) => `@font-face { font-family: '${family}'; font-weight: 400; font-style: normal; font-display: block; src: url('${url}') format('woff2'); }`)
		.join('\n');
	doc.head.appendChild(style);
};

/** The colours a control is drawn in beyond its words and its accent: the same on every host. */
export const PALETTE = {
	/** The line round a field, and a darker one under the pointer. */
	line: 'rgba(0,0,0,0.25)',
	lineHover: 'rgba(0,0,0,0.5)',
	/** The face of a field. */
	field: '#ffffff',
	/** The eyedropper's tooltip's bubble. */
	tip: '#1f2329',
	/** How solid a disabled widget is drawn. */
	disabled: 0.5,
} as const;

/** What a system offers in the monospaced family's place, for a page its file never reaches and for words outside its Latin characters: Safari's own monospaced face, macOS's, Windows's and Linux's, then the browser's. */
const MONO_FALLBACKS = 'ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';

/** A font's families as CSS lists them: its own quoted, then, for the monospaced family (`MONO_FAMILY`), a system's monospaced faces, and for any other Roboto (`FONT_FACES`) and sans-serif. */
export const fontFamilies = (font: Font): string => {
	const own = `"${font.family.replace(/"/g, '')}"`;
	return font.family === MONO_FAMILY ? `${own}, ${MONO_FALLBACKS}` : `${own}, Roboto, sans-serif`;
};

/** A font as a 2D context takes it: its style, weight and size, then its families. */
export const fontString = (font: Font): string => `${font.style === 'italic' ? 'italic ' : ''}${font.weight} ${font.size}px ${fontFamilies(font)}`;

/** A corner radius a box can carry: no more than half its shorter side. */
const clampRadius = (radius: number, box: Box): number => Math.max(0, Math.min(radius, box.w / 2, box.h / 2));

/** Traces a box's rounded outline as the current path. */
const roundedPath = (ctx: CanvasRenderingContext2D, box: Box, radius: number): void => {
	ctx.beginPath();
	ctx.roundRect(box.x, box.y, box.w, box.h, clampRadius(radius, box));
};

/** Clips what is painted next to a box rounded at its corners, until the context is restored. */
export const clipRounded = (ctx: CanvasRenderingContext2D, box: Box, radius: number): void => {
	roundedPath(ctx, box, radius);
	ctx.clip();
};

/**
 * Fills a box, rounded at its corners, in the context's fill style.
 *
 * @param ctx - What is painted into
 * @param box - The box
 * @param radius - How round its corners are; held to half the shorter side
 */
export const fillRounded = (ctx: CanvasRenderingContext2D, box: Box, radius: number): void => {
	if (box.w <= 0 || box.h <= 0) return;
	roundedPath(ctx, box, radius);
	ctx.fill();
};

/**
 * Strokes a line round a box inside its edge, as a border is drawn: the line's
 * outer edge on the box's edge, its corners rounded to follow the box's.
 *
 * @param ctx - What is painted into
 * @param box - The box
 * @param radius - How round the box's corners are
 * @param width - How thick the line is; nothing is drawn for 0, or for a box the line would not fit in
 */
export const strokeInside = (ctx: CanvasRenderingContext2D, box: Box, radius: number, width: number): void => {
	if (width <= 0 || box.w <= width || box.h <= width) return;
	ctx.lineWidth = width;
	ctx.beginPath();
	ctx.roundRect(box.x + width / 2, box.y + width / 2, box.w - width, box.h - width, Math.max(clampRadius(radius, box) - width / 2, 0));
	ctx.stroke();
};

/** The x a line of words starts at, and how the context aligns it, for an alignment within a box. */
const lineStart = (box: Box, align: TextAlignWord): { x: number; textAlign: CanvasTextAlign } =>
	align === 'CENTER' ? { x: box.x + box.w / 2, textAlign: 'center' }
		: align === 'RIGHT' ? { x: box.x + box.w, textAlign: 'right' }
			: { x: box.x, textAlign: 'left' };

/**
 * Draws one line of words, vertically centred in a box, at an alignment
 * within it.
 *
 * @param ctx - What is painted into
 * @param text - The words; nothing is drawn for none
 * @param box - The box the line is centred in, and aligned within
 * @param font - The font
 * @param align - Where the words stand in the box: at its left or right edge, or centred
 * @param colour - What the words are drawn in
 */
export const drawCentred = (ctx: CanvasRenderingContext2D, text: string, box: Box, font: Font, align: TextAlignWord, colour: string): void => {
	if (!text) return;
	const start = lineStart(box, align);
	ctx.font = fontString(font);
	ctx.fillStyle = colour;
	ctx.textAlign = start.textAlign;
	ctx.textBaseline = 'middle';
	ctx.fillText(text, start.x, box.y + box.h / 2);
};

/** What a field's corners and line are read from: the style it is drawn with, which holds what its own style gives (`ResolvedStyle.own`); a colour's picker holds its widget's. */
export type FieldOf = Pick<Laid, 'widget' | 'style'>;

/** How round a field's corners are: the style's own radius where it gives one, 0 among them, else the control's. */
export const fieldRadius = (laid: FieldOf): number => (typeof laid.style.own.borderRadius === 'number' ? laid.style.borderRadius : CONTROL.radius);

/** A field's line: the style's own border where it gives one, 0 among them, else the control's, darker where it is hovered. */
export const fieldLine = (laid: FieldOf, hovered = false): { width: number; colour: string } =>
	typeof laid.style.own.borderWidth === 'number'
		? { width: laid.style.borderWidth, colour: cssColour(laid.style.borderColor) }
		: { width: CONTROL.border, colour: hovered ? PALETTE.lineHover : PALETTE.line };

/**
 * Paints a popover's face, a colour's picker's, over its whole box: a field
 * in its widget's own background, edged and rounded as the widget's field is
 * while it has the focus, which it keeps while its picker is open: its line,
 * the hovered one where it draws the field's own, and the accent's ring over
 * it, so the picker reads apart from whatever it opens over as its widget
 * does.
 *
 * @returns How far in from the box's edge the line and the ring reach (`popoverEdge`)
 */
export const popoverFace = (ctx: CanvasRenderingContext2D, whole: Box, control: FieldOf): number => {
	const radius = fieldRadius(control);
	ctx.fillStyle = control.style.background ? cssColour(control.style.background) : PALETTE.field;
	fillRounded(ctx, whole, radius);
	const line = fieldLine(control, true);
	if (line.width > 0) {
		ctx.strokeStyle = line.colour;
		strokeInside(ctx, whole, radius, line.width);
	}
	ctx.strokeStyle = cssColour(control.style.accent);
	strokeInside(ctx, whole, radius, FOCUS_RING);
	return popoverEdge(control);
};

/**
 * Paints a colour's swatch: a square rounded at its corners, filled with the
 * colour over the checkerboard where the colour has alpha, with a field's
 * line round it, so a swatch the colour of the face it stands on still shows;
 * a colour that does not read leaves the square empty but for its line.
 *
 * @param ctx - What is painted into, its transform the host's pixels
 * @param box - The square
 * @param colour - The colour; null for one that does not read
 * @param radius - How round the square's corners are
 */
export const paintSwatch = (ctx: CanvasRenderingContext2D, box: Box, colour: Colour | null, radius: number): void => {
	if (colour) {
		ctx.save();
		roundedPath(ctx, box, radius);
		ctx.clip();
		if (colour.a < 1) paintChecker(ctx, box, 1);
		ctx.fillStyle = cssColour(colour);
		ctx.fillRect(box.x, box.y, box.w, box.h);
		ctx.restore();
	}
	ctx.strokeStyle = PALETTE.line;
	strokeInside(ctx, box, radius, CONTROL.border);
};


/**
 * Paints a colour widget laid out on its own (`layoutWell`): half as solid
 * where it is disabled; its title above it in the accent colour, cut at its
 * box; its face filled in its background, or the field colour, its line
 * inside its edge, darker where it is hovered, and the accent's ring
 * where it has the focus; its hex at the left of its inner box, cut there,
 * unless it is a well; and its swatch (`paintSwatch`), cut at the face, a
 * well's ring drawn again over it where it has the focus. Its title and its
 * hex are set in the monospaced family (`monoFont`).
 *
 * @param ctx - What is painted into, its transform the well's pixels
 * @param laid - The colour, as laid out
 */
export const paintWell = (ctx: CanvasRenderingContext2D, laid: Laid): void => {
	const { widget, box, face, inner, swatch, style, state } = laid;
	if (box.w <= 0 || box.h <= 0) return;
	ctx.save();
	ctx.globalAlpha = style.opacity * (state.disabled ? PALETTE.disabled : 1);
	if (laid.title && widget.title) {
		// Cut at its box, which a width fixed under the title's own leaves short.
		ctx.save();
		ctx.beginPath();
		ctx.rect(laid.title.x, laid.title.y, laid.title.w, laid.title.h);
		ctx.clip();
		drawCentred(ctx, widget.title, laid.title, monoFont(titleFont(style.font)), 'LEFT', cssColour(style.accent));
		ctx.restore();
	}
	const radius = fieldRadius(laid);
	ctx.fillStyle = style.background ? cssColour(style.background) : PALETTE.field;
	fillRounded(ctx, face, radius);
	const line = fieldLine(laid, state.hovered && !state.disabled);
	ctx.strokeStyle = line.colour;
	strokeInside(ctx, face, radius, line.width);
	if (state.focused) {
		ctx.strokeStyle = cssColour(style.accent);
		strokeInside(ctx, face, radius, FOCUS_RING);
	}
	if (widget.showValue !== false) {
		ctx.save();
		ctx.beginPath();
		ctx.rect(inner.x, inner.y, inner.w, inner.h);
		ctx.clip();
		drawCentred(ctx, state.text, inner, monoFont(style.font), 'LEFT', cssColour(style.color));
		ctx.restore();
	}
	// Cut at the face, which a size fixed smaller than the swatch's room
	// leaves narrower or shorter than the swatch.
	ctx.save();
	ctx.beginPath();
	ctx.rect(face.x, face.y, face.w, face.h);
	ctx.clip();
	paintSwatch(ctx, swatch, parseColour(state.text), CONTROL.iconRadius);
	ctx.restore();
	// A well reaches the focus ring where the field has no padding, so the
	// ring is drawn again over it.
	if (widget.showValue === false && state.focused) {
		ctx.strokeStyle = cssColour(style.accent);
		strokeInside(ctx, face, fieldRadius(laid), FOCUS_RING);
	}
	ctx.restore();
};
