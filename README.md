# picker

Color Picker: colour wells that share one picker with an eyedropper, the Color Picker dialog, and
a demo page. It is on its way to becoming a library: a page uses the wells and the picker they
share, in React among them; a three.js or React Three Fiber scene, or VR, a well of its own on
planes; and a host of its own can show the picker itself.

## Running it

```sh
npm install
npm run dev          # the demo page, on Vite's dev server
npm test             # vitest
npx tsc --noEmit     # types, tests and the demo included
npm run build        # the demo, built into dist/
```

The demo page holds a colour well for each kind of colour its options make and one that sets
its own eyedropper, the Color Picker dialog opened from a button, a view of flat colours of
known bytes over gradients for the eyedropper to pick from, a switch of the picker's eyedropper,
one of where it stands and one of what draws its wheel, and a log of what the wells and the
dialog tell. It uses the picker only through `src/index.ts`, as a page would.

## A colour well on a page

```ts
import { ColourWell } from './src/index.ts';

const well = new ColourWell({
	value: '#ff8b30',
	alpha: true,
	mode: 'wheel',
	swatches: ['#ff8b30', '#2f6fd6'],
	title: 'Tint',
	style: { accent: '#c2410c', borderRadius: 12 },
	onEvent: (event, well) => { if (event === 'change') console.log(well.value); },
});
document.body.appendChild(well.canvas);
```

Every option may be left out, and one that does not read is dropped:

| Option | What it does |
|---|---|
| `value` | The colour it starts on, as hex (`#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`); black where it does not read |
| `alpha` | Whether the colour carries an alpha: the picker offers an alpha bar and field |
| `mode` | The mode the picker opens in, `wheel`, `square`, `sliders` or `names`, until the viewer chooses one on a picker's tabs, which every picker then opens in |
| `swatches` | The colour's own swatches, as hex, offered under the picker's fields |
| `title` | A title drawn above the well in the accent colour |
| `showValue` | `false` fills the field with the colour rather than writing its hex beside a swatch |
| `disabled` | Whether it starts unable to be used |
| `style` | Its size, room, font, colours (as hex), line and corners, and opacity (`ColourStyle`) |
| `onEvent` | Told `click`, `change` as a colour is taken, and `enter` and `leave` as the pointer comes onto or goes off the well or its picker |
| `eyedropper` | The eyedropper the picker shows for this well, over the picker's own (below); the picker's where it is left out |
| `picker` | The page's picker the well joins (below); the page's own where it is left out |

A script reads and writes the colour through `value` and `setValue`, its swatches through
`setSwatches`, and whether it can be used through `disabled`; `openPicker` and `closePicker`
open and shut the picker on the well, and `open` says whether it is; `setEyedropper` sets the
well's own eyedropper, or with `null` gives it the picker's; and `dispose` takes the well and
its listeners away.

The well's pixels are the page's: the picker stands over the page against the well's face, and
the page's input, which the picker's fields are typed through, is placed in the body's pixels,
so the page's body is positioned (`position: relative`).

The tab names and the colour names are set in Roboto, or the face the style names; every other
word is in Roboto Mono, so a hex, a channel's number and a percentage keep their columns as
they change. Both ship with the picker (`src/css/fonts/`, where their licences and how they
were cut are noted).

## The picker the wells share

A page has one picker (`pagePicker()`, a `PagePicker`), which every well joins unless its
options name another, and it is open on one well at a time. A click on a well opens it there,
moving it from another well, or shuts it where it is open on that well. It stays open as the
focus goes elsewhere on the page, and a press on it gives its well the focus back. It shuts
only as its well is clicked again; as its close, Escape while it has the focus, or a script
shuts it, each keeping the colour as it stands; and as its well is disabled, taken off the page
or hidden, by `display: none` or `visibility: hidden` on the well or what holds it. A well
scrolled out of sight keeps its picker open. A second picker, made with `new PagePicker()`,
serves the wells that name it, and one opening shuts the other.

