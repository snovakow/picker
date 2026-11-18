/**
 * @fileoverview A colour widget's colours as hex: a colour written as hex
 * read into its channels, and a colour written as hex as a script reads it.
 */
import { describe, expect, it } from 'vitest';
import { formatColour, parseColour } from './hex.ts';

describe('a colour as text', () => {
	it('writes a colour as six hex digits where the alpha is 1, and as eight where it is less', () => {
		expect(formatColour({ r: 1, g: 0.5, b: 0, a: 1 })).toBe('#ff8000');
		expect(formatColour({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('#00000080');
	});

	it('reads a colour from hex, short or long, with or without alpha, and refuses anything else', () => {
		expect(parseColour('#ff8000')).toEqual({ r: 1, g: 128 / 255, b: 0, a: 1 });
		expect(parseColour('#0f08')).toEqual({ r: 0, g: 1, b: 0, a: 136 / 255 });
		expect(parseColour('reddish')).toBeNull();
	});
});
