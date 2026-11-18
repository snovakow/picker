/**
 * @fileoverview The picker's public face.
 *
 * On a page: a colour well (`ColourWell`), made from its options, which
 * opens its picker over the page; what the page offers the picker's
 * eyedropper; and the Color Picker dialog (`pickerShow`, `pickerUpdate`).
 *
 * In a host of one's own, a 3D scene or VR among them: the picker
 * (`ColourPicker`) and what it asks of its host (`PickerHost`), the colour
 * widget a host reads from its options and lays out and paints itself
 * (`readColourOptions`, `layoutWell`, `paintWell`), the page's input its
 * fields are typed through (`pageInput`, `InputHost`), and where a picker
 * stands against its colour on a screen (`screenPopoverRect`).
 */

export { ColourWell, SCREEN_ONLY, type ColourWellOptions } from './js/colourWell.ts';
export { PICKER_MODES, readColourOptions, swatchesOf, type ColourOptions, type ColourStyle, type ColourWidget, type PickerMode, type WidgetEvent, type WidgetStyle } from './js/options.ts';
export { ColourPicker, forgetChosenMode, type DropperOffer, type DropperView, type PickerHost, type Uv } from './js/colourPicker.ts';
export { pickerShow, pickerUpdate } from './js/picker.js';

export { layoutWell, restingState, type Box, type Font, type Laid, type ResolvedStyle, type TextMeasure, type WidgetState } from './js/layout.ts';
export { fontString, loadFaces, paintWell } from './js/paint.ts';
export { PageInput, pageInput, pageInputMade, resetPageInput, type InputHost, type InputKind, type InputLook, type InputRect } from './js/input.ts';
export { DRAG_SLOP, TOUCH_SLOP, screenPopoverRect, type ScreenPlace, type ScreenRect } from './js/pointer.ts';
export { formatColour, parseColour } from './js/hex.ts';