```ts
import { ColourWell, pagePicker } from './src/index.ts';

const picker = pagePicker();
picker.setDocking('popout');
picker.setEyedropper({ mode: 'disabled' });
const fill = new ColourWell({ value: '#2f6fd6' });
const line = new ColourWell({ value: '#1b1f24', eyedropper: { mode: 'screen' } });
document.body.append(fill.canvas, line.canvas);
picker.open(fill);
```

A script opens it on a well with `open` and shuts it with `close`, and reads the well that has
the focus (`well`) and the one it is open on (`openWell`). It sets the eyedropper every well
shows unless the well sets its own (`setEyedropper`), and where the picker stands
(`setDocking`), and in `auto` pops it out and docks it back as its button does (`popOut`,
`dock`, `poppedOut`). It sets what draws its wheel (`setRenderer`, below). `dispose` takes the
picker away, its wells with no picker after it.

Where it stands is its docking:

| Docking | Where the picker stands |
|---|---|
| `auto`, the default | In the page, against the well's face, with a button beside its close that pops it out into a window of its own, where the button docks it back; the viewer's choice holds for the next opening |
| `in-view` | In the page alone |
| `popout` | In a window of its own alone |

The picker's window opens beside the well as the picker opens, sized to the picker, and shuts as
the picker shuts. It stays as the picker moves to another well and as the focus leaves the
wells, and the next opens where the viewer left the last; the viewer shutting it shuts the
picker. A field in the window is typed through an input of the window's own, and a key pressed
in the window works the picker as one on the well does, the well taking the focus back where it
went elsewhere. A browser opens such a window only for a click, so where it refuses one, the
picker stands in the page: in `auto` as though docked, and in `popout` until it shuts.

## In React

`src/react.ts` gives the well as a React component (`ColourWell`), which joins the page's
picker as any well does:

```tsx
import { ColourWell } from './src/react.ts';

function Tint() {
	const [tint, setTint] = useState('#ff8b30');
	return <ColourWell value={tint} onChange={setTint} swatches={['#ff8b30', '#2f6fd6']} />;
}
```

Its props are the well's options, with `value` written to the well as it changes, `defaultValue`
where it is left out, `onChange` told each colour the viewer takes, `onEvent` every event, and
`className` for the element its canvas stands in. Its ref is the well itself, null until it is
made. The well is made as the component mounts and let go as it unmounts, so a server
rendering the page renders the element alone. A change of the colour's kind or look (`alpha`,
`mode`, `title`, `showValue`, `style`) or of `picker` makes a new well; the rest is written to
the one there is.

## In a three.js scene, and VR

`src/three.ts` gives a well that stands in a three.js scene (`ColourWell3D`, a `Group`): its
colour on a plane at its origin, and its picker on a plane below it as it opens, under
`WebGLRenderer` or `WebGPURenderer`. It lays itself out in pixels of its own, each `pixelSize`
of the scene's units across, a millimetre by default for a scene in metres, as VR's is, and
paints its textures at `resolution` texture pixels to one of its own, 2 by default.

```ts
import { ColourWell3D } from './src/three.ts';

const well = new ColourWell3D({
	value: '#ff8b30',
	renderer: 'webgpu',
	onEvent: (event, well) => { if (event === 'change') paint.color.set(well.value); },
});
well.position.set(0, 1.4, -0.6);
scene.add(well);
well.listen(renderer.domElement, camera);
```

`listen` has the well take the pointer on the renderer's canvas itself, each event's ray cast
from the camera, a press it takes going no further, so the app's own controls listening on the
canvas after it don't see it. An app with its own pointers, VR's controllers among them, hands
the well their rays in world space instead, each by an id of its own:

```ts
const ray = new THREE.Ray();
const rayOf = (controller: THREE.Object3D) => {
	ray.origin.setFromMatrixPosition(controller.matrixWorld);
	ray.direction.set(0, 0, -1).transformDirection(controller.matrixWorld);
	return ray;
};
controller.addEventListener('selectstart', () => well.pointerDown(rayOf(controller), 1));
controller.addEventListener('selectend', () => well.pointerUp(rayOf(controller), 1));
// Each frame:
well.pointerMove(rayOf(controller), 1);
```

