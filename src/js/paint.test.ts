// @vitest-environment jsdom
/**
 * @fileoverview The painting of a colour laid out on its own. jsdom draws
 * nothing, so the context is a recorder: what is painted is kept, in order,
 * and the test reads it back as the calls a colour and its state make. The
 * cases paint each colour alone, and the rounded painters on their own.
 */
import { describe, expect, it } from 'vitest';
import { readColourOptions, type ColourOptions } from './options.ts';
import { CONTROL, DEFAULT_FONT, FOCUS_RING, layoutWell, monoFont, restingState, type Font, type Laid } from './layout.ts';
import { PALETTE, fillRounded, fontFamilies, paintWell, strokeInside } from './paint.ts';

const measure = (text: string, font: Font) => text.length * font.size / 2;

/** One call the painter made, with the style standing when it was made. */
interface Call {
	op: string;
	args: unknown[];
	fill: string;
	stroke: string;
	alpha: number;
	font: string;
	/** The shadow standing: its colour, softness and offsets. */
	shadow: string;
}

/** A context that records each call made on it but `beginPath`, which does nothing, with the style standing as the call is made. */
const recording = () => {
	const calls: Call[] = [];
	const state = { fillStyle: '' as unknown, strokeStyle: '', globalAlpha: 1, font: '', lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter', globalCompositeOperation: 'source-over', shadowColor: 'rgba(0,0,0,0)', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 };
	const shadow = () => `${state.shadowColor}|${state.shadowBlur}|${state.shadowOffsetX}|${state.shadowOffsetY}`;
	const stack: (typeof state)[] = [];
	const record = (op: string) => (...args: unknown[]) => { calls.push({ op, args, fill: state.fillStyle as string, stroke: state.strokeStyle, alpha: state.globalAlpha, font: state.font, shadow: shadow() }); };
	const ctx: Record<string, unknown> = {
		save: () => { stack.push({ ...state }); calls.push({ op: 'save', args: [], fill: state.fillStyle as string, stroke: state.strokeStyle, alpha: state.globalAlpha, font: state.font, shadow: shadow() }); },
		restore: () => { Object.assign(state, stack.pop() ?? state); calls.push({ op: 'restore', args: [], fill: state.fillStyle as string, stroke: state.strokeStyle, alpha: state.globalAlpha, font: state.font, shadow: shadow() }); },
		// A gradient is recorded as its making and its stops, and stands as the fill style where it is set.
		createLinearGradient: (...args: unknown[]) => {
			calls.push({ op: 'createLinearGradient', args, fill: state.fillStyle as string, stroke: state.strokeStyle, alpha: state.globalAlpha, font: state.font, shadow: shadow() });
			return { gradient: args, addColorStop: record('addColorStop') };
		},
		setTransform: record('setTransform'),
		translate: record('translate'),
		clearRect: record('clearRect'),
		beginPath: () => { },
		roundRect: record('roundRect'),
		rect: record('rect'),
		clip: record('clip'),
		fill: record('fill'),
		stroke: record('stroke'),
		fillRect: record('fillRect'),
		fillText: record('fillText'),
		moveTo: record('moveTo'),
		lineTo: record('lineTo'),
		arc: record('arc'),
		ellipse: record('ellipse'),
		drawImage: record('drawImage'),
	};
	for (const key of Object.keys(state) as (keyof typeof state)[]) {
		Object.defineProperty(ctx, key, { get: () => state[key], set: (v) => { (state as Record<string, unknown>)[key] = v; } });
	}
	return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
};

/** A colour widget read from its options and laid out alone at a point. */
const well = (options: ColourOptions, at = { x: 0, y: 0 }): Laid => {
	const read = readColourOptions(options);
	return layoutWell(read, restingState(read), measure, at);
};

/** Paints colours in turn into one recorder. */
const paint = (...laid: Laid[]) => {
	const { ctx, calls } = recording();
	for (const each of laid) paintWell(ctx, each);
	return calls;
};

/** The operations a run of calls made, in order. */
const ops = (calls: Call[]) => calls.map((c) => c.op);

describe('fontFamilies', () => {
	it('follows a font with Roboto and sans-serif, and the monospaced family with a system\'s monospaced faces', () => {
		expect(fontFamilies(DEFAULT_FONT)).toBe('"Roboto", Roboto, sans-serif');
		expect(fontFamilies({ ...DEFAULT_FONT, family: 'Georgia' })).toBe('"Georgia", Roboto, sans-serif');
		expect(fontFamilies(monoFont(DEFAULT_FONT))).toBe('"Roboto Mono", ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace');
	});
});

describe('paintWell', () => {
	it('paints a colour as a field with its swatch left of its hex, the swatch over the checkerboard where the colour has alpha and plain where it has none', () => {
		const solid = well({ value: '#ff8b30', style: { width: 160 } });
		const clear = well({ value: '#ff8b3080', alpha: true, style: { width: 160 } }, { x: 0, y: 50 });
		const calls = paint(solid, clear);
		const swatch = solid.swatch;
		const texts = calls.filter((c) => c.op === 'fillText');
		expect(texts.map((c) => c.args[0])).toEqual(['#ff8b30', '#ff8b3080']);
		expect(texts[0].args[1]).toBe(solid.inner.x);
		expect(swatch.x + swatch.w).toBeLessThanOrEqual(texts[0].args[1] as number);
		const first = calls.indexOf(texts[0]);
		const second = calls.indexOf(texts[1]);
		// The first swatch, after its words and the restore that ends their clip: cut at the face, clipped to its rounded square, filled with the colour, no checkerboard, its line round it.
		expect(ops(calls.slice(first + 2, first + 5))).toEqual(['save', 'rect', 'clip']);
		expect(calls[first + 3].args).toEqual([solid.face.x, solid.face.y, solid.face.w, solid.face.h]);
		const span = calls.slice(first + 5, first + 12);
		expect(ops(span)).toEqual(['save', 'roundRect', 'clip', 'fillRect', 'restore', 'roundRect', 'stroke']);
		expect(calls[first + 12].op).toBe('restore');
		expect(span.filter((c) => c.op === 'roundRect').map((c) => c.args)).toEqual([[swatch.x, swatch.y, swatch.w, swatch.h, CONTROL.iconRadius], [swatch.x + 0.5, swatch.y + 0.5, swatch.w - 1, swatch.h - 1, CONTROL.iconRadius - 0.5]]);
		expect(span.filter((c) => c.op === 'fillRect').map((c) => [c.fill, ...c.args])).toEqual([['rgba(255,139,48,1)', swatch.x, swatch.y, swatch.w, swatch.h]]);
		expect(span[6]).toMatchObject({ stroke: PALETTE.line });
		// The second's has the checkerboard under a half-clear fill.
		const after = calls.slice(second);
		const cells = after.filter((c) => c.op === 'fillRect' && c.fill === 'rgb(142,142,142)');
		expect(cells.length).toBeGreaterThan(0);
		expect(after.filter((c) => c.op === 'fillRect').at(-1)?.fill).toMatch(/^rgba\(255,139,48,0\.50/);
	});

	it('paints a colour that does not show its hex as a well: no words, its colour filling its inner box', () => {
		const filled = well({ value: '#ff8b30', showValue: false, style: { width: 160 } });
		const calls = paint(filled);
		expect(calls.filter((c) => c.op === 'fillText')).toEqual([]);
		expect(calls.filter((c) => c.op === 'fillRect' && c.fill === 'rgba(255,139,48,1)').map((c) => c.args)).toEqual([[filled.inner.x, filled.inner.y, filled.inner.w, filled.inner.h]]);
	});

	it('paints its face in the field colour with its line, darker hovered, the accent\'s ring where it has the focus, its title in the accent, its words in the monospaced family, and half as solid disabled', () => {
		const titled = well({ value: '#ff8b30', title: 'Tint' });
		titled.state.hovered = true;
		titled.state.focused = true;
		const calls = paint(titled);
		expect(calls.find((c) => c.op === 'fill')).toMatchObject({ fill: PALETTE.field, alpha: 1 });
		expect(calls.filter((c) => c.op === 'stroke').slice(0, 2).map((c) => c.stroke)).toEqual([PALETTE.lineHover, 'rgba(47,111,214,1)']);
		expect(calls.filter((c) => c.op === 'roundRect')[2].args).toEqual([titled.face.x + FOCUS_RING / 2, titled.face.y + FOCUS_RING / 2, titled.face.w - FOCUS_RING, titled.face.h - FOCUS_RING, CONTROL.radius - FOCUS_RING / 2]);
		expect(calls.filter((c) => c.op === 'fillText').map((c) => [c.args[0], c.fill])).toEqual([['Tint', 'rgba(47,111,214,1)'], ['#ff8b30', 'rgba(27,31,36,1)']]);
		const mono = fontFamilies(monoFont(DEFAULT_FONT));
		expect(calls.filter((c) => c.op === 'fillText').map((c) => c.font)).toEqual([`400 12px ${mono}`, `400 16px ${mono}`]);
		const off = well({ value: '#ff8b30', disabled: true });
		off.state.hovered = true;
		const dim = paint(off);
		expect(dim.find((c) => c.op === 'fill')).toMatchObject({ alpha: PALETTE.disabled });
		expect(dim.find((c) => c.op === 'stroke')).toMatchObject({ stroke: PALETTE.line });
	});
});

describe('the rounded painters', () => {
	it('fill a box with its radius held to half its shorter side, and stroke inside its edge', () => {
		const { ctx, calls } = recording();
		ctx.fillStyle = 'red';
		fillRounded(ctx, { x: 0, y: 0, w: 10, h: 4 }, 100);
		expect(calls.map((c) => [c.op, ...c.args])).toEqual([['roundRect', 0, 0, 10, 4, 2], ['fill']]);
		calls.length = 0;
		strokeInside(ctx, { x: 10, y: 10, w: 20, h: 20, }, 4, 2);
		expect(calls.map((c) => [c.op, ...c.args])).toEqual([['roundRect', 11, 11, 18, 18, 3], ['stroke']]);
		calls.length = 0;
		strokeInside(ctx, { x: 0, y: 0, w: 1, h: 1 }, 0, 2);
		fillRounded(ctx, { x: 0, y: 0, w: 0, h: 1 }, 0);
		expect(calls).toHaveLength(0);
	});
});
