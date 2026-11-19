/**
 * @fileoverview The picker in a three.js scene: a colour well on a plane and
 * its picker on another below it, under WebGLRenderer or WebGPURenderer and
 * in VR (`ColourWell3D`), handed the rays of the app's pointers, a mouse's or
 * a controller's. three.js is the app's own, which the picker leaves to it:
 * only this entry and React Three Fiber's (r3f.ts) import it.
 */

export { ColourWell3D, PIXEL_SIZE, type ColourWell3DOptions } from './js/colourWell3D.ts';