A press held moves along the plane it went down on wherever the ray goes, off its edges
among them, and one let go unmoved where it went down is a click. One well's picker opening
shuts another's, and a press on neither plane (`pointerMissed`, or a ray that misses both) lets
the well's focus go, the picker staying open, as on a page. The well paints again as it
changes, and asks the app for a frame (`requestRender`) for an app that renders on demand. The
page's input takes its keys and its typing, placed over the field typed into as the view shows
it (`setView`, which `listen` sets), and out of sight with no view, as in VR, where the typing
shows in the field the picker paints. Its value, swatches, `disabled`, eyedropper and renderer
are read and written as a page's well's are, and `dispose` lets it go.

Its colours show true under `WebGLRenderer` whatever its tone mapping. three.js's
`WebGPURenderer` tone-maps the whole frame as it draws it out, a material's `toneMapped` left
unread, so the well shows true there only with no tone mapping (`NoToneMapping`, three.js's
default); with any other, the well warns once. In Chrome on 2026-11-19, under React Three
Fiber's default tone mapping, ACES Filmic, the picker's white showed as 226 of 255, and its
green, `#00ff00`, as `#93e459`.

## In React Three Fiber

`src/r3f.ts` gives the three.js well as a component in a Fiber Canvas (`ColourWell3D`), worked
by Fiber's pointer events:

```tsx
import { ColourWell3D } from './src/r3f.ts';

<Canvas flat>
	<ColourWell3D value={tint} onChange={setTint} position={[0, 1.4, -0.6]} />
</Canvas>
```

Its props are the three.js well's options, with `value`, `defaultValue`, `onChange` and
`onEvent` as React's well takes them, and `position`, `rotation` and `scale` as a group's; its
ref is the well. Its wheel is drawn by WebGPU under a `WebGPURenderer` drawing by WebGPU, and
by WebGL otherwise, unless `renderer` says. A press it takes is captured and stops there, a
press on nothing lets its focus go, the page's input is placed through Fiber's camera, and it
asks Fiber for a frame as it paints, so a Canvas rendering on demand shows it. A change of the
colour's kind or look, `pixelSize` or `resolution` makes a new well. Fiber's Canvas tone-maps by
default; `flat` turns it off, which a `WebGPURenderer` needs for the well's colours to show
true.

React, three.js and Fiber are the app's own: only these entries import them, and the main one
(`src/index.ts`) imports none of them.

## Hosting the picker yourself: 3D and VR

`ColourPicker` is the picker on its own: it holds what is open and what a press on it holds,
paints itself into a 2D canvas of its own, which a host shows however it draws, as a texture in
a WebGL or a WebGPU scene among them, and asks its host (`PickerHost`) for the rest: the
widget's state and layout, where the picker stands and what it is drawn on, the page's input,
the events it tells, and the eyedropper it sets. A page's picker (`PagePicker`) is one host,
serving the page's wells, and a three.js well (`ColourWell3D`, above) another, drawing its colour
and picker on planes. A host of one's own that does so, in a scene of another engine or in VR:

- it reads its colour widget from options (`readColourOptions`), lays it out and paints it
  where it likes (`layoutWell`, `paintWell`), and shows the picker's canvas on a plane of its
  own, which it updates as the picker tells it the canvas was painted (`popoverPainted`);
- it hands the picker the points a ray hits: a press, a click or the pointer over the picker
  as a point of its plane (`Uv`: from its left and up from its foot, each 0 to 1), and a held
  press's moves and release in the host's own pixels;
- it gives the colour the page's input as a page's picker does (`pageInput`, `InputHost`),
  placing the input where it suits; where the page goes out of sight, as it does for VR, an
  embedder asks the focused host to put a field's typing away (`putAway`);
