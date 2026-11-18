# picker

Color Picker: a colour well that opens a picker with an eyedropper, the Color Picker dialog, and
a demo page. It is on its way to becoming a library: a page uses the well, and a host of its own,
a 3D scene or VR among them, can show the picker itself.

## Running it

```sh
npm install
npm run dev          # the demo page, on Vite's dev server
npm test             # vitest
npx tsc --noEmit     # types, tests and the demo included
npm run build        # the demo, built into dist/
```

The demo page holds a colour well for each kind of colour its options make, the Color Picker
dialog opened from a button, a view of flat colours of known bytes over gradients for the
eyedropper to pick from, a switch of what the page offers the eyedropper, and a log of what
the wells and the dialog tell. It uses the picker only through `src/index.ts`, as a page would.

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
| `dropper` | What the page offers the eyedropper (below); the browser's own alone where it is left out |

A script reads and writes the colour through `value` and `setValue`, its swatches through
`setSwatches`, and whether it can be used through `disabled`; `setDropper` changes what the
page offers the eyedropper, and `dispose` takes the well, its picker and its listeners away.

The well's pixels are the page's: the picker stands over the page against the well's face, and
the page's input, which the picker's fields are typed through, is placed in the body's pixels,
so the page's body is positioned (`position: relative`).

The tab names and the colour names are set in Roboto, or the face the style names; every other
word is in Roboto Mono, so a hex, a channel's number and a percentage keep their columns as
they change. Both ship with the picker (`src/css/fonts/`, where their licences and how they
were cut are noted).

## Hosting the picker yourself: 3D and VR

`ColourPicker` is the picker on its own: it holds what is open and what a press on it holds,
paints itself into a canvas of its own, and asks its host (`PickerHost`) for the rest: the
widget's state and layout, where the picker stands and what it is drawn on, the page's input,
the events it tells, and what the host offers its eyedropper. A `ColourWell` is one host. A
host that draws the colour and its picker on planes in a 3D scene, or in VR, is another:

- it reads its colour widget from options (`readColourOptions`), lays it out and paints it
  where it likes (`layoutWell`, `paintWell`), and shows the picker's canvas on a plane of its
  own, which it updates as the picker tells it the canvas was painted (`popoverPainted`);
- it hands the picker the points a ray hits: a press, a click or the pointer over the picker
  as a point of its plane (`Uv`: from its left and up from its foot, each 0 to 1), and a held
  press's moves and release in the host's own pixels;
- it gives the colour the page's input as a well does (`pageInput`, `InputHost`), placing the
  input where it suits; where the page goes out of sight, as it does for VR, an embedder asks
  the focused host to put a field's typing away (`putAway`);
- its own view can take the eyedropper's presses and hand the colour under them to the picker
  (`takeDropped`), the view in its offer being whatever object it likes.

A host keeps the order the picker's behaviour rests on, which `colourPicker.ts`'s header
lists: when a press is forgotten before its click, when the picker is laid out again, and what
shutting it does, in order. The picker's own tests run it on a stand-in for such a host, which
draws on planes and hits them with points of a plane (`TestPanel` in `colourPicker.test.ts`).

## The eyedropper

The eyedropper stands at the right end of the picker's hex row. What it picks from is the
first its host's offer (`DropperOffer`) allows:

| Tier | When | A click on it | Its tooltip |
|---|---|---|---|
| Screen | The browser has its own eyedropper (Chrome and Edge on a computer) and the host lets it be used | Opens the browser's eyedropper, which picks from anywhere on the screen; its Escape takes nothing | Pick a colour from anywhere on the screen |
| Frame | Otherwise, where the host offers a view | Arms it on the view: the view's next press takes the colour under the pointer as it goes down and moves, and puts the eyedropper away as it is let go; a second click puts it away | Pick a colour from the view. Picking from anywhere on the screen needs Chrome or Edge on a computer |
| None | Otherwise: the host offers no view, and says why | Drawn half as solid; a click shows its tooltip until the picker's next click | Eyedropper not available, with the host's note on its own line, for example "The page has no view to pick colours from" |

A colour it takes is taken as a named cell's is: its bytes, the alpha the colour carries
kept. Each colour taken tells `change` where it changes the colour. The tooltip shows while
the pointer is over the eyedropper or the tooltip, and while it is armed on the view, which a
touch has no pointer over. A press anywhere else on the picker puts an armed eyedropper away,
and works as ever; so do Escape while no field has the input, which leaves the picker open and
its colour as it stands, the picker shutting, and the host's offer no longer holding the tier.
A refusal of the browser's eyedropper other than its Escape is thrown with the browser's cause.

A well's view is an element of the page and what it draws at a point (`DropperView`). Its
press is taken ahead of the view's own listeners, the click after it swallowed, and the page's
input keeps its focus through it; the view's cursor is a crosshair while the eyedropper is
armed on it.

## What it holds

| File | What it is |
|---|---|
| `src/index.ts` | The public face: what a page and a host import |
| `src/js/colourWell.ts` | A colour well on a page: the colour on a canvas of its own, its picker standing over the page |
| `src/js/colourPicker.ts` | The picker as it runs: what is open, a press on it, its keys, its fields, its eyedropper, its painting, each worked through its host |
| `src/js/pickerView.ts` | The picker's layout, regions, colour maths and painting, the eyedropper's among them |
| `src/js/wheel.ts` | The colour wheel and triangle: their maths and their WebGL renderer |
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
  presses, clicks, keys, fields and modes, and the eyedropper in each tier, the browser's a
  stand-in;
- `colourWell.test.ts`: the well's own, one for each rule it takes the pointer by, and the
  eyedropper's press on the view;
- `pickerView.test.ts`: the picker's layout, regions and painting, the eyedropper's among them;
- `picker.test.ts`: the dialog's drags and the faces it loads;
- the rest: a widget's options, and each module's colour maths, layout, painting, input and
  press rules.

## Licence

The code is under the MIT License, in `LICENSE`. The fonts keep their own licences, each
beside its font in `src/css/fonts/`: Roboto's is the Apache License 2.0, and Roboto Mono's the
SIL Open Font License 1.1.
