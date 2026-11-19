/**
 * @fileoverview The picker in React Three Fiber: a colour well in the scene
 * as a component (`ColourWell3D`), its colour and its picker on planes,
 * worked by Fiber's pointer events, under WebGLRenderer or WebGPURenderer
 * and in VR. React, three.js and Fiber are the app's own, which the picker
 * leaves to it.
 */

export { ColourWell3D, rendererOfScene, type ColourWell3DProps } from './js/r3fWell.ts';