- it sets each colour's eyedropper (`dropperOf`): in `view`, its own view, whatever object it
  likes, takes the eyedropper's presses and hands the colour under them to the picker
  (`takeDropped`); in `custom`, its own pick, a ray's hit on a texture among them, hands the
  picker each colour it reads (`take`);
- it may show the dock button and answer it (`dockButton`, `dockClicked`), and give the
  picker an input of its own where the picker stands in another document (`fieldInput`), as a
  page's picker does for its window; a host in a 3D scene needs neither;
- it may set what draws the picker's wheel (`renderer`, below), WebGL where it sets none.

A host keeps the order the picker's behaviour rests on, which `colourPicker.ts`'s header
lists: when a press is forgotten before its click, when the picker is laid out again, and what
shutting it does, in order. The picker's own tests run it on a stand-in for such a host, which
draws on planes and hits them with points of a plane (`TestPanel` in `colourPicker.test.ts`).

## What draws the wheel

The picker draws its wheel and triangle on the GPU and copies them into its own canvas as it
paints. What draws them is its renderer (`Renderer`): `webgl`, the default, or `webgpu`. A
page's picker takes it as an option (`new PagePicker({ renderer: 'webgpu' })`) or from
`setRenderer`, and another host sets it as `renderer`, so a page or a scene that draws by one
has the wheel drawn the same way. Every picker shares one renderer of each kind, made on a
canvas of its own as the first wheel asks for it.

Where the renderer set can't be had, as where the browser gives it no context, the other draws
the wheel, and with neither the picker shows no wheel. A renderer whose context comes later
leaves the wheel out until it comes, and the picker is painted again as it does. One whose
context is lost is made again as the next wheel asks; one whose context never came is not asked
for again.

WebGL's renderer has its context as it is made. WebGPU's asks the browser for an adapter and a
device of its own as it is made, so the first wheel asked of it is left out until the device
comes, about a tenth of a second in Chrome, and the picker is painted again with it; where the
browser offers no WebGPU, or no adapter or device comes, WebGL draws the wheel from then on. Its
shaders are WebGL's written in WGSL, blended and kept as WebGL's are, so the two draw the same
wheel: in Chrome on 2026-11-18, on Apple's Metal, the picker drawn by each differed in 6 of its
354,816 pixels, each by 1 of 255.

In a three.js scene the picker's canvas is a texture under either renderer, `WebGLRenderer`
or `WebGPURenderer`, as the three.js well shows it:

```ts
const texture = new THREE.CanvasTexture(picker.canvas);
texture.colorSpace = THREE.SRGBColorSpace;
const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false });
```

The host sets `texture.needsUpdate` as the picker tells it the canvas was painted
(`popoverPainted`), and makes a new texture where it says the canvas was resized. A ray's hit
on the plane gives the `uv` the picker takes as a point of its plane. The picker's renderer is
set to match the scene's: `webgl` under `WebGLRenderer`, `webgpu` under `WebGPURenderer`. This
was checked in Chrome on 2026-11-19 with three.js r187 and React Three Fiber 9.8, under each
renderer, `WebGPURenderer` running on WebGPU itself: a click on the well opened its picker,
a click on its ring and a drag carried far past its edge set the colour there, typing into its
hex field set it, a press beside it let its focus go, and under `WebGPURenderer` the page made
no WebGL context at all. Its colours showed true to their bytes under both, but for
`WebGPURenderer` tone-mapping (above).

## The eyedropper

The eyedropper stands at the right end of the picker's hex row. Its mode (`Eyedropper`) is the
picker's, the screen unless the picker sets another, where the well the picker is open on sets
none of its own:

| Mode | What it picks from | A click on it | Its tooltip |
|---|---|---|---|
| `screen` | Anywhere on the screen, through the browser's own eyedropper (Chrome and Edge on a computer); in another browser, the `view` given beside it, and with no view nothing, the eyedropper drawn unavailable | Opens the browser's eyedropper, whose Escape takes nothing; falling back, as `view`; unavailable, shows its tooltip | Pick a colour from anywhere on the screen; falling back, Pick a colour from the view. Picking from anywhere on the screen needs Chrome or Edge on a computer; unavailable, Picking a colour from anywhere on the screen needs Chrome or Edge on a computer |
| `view` | A surface the app provides, such as a video feed (`DropperView`) | Arms it on the view: the view's next press takes the colour under the pointer as it goes down and moves, and puts the eyedropper away as it is let go; a second click puts it away | Pick a colour from the view, or the app's own words (`tip`) |
| `custom` | What the app picks from by its own means, where the picker cannot reach it | Calls the app's `pick(take, signal)`, the eyedropper drawn armed until the app is done; a second click puts it away | Pick a colour, or the app's own words (`tip`) |
| `disabled` | Nothing | There is none: the hex field reaches the end of its row | None |

An unavailable eyedropper is drawn half as solid rather than left out, so that a viewer in
another browser learns from its tooltip that it works in Chrome or Edge on a computer.

In `custom`, the app hands the picker each colour it reads, as hex, through `take(colour)`, as
often as it likes, so a drag over its target shows the colour as it goes; `take(colour, true)`
hands the last, and `take(null, true)` ends with none. `signal` aborts where the eyedropper is
put away first, and a take after that does nothing. While the app's pick is armed, a press
anywhere on the page but the picker and its wells is the app's, and the page's input keeps its
focus through it.

A colour it takes is taken as a named cell's is: its bytes, the alpha the colour carries kept.
Each colour taken tells `change` where it changes the colour. The tooltip shows while the
pointer is over the eyedropper or the tooltip, while the eyedropper is armed, and, where it is
unavailable, pinned open by a click on it until a second click; the last two are what a touch
sees, having no pointer over it. A press anywhere else on the picker puts an armed eyedropper
or a pinned tooltip away, and works as ever; so do the picker shutting, which Escape does, and
the eyedropper changing, unless from one view to another. A press on the tooltip itself leaves
it standing for the click after, which puts it away and clicks nothing under it. A refusal of
the browser's eyedropper other than its Escape is thrown with the browser's cause.

A page's view is an element of the page and what it draws at a point (`DropperView`). Its
press is taken ahead of the view's own listeners, the click after it swallowed, and the page's
input keeps its focus through it; the view's cursor is a crosshair while the eyedropper is
armed on it.

## On a server

The picker can be imported where there is no document, as a framework that renders a page on
a server before the browser runs it, Next.js or Remix among them, imports it: none of its
modules touches the document, the window, a canvas or the GPU as it loads. The Color Picker
dialog is made as it is first shown, so a page that never shows it makes none of it, its
wheel's WebGL context among it. What it makes needs the browser: a well, a page's picker and
the dialog are made there, as a React component makes them in an effect, which a server does
not run. It is imported through a bundler, which takes its stylesheet (`picker.css`), as each
such framework has.

## What it holds

