/**
 * @fileoverview The demo page: a colour well for each kind of colour its
 * options make, each opening the page's picker over the page or in a window
 * of its own; the Color Picker dialog, opened from a button; a view of flat
 * colours of known bytes over gradients, which the eyedropper picks from; a
 * switch of the picker's eyedropper, one of where it stands and one of what
 * draws its wheel; and a log of what the wells and the dialog tell. It uses
 * the picker as a page would, through its public face (src/index.ts).
 */
import { ColourWell, pagePicker, pickerShow, type ColourWellOptions, type CustomPick, type Docking, type DropperView, type Eyedropper, type Renderer } from '../src/index.ts';
import './demo.css';

/** One well for each kind of colour its options make, and one that sets its own eyedropper. */
const WELLS: { title: string; options: ColourWellOptions }[] = [
	{ title: 'Wheel', options: { value: '#ff8b30' } },
	{ title: 'Alpha and Swatches', options: { value: '#2f6fd680', alpha: true, swatches: ['#ff8b30', '#2f6fd6', '#3fa34d80', '#1b1f24', '#ffffff'] } },
	{ title: 'Square', options: { value: '#3fa34d', mode: 'square' } },
	{ title: 'Sliders', options: { value: '#8b5cf6', mode: 'sliders', alpha: true } },
	{ title: 'Names', options: { value: '#ff0000', mode: 'names' } },
	{ title: 'Well', options: { value: '#00b3b3', showValue: false } },
	{ title: 'Disabled', options: { value: '#888888', disabled: true } },
	{ title: 'Styled', options: { value: '#c2410c', style: { fontSize: 18, borderRadius: 12, borderWidth: 2, borderColor: '#c2410c', padding: 12, accent: '#c2410c', background: '#fff7ed', color: '#7c2d12' } } },
	{ title: 'With a Title', options: { value: '#0ea5e9', title: 'Tint' } },
	{ title: 'Its Own Eyedropper: None', options: { value: '#d946ef', eyedropper: { mode: 'disabled' } } },
];

const log = document.getElementById('log')!;
const lines: string[] = [];
/** Puts a line at the log's head, keeping the latest few. */
const say = (line: string): void => {
	lines.unshift(line);
	lines.length = Math.min(lines.length, 14);
	log.textContent = lines.join('\n');
};

/** The view: flat colours of known bytes across the top, a hue sweep, and a grey ramp. */
const FLAT = ['#ff8b30', '#2f6fd6', '#3fa34d', '#8b5cf6', '#ff0000', '#00b3b3', '#1b1f24', '#ffffff'];
const view = document.getElementById('view') as HTMLCanvasElement;
// Read back by the eyedropper, so kept where its texels can be read.
const viewContext = view.getContext('2d', { willReadFrequently: true })!;
const paintView = (): void => {
	const width = 640;
	const height = 220;
	const ratio = window.devicePixelRatio || 1;
	view.width = Math.round(width * ratio);
	view.height = Math.round(height * ratio);
	view.style.width = `${width}px`;
	view.style.height = `${height}px`;
	const ctx = viewContext;
	ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	const cell = width / FLAT.length;
	FLAT.forEach((colour, i) => {
		ctx.fillStyle = colour;
		ctx.fillRect(i * cell, 0, cell, 80);
	});
	const hue = ctx.createLinearGradient(0, 0, width, 0);
	for (let i = 0; i <= 6; i++) hue.addColorStop(i / 6, `hsl(${i * 60}, 100%, 50%)`);
	ctx.fillStyle = hue;
	ctx.fillRect(0, 80, width, 80);
	const grey = ctx.createLinearGradient(0, 0, width, 0);
	grey.addColorStop(0, '#000000');
	grey.addColorStop(1, '#ffffff');
	ctx.fillStyle = grey;
	ctx.fillRect(0, 160, width, 60);
};
paintView();
window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', paintView);

/** The view as the eyedropper picks from it: the texel under a point of the page, its alpha left out. */
const VIEW: DropperView = {
	element: view,
	sample: (clientX, clientY) => {
		const rect = view.getBoundingClientRect();
		const x = Math.floor((clientX - rect.left) * view.width / rect.width);
		const y = Math.floor((clientY - rect.top) * view.height / rect.height);
		if (x < 0 || y < 0 || x >= view.width || y >= view.height) return null;
		const [r, g, b] = viewContext.getImageData(x, y, 1, 1).data;
		return [r, g, b];
	},
};

