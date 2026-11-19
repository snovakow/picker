# picker

Color Picker: colour wells that share one picker with an eyedropper, the Color Picker dialog, and
a demo page. It is on its way to becoming a library: a page uses the wells and the picker they
share, and a host of its own, a 3D scene or VR among them, can show the picker itself.

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
known bytes over gradients for the eyedropper to pick from, a switch of the picker's eyedropper
and one of where it stands, and a log of what the wells and the dialog tell. It uses the picker
only through `src/index.ts`, as a page would.

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
`dock`, `poppedOut`). `dispose` takes the picker away, its wells with no picker after it.

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

## Hosting the picker yourself: 3D and VR

`ColourPicker` is the picker on its own: it holds what is open and what a press on it holds,
paints itself into a 2D canvas of its own, which a host shows however it draws, as a texture in
a WebGL or a WebGPU scene among them, and asks its host (`PickerHost`) for the rest: the
widget's state and layout, where the picker stands and what it is drawn on, the page's input,
the events it tells, and the eyedropper it sets. A page's picker (`PagePicker`) is one host,
serving the page's wells. A host that draws the colour and its picker on planes in a 3D scene,
or in VR, is another:

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
  page's picker does for its window; a host in a 3D scene needs neither.

A host keeps the order the picker's behaviour rests on, which `colourPicker.ts`'s header
lists: when a press is forgotten before its click, when the picker is laid out again, and what
shutting it does, in order. The picker's own tests run it on a stand-in for such a host, which
draws on planes and hits them with points of a plane (`TestPanel` in `colourPicker.test.ts`).

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

## What it holds

| File | What it is |
|---|---|
| `src/index.ts` | The public face: what a page and a host import |
| `src/js/colourWell.ts` | A colour well on a page: the colour on a canvas of its own, joining the page's picker |
| `src/js/pagePicker.ts` | The page's picker: one picker the page's wells share, open on one at a time, in the page or in a window of its own, with the presses on its eyedropper's view |
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
  presses, clicks, keys, fields and modes, the eyedropper in each mode, the browser's and the
  app's pick stand-ins, and the dock button;
- `colourWell.test.ts`: the well and the page's picker: one for each rule the picker takes the
  pointer by, one picker moving between wells, what shuts it and what leaves it open, the
  eyedropper's press on the view and the app's own pick, and the picker's window, a stand-in
  over a document of its own;
- `pickerView.test.ts`: the picker's layout, regions and painting, the eyedropper's among them;
- `picker.test.ts`: the dialog's drags and the faces it loads;
- the rest: a widget's options, and each module's colour maths, layout, painting, input and
  press rules.

## Licence

The code is under the MIT License, in `LICENSE`. The fonts keep their own licences, each
beside its font in `src/css/fonts/`: Roboto's is the Apache License 2.0, and Roboto Mono's the
SIL Open Font License 1.1.
