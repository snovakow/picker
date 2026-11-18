/**
 * @fileoverview Vitest configuration for the picker's tests.
 *
 * Runs every *.test.ts file under src/, in a Node environment (no browser
 * DOM) unless a test asks for jsdom. An import written without an
 * extension is tried as `.ts`, then `.js`.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		// A test that needs a DOM declares `// @vitest-environment jsdom` on its
		// first line; the default stays node so the pure modules stay honest.
		include: ['src/**/*.test.ts'],
		globals: false,
	},
	resolve: {
		// Extensionless imports: .ts first, then .js
		extensions: ['.ts', '.js'],
	},
});