/**
 * The page's own pick, for the custom eyedropper: the next press on the
 * view, its moves and its release, read by the page's own listeners rather
 * than the picker's, each colour handed to the picker as it is read, and the
 * last as the press is let go. Put away first, it takes its listeners down.
 */
const ownPick: CustomPick = (take, signal) => {
	const hexAt = (event: PointerEvent): string | null => {
		const rgb = VIEW.sample(event.clientX, event.clientY);
		return rgb ? `#${rgb.map((byte) => byte.toString(16).padStart(2, '0')).join('')}` : null;
	};
	let pressed = false;
	const down = (event: PointerEvent): void => {
		pressed = true;
		view.setPointerCapture(event.pointerId);
		take(hexAt(event));
	};
	const move = (event: PointerEvent): void => {
		if (pressed) take(hexAt(event));
	};
	const up = (event: PointerEvent): void => {
		if (!pressed) return;
		stop();
		take(hexAt(event), true);
		say('custom: done');
	};
	const stop = (): void => {
		view.removeEventListener('pointerdown', down);
		view.removeEventListener('pointermove', move);
		view.removeEventListener('pointerup', up);
		view.style.cursor = '';
	};
	view.addEventListener('pointerdown', down);
	view.addEventListener('pointermove', move);
	view.addEventListener('pointerup', up);
	view.style.cursor = 'copy';
	signal.addEventListener('abort', () => {
		stop();
		say('custom: put away');
	});
	say('custom: press the view');
};

/** The picker's eyedropper, by the switch: the screen, falling back to the view; the screen alone, unavailable in a browser with no eyedropper of its own; the view; the page's own pick; or none. */
const EYEDROPPERS: Record<string, Eyedropper> = {
	screen: { mode: 'screen', view: VIEW },
	screenAlone: { mode: 'screen' },
	view: { mode: 'view', view: VIEW },
	custom: { mode: 'custom', pick: ownPick, tip: 'Pick a colour from the view, read by the page' },
	disabled: { mode: 'disabled' },
};

const picker = pagePicker();
picker.setEyedropper(EYEDROPPERS.screen);

const wells = document.getElementById('wells')!;
for (const { title, options } of WELLS) {
	const figure = document.createElement('div');
	figure.className = 'well';
	const heading = document.createElement('h3');
	heading.textContent = title;
	const value = document.createElement('code');
	const well = new ColourWell({
		...options,
		onEvent: (event, of) => {
			value.textContent = of.value;
			say(`${title}: ${event}${event === 'change' ? ` ${of.value}` : ''}`);
		},
	});
	value.textContent = well.value;
	figure.append(heading, well.canvas, value);
	wells.appendChild(figure);
}

// The dialog, opened from a button, its colour shown beside it.
const dialogButton = document.getElementById('dialog')!;
const dialogSwatch = document.getElementById('dialogSwatch')!;
const dialogValue = document.getElementById('dialogValue')!;
let dialogColour: [number, number, number, number] = [255, 139, 48, 1];
const showDialogColour = (): void => {
	const [r, g, b, a] = dialogColour;
	dialogSwatch.style.background = `rgba(${r},${g},${b},${a})`;
	dialogValue.textContent = `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
};
showDialogColour();
dialogButton.addEventListener('click', () => {
	pickerShow(document.body, dialogColour, (colour) => {
		say(`dialog: done ${colour.join(', ')}`);
	}, (colour) => {
		dialogColour = [colour[0], colour[1], colour[2], colour[3]];
		showDialogColour();
	});
});

// The switch of the picker's eyedropper, for every well that sets none of its own.
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="eyedropper"]')) {
	input.addEventListener('change', () => {
		if (!input.checked) return;
		picker.setEyedropper(EYEDROPPERS[input.value]);
		say(`eyedropper: ${input.value}`);
	});
}

// The switch of where the picker stands.
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="docking"]')) {
	input.addEventListener('change', () => {
		if (!input.checked) return;
		picker.setDocking(input.value as Docking);
		say(`docking: ${input.value}`);
	});
}

// The switch of what draws the picker's wheel.
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="renderer"]')) {
	input.addEventListener('change', () => {
		if (!input.checked) return;
		picker.setRenderer(input.value as Renderer);
		say(`renderer: ${input.value}`);
	});
}
