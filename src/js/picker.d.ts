/**
 * @fileoverview Picker - Color picker interface and type definitions
 * 
 * Provides TypeScript type definitions for the color picker functionality.
 */

type ColorArray4 = [number, number, number, number];

/**
 * Displays color picker interface for interactive color selection
 * @param view - HTML element to attach the color picker to
 * @param color - Initial RGBA color values
 * @param doneCallback - Optional callback when color selection is complete
 * @param updateCallback - Optional callback for real-time color updates
 * @param caller - Optional caller reference; pickerUpdate applies only updates given a caller loosely equal (`==`) to it
 */
export function pickerShow(
	view: HTMLElement,
	color: ColorArray4,
	doneCallback?: (color: ColorArray4) => void,
	updateCallback?: (color: ColorArray4) => void,
	caller?: any
): void;

/**
 * Updates color picker with new color values, only while it is shown and only
 * if `caller` loosely equals (`==`) the caller given to pickerShow; otherwise
 * does nothing
 * @param color - New RGBA color values to display
 * @param caller - Optional caller reference, compared with the one given to pickerShow
 */
export function pickerUpdate(color: ColorArray4, caller?: any): void;
