/**
 * @fileoverview The picker's public face.
 *
 * On a page: a colour well (`ColourWell`), made from its options; the page's
 * picker it joins (`PagePicker`, the page's own from `pagePicker`), which
 * opens on one well at a time, in the page or in a window of its own
 * (`Docking`); the eyedropper it shows (`Eyedropper`); and the Color Picker
 * dialog (`pickerShow`, `pickerUpdate`).
 *
 * In a host of one's own, a 3D scene or VR among them: the picker
 * (`ColourPicker`) and what it asks of its host (`PickerHost`), the colour
 * widget a host reads from its options and lays out and paints itself
 * (`readColourOptions`, `layoutWell`, `paintWell`), the page's input its
 * fields are typed through (`pageInput`, `InputHost`), and where a picker
 * stands against its colour on a screen (`screenPopoverRect`).
 */

export { ColourWell, type ColourWellOptions } from './js/colourWell.ts';
export { DOCKINGS, PagePicker, pagePicker, type Docking, type PagePickerOptions } from './js/pagePicker.ts';
export { PICKER_MODES, readColourOptions, swatchesOf, type ColourOptions, type ColourStyle, type ColourWidget, type PickerMode, type WidgetEvent, type WidgetStyle } from './js/options.ts';
export { ColourPicker, EYEDROPPER_MODES, forgetChosenMode, type CustomPick, type DropperView, type Eyedropper, type EyedropperMode, type PickerHost, type Uv } from './js/colourPicker.ts';
export { DROPPER_TIPS, type DockButton } from './js/pickerView.ts';
export { pickerShow, pickerUpdate } from './js/picker.js';

export { layoutWell, restingState, type Box, type Font, type Laid, type ResolvedStyle, type TextMeasure, type WidgetState } from './js/layout.ts';
export { fontString, loadFaces, paintWell } from './js/paint.ts';
export { PageInput, pageInput, pageInputMade, resetPageInput, type InputHost, type InputKind, type InputLook, type InputRect } from './js/input.ts';
export { DRAG_SLOP, TOUCH_SLOP, screenPopoverRect, type ScreenPlace, type ScreenRect } from './js/pointer.ts';
export { formatColour, parseColour } from './js/hex.ts';
