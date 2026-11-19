/**
 * @fileoverview The picker's public faces where there is no document, as on
 * a server rendering a page before a browser runs it: every module each
 * gathers loads with no document or window, making nothing as it loads, the
 * main face's and React's, three.js's and React Three Fiber's adapters among
 * them; the dialog, which is made as it is first shown, is not made by an
 * update that comes before it is; and React's colour well renders the
 * element it stands in alone, making none of the well.
 */
import { describe, expect, it } from 'vitest';

describe('the picker on a server', () => {
	it('loads with no document or window', async () => {
		expect(typeof document).toBe('undefined');
		expect(typeof window).toBe('undefined');
		const picker = await import('./index.ts');
		expect(picker.ColourWell).toBeTypeOf('function');
		expect(picker.pickerShow).toBeTypeOf('function');
	});

	it('loads its adapters with no document or window: React\'s, three.js\'s and React Three Fiber\'s', async () => {
		expect((await import('./react.ts')).ColourWell).toBeDefined();
		expect((await import('./three.ts')).ColourWell3D).toBeTypeOf('function');
		expect((await import('./r3f.ts')).ColourWell3D).toBeDefined();
	});

	it('takes an update to the dialog before it is shown, doing nothing', async () => {
		const { pickerUpdate } = await import('./index.ts');
		expect(() => pickerUpdate([255, 0, 0, 1])).not.toThrow();
	});

	it('renders React\'s colour well as the element it stands in, the well made only as the browser mounts it', async () => {
		const { createElement } = await import('react');
		const { renderToString } = await import('react-dom/server');
		const { ColourWell } = await import('./react.ts');
		expect(renderToString(createElement(ColourWell, { value: '#ff8b30', className: 'tint' }))).toBe('<span class="tint"></span>');
	});
});
