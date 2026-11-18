/**
 * @fileoverview Vite configuration for the picker's demo page.
 *
 * Serves `index.html` at the repository's root, whose script is
 * `demo/main.ts`, and builds it into `dist/` with relative asset paths so the
 * built page can be served from any folder.
 */
import { defineConfig } from 'vite';

export default defineConfig({
	base: '',
});
