/**
 * @fileoverview A colour widget's colours as hex: a colour written as hex
 * read into its channels, and a colour written as hex as a script reads it.
 *
 * Pure, importing nothing.
 */

/**
 * A colour written as hex, read into its channels: `#rgb`, `#rgba`,
 * `#rrggbb` or `#rrggbbaa`, the `#` optional, each channel 0 to 1. Null for
 * anything else, which is refused rather than written as black.
 */
export const parseColour = (text: string): { r: number; g: number; b: number; a: number } | null => {
	const hex = text.trim().replace(/^#/, '');
	const wide = hex.length === 3 || hex.length === 4 ? hex.split('').map((c) => c + c).join('') : hex;
	if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(wide)) return null;
	const channel = (i: number) => parseInt(wide.slice(i, i + 2), 16) / 255;
	return { r: channel(0), g: channel(2), b: channel(4), a: wide.length === 8 ? channel(6) : 1 };
};

/** A colour as a script reads it: `#rrggbb`, with the alpha as `#rrggbbaa` where it is below 1. */
export const formatColour = (colour: { r: number; g: number; b: number; a?: number }): string => {
	const hex = (channel: number) => Math.round(Math.min(Math.max(channel, 0), 1) * 255).toString(16).padStart(2, '0');
	const rgb = '#' + hex(colour.r) + hex(colour.g) + hex(colour.b);
	return colour.a === undefined || colour.a >= 1 ? rgb : rgb + hex(colour.a);
};