| File | What it is |
|---|---|
| `src/index.ts` | The public face: what a page and a host import |
| `src/react.ts`, `src/three.ts`, `src/r3f.ts` | The adapters' faces: React's, three.js's and React Three Fiber's, the only ones that import them |
| `src/js/colourWell.ts` | A colour well on a page: the colour on a canvas of its own, joining the page's picker |
| `src/js/reactWell.ts`, `src/js/same.ts` | The page's well as a React component, and a prop held the same across renders for both components |
| `src/js/colourWell3D.ts` | A colour well in a three.js scene: its colour and its picker on planes, the picker's host, worked by rays |
| `src/js/r3fWell.ts` | The three.js well as a React Three Fiber component, worked by Fiber's pointer events |
| `src/js/pagePicker.ts` | The page's picker: one picker the page's wells share, open on one at a time, in the page or in a window of its own, with the presses on its eyedropper's view |
| `src/js/colourPicker.ts` | The picker as it runs: what is open, a press on it, its keys, its fields, its eyedropper, its painting, each worked through its host |
| `src/js/pickerView.ts` | The picker's layout, regions, colour maths and painting, the eyedropper's among them |
| `src/js/wheel.ts` | The colour wheel and triangle: their maths, and what a renderer draws them from |
| `src/js/renderer.ts` | What draws the wheel, WebGL or WebGPU: one shared renderer of each, the other drawing where the one set can't be had |
| `src/js/wheelWebGL.ts` | The wheel drawn by WebGL |
| `src/js/wheelWebGPU.ts` | The wheel drawn by WebGPU: WebGL's shaders in WGSL, on a device asked of the browser |
| `src/js/colour.ts` | The colour maths, the standard colours, the channel bars, the checkerboard |
| `src/js/options.ts` | A colour widget's options, and the widget they are read into |
| `src/js/layout.ts` | The box, font, style and state types, a widget's measures and its style resolved, a colour widget laid out on its own |
| `src/js/paint.ts` | The faces the words are set in, the palette, the rounded fill and inset stroke, a field's line and corners, a popover's face, a swatch, a colour widget painted on its own |
| `src/js/input.ts` | The page's input, which a picker's fields are typed through, shown over the field that has it |
| `src/js/pointer.ts` | How far a press moves before it is a drag, and where a picker stands on a screen |
| `src/js/hex.ts` | A colour as hex, read and written |
| `src/js/picker.js`, `picker.d.ts`, `src/css/picker.css` | The Color Picker dialog |
| `src/css/fonts/` | Roboto for the picker's tab and colour names and Roboto Mono for every other word: the regular weight of each, cut to Latin as WOFF2, with their licences |

## Tests

Each module's tests stand beside it (`*.test.ts`), run by vitest under Node, or under jsdom
where a test needs a DOM:

- `colourPicker.test.ts`: the picker on a stand-in for a host that draws on planes: its
  presses, clicks, keys, fields and modes, the eyedropper in each mode, the browser's and the
  app's pick stand-ins, and the dock button;
- `colourWell.test.ts`: the well and the page's picker: one for each rule the picker takes the
  pointer by, one picker moving between wells, what shuts it and what leaves it open, the
  eyedropper's press on the view and the app's own pick, and the picker's window, a stand-in
  over a document of its own;
- `pickerView.test.ts`: the picker's layout, regions and painting, the eyedropper's among them;
- `renderer.test.ts`: what draws the wheel: the renderer set or the other, shared, on
  stand-ins for WebGL's and WebGPU's whose context comes at once, later or never, or is lost;
- `wheelWebGPU.test.ts`: WebGPU's renderer on a stand-in for the browser's WebGPU: whether it
  can be had, its device coming later, never, or lost, its uniforms laid out as its shaders'
  structs are, and its pass, the triangle then the ring;
- `colourWell3D.test.ts`: the three.js well pointed at by rays: its planes, its picker opened
  below its colour, a press on the wheel and its drag along the plane past its edges under a
  well moved and turned in its scene, a click on the close, the pointer coming and going, one
  picker shutting another, typing placed over the field as the view shows it, listening on a
  canvas, the warning of `WebGPURenderer`'s tone mapping, and letting go;
- `reactWell.test.ts`: React's well mounted in strict mode: its canvas and its ref, its value
  written and the colour taken told, a new well for a new kind and the same one kept for the
  rest;
- `picker.test.ts`: the dialog's drags and the faces it loads;
- `index.test.ts`: every public face loaded under Node with no document or window, as on a
  server, the adapters' among them, an update to the dialog before it is first shown, and
  React's well rendered as its element alone;
- the rest: a widget's options, and each module's colour maths, layout, painting, input and
  press rules.

## Licence

The code is under the MIT License, in `LICENSE`. The fonts keep their own licences, each
beside its font in `src/css/fonts/`: Roboto's is the Apache License 2.0, and Roboto Mono's the
SIL Open Font License 1.1.
