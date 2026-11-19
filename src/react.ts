/**
 * @fileoverview The picker in React: a colour well as a component
 * (`ColourWell`), made as it mounts and let go as it unmounts, so a page
 * rendered on a server first renders it without touching the document.
 * React is the app's own, which the picker leaves to it: only this entry
 * and React Three Fiber's (r3f.ts) import it.
 */

export { ColourWell, type ColourWellProps } from './js/reactWell.ts';
