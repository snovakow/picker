/**
 * @fileoverview A colour widget read from its options (`readColourOptions`),
 * each widget read on its own, as a typed caller and an untyped script give
 * them.
 */
import { describe, expect, it } from 'vitest';
import { PICKER_MODES, SWATCHES_MAX, readColourOptions, type ColourOptions } from './options.ts';

/** Options as an untyped script may give them. */
const loose = (options: Record<string, unknown>) => options as ColourOptions;

describe('readColourOptions', () => {
	it('reads its value as `formatColour` writes one, black where it does not read, its alpha kept only where it carries one, its picker\'s mode as given and left out for a word outside them, and its swatches read, capped and absent by default', () => {
		const [plain, bad, alpha, dropped, named, square, sliders, wheel, many] = [
			{ value: '#ABC' },
			loose({ value: 'reddish', mode: 'round', swatches: 'none' }),
			{ value: '#11223380', alpha: true, swatches: ['#44556680', '#789'] },
			{ value: '#11223380', swatches: ['#44556680'] },
			{ mode: 'names' as const },
			{ mode: 'square' as const },
			{ mode: 'sliders' as const },
			{ mode: 'wheel' as const },
			{ swatches: Array.from({ length: 40 }, (_, i) => `#0000${(i + 10).toString(16).padStart(2, '0')}`) },
		].map((options) => readColourOptions(options));
		expect(plain).toEqual({ value: '#aabbcc' });
		expect(bad).toEqual({ value: '#000000' });
		expect(alpha).toEqual({ value: '#11223380', alpha: true, swatches: ['#44556680', '#778899'] });
		expect(dropped).toEqual({ value: '#112233', swatches: ['#445566'] });
		expect(named).toEqual({ value: '#000000', mode: 'names' });
		expect(square).toEqual({ value: '#000000', mode: 'square' });
		expect(sliders).toEqual({ value: '#000000', mode: 'sliders' });
		expect(wheel).toEqual({ value: '#000000', mode: 'wheel' });
		expect(many.swatches).toHaveLength(SWATCHES_MAX);
		expect(PICKER_MODES).toEqual(['wheel', 'square', 'sliders', 'names']);
	});

	it('shows its hex unless its options turn it off, which it keeps as false', () => {
		const [shown, said, well] = [{ value: '#ff8b30' }, { value: '#ff8b30', showValue: true }, { value: '#ff8b30', showValue: false }].map((options) => readColourOptions(options));
		expect(shown.showValue).toBeUndefined();
		expect(said.showValue).toBeUndefined();
		expect(well.showValue).toBe(false);
	});

	it('reads its title, whether it starts disabled, and its style key by key: lengths of 0 or more, colours as hex into their channels, the weight and the opacity held to their ranges, and anything else left out', () => {
		const titled = readColourOptions(loose({ title: 'Tint', disabled: true, style: { fontSize: 20, borderRadius: -1, fontWeight: 1200, opacity: 2, fontStyle: 'oblique', fontFamily: '  Georgia ', accent: '#ff0000', color: { r: 1, g: 0, b: 0 }, flavour: 'sweet' } }));
		expect(titled).toEqual({ value: '#000000', title: 'Tint', disabled: true, style: { fontSize: 20, fontWeight: 900, opacity: 1, fontFamily: 'Georgia', accent: { r: 1, g: 0, b: 0, a: 1 } } });
		expect(readColourOptions(loose({ style: { flavour: 'sweet' } }))).toEqual({ value: '#000000' });
	});

	it('reads whatever a script gives it as a widget, nothing as black', () => {
		expect(readColourOptions()).toEqual({ value: '#000000' });
		expect(readColourOptions(null as unknown as ColourOptions)).toEqual({ value: '#000000' });
		expect(readColourOptions('#ff8000' as unknown as ColourOptions)).toEqual({ value: '#000000' });
		expect(readColourOptions(loose({ value: 0xff8000, alpha: 'yes', title: 7, disabled: 'true' }))).toEqual({ value: '#000000' });
	});
});
