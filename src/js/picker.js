/**
 * @fileoverview Color picker dialog with RGBA sliders, a hue wheel and triangle, and named colors
 * 
 * Provides a color picker dialog: a palette of named colors, a color wheel
 * whose ring sets the hue and whose triangle sets the saturation and
 * intensity (wheel.ts), and red, green, blue and alpha sliders, with
 * real-time color selection and resolution-aware rendering.
 * 
 * Key Features:
 * - Interactive color wheel, sliders and named colors
 * - RGB channels, and hue, saturation and intensity on the wheel
 * - Real-time color selection
 * - Resolution-aware pixel ratio handling
 * - Mouse interaction support
 * - Dynamic color picker UI generation
 * 
 * @author Scott Novakowski
 */

import { ringAt, saturatedOf, triangleAt, triangleColour, triangleOf, unitOfHue, wheelGeometry, wheelRegionAt } from './wheel.ts'
import { makeWebGLWheel } from './wheelWebGL.ts'
import { SWATCHES, isLightSwatch, paintBar } from './colour.ts'
import { loadFaces } from './paint.ts'
import '../css/picker.css'

var pickerHide

let setResolutionCallback
let removeResolutionCallback
{
	let resolutionCallback;
	let loop;
	let pixelRatio;
	const check = function () {
		if (pixelRatio !== window.devicePixelRatio) {
			pixelRatio = window.devicePixelRatio;
			if (resolutionCallback) resolutionCallback()
		}
	}

	removeResolutionCallback = function () {
		if (loop !== undefined) {
			window.clearInterval(loop);
			loop = undefined;
		}
		resolutionCallback = undefined;
	}
	setResolutionCallback = function (callback) {
		removeResolutionCallback();
		pixelRatio = window.devicePixelRatio
		resolutionCallback = callback
		loop = setInterval(check, 1000);
	}
}

const topBarHeight = 24;

const backing = document.createElement('div')
backing.className = "___picker"

const content = document.createElement('div')
content.className = "___body"

const topBar = document.createElement('div')
topBar.className = "___top"

let closeSetRes;
let placeOnScreen = function (diff_x, diff_y) {
	backing.style.width = content.scrollWidth + 'px';
	topBar.style.width = content.scrollWidth + 'px';

	const rect = backing.getBoundingClientRect()
	let x = rect.left;
	let y = rect.top;
	if (diff_x) x += diff_x;
	if (diff_y) y += diff_y;

	if (x < 0) x = 0;
	if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height;
	if (y < 0) y = 0;
	if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width;
	backing.style.left = x + 'px';
	backing.style.top = y + 'px';
}

{
	topBar.style.height = topBarHeight + 'px';
	topBar.style.lineHeight = topBarHeight + 'px';
	topBar.appendChild(document.createTextNode("Color Picker"));
	backing.appendChild(topBar);

	const close = document.createElement('canvas');
	close.className = "___close"
	closeSetRes = function () {
		const size = topBarHeight * window.devicePixelRatio;
		close.width = size;
		close.height = size;

		const pad = 8 * window.devicePixelRatio;
		const ctx = close.getContext("2d");
		ctx.strokeStyle = "white";
		ctx.lineCap = "round";
		ctx.lineWidth = 2 * window.devicePixelRatio;
		ctx.beginPath();
		ctx.moveTo(pad, pad);
		ctx.lineTo(size - pad, size - pad);
		ctx.moveTo(size - pad, pad);
		ctx.lineTo(pad, size - pad);
		ctx.stroke();
	}
	close.style.width = topBarHeight + 'px';
	close.style.height = topBarHeight + 'px';
	closeSetRes();
	close.onclick = function () {
		pickerHide();
	}
	topBar.appendChild(close);

	let is_dragging = false
	let prev_x, prev_y
	topBar.addEventListener('mousedown', function (e) {
		is_dragging = true;
		prev_x = e.pageX;
		prev_y = e.pageY;
	});

	window.addEventListener('mouseup', function (e) {
		is_dragging = false
	}, true)

	window.addEventListener('mousemove', function (e) {
		if (!is_dragging) return

		e.preventDefault();

		const diff_x = e.pageX - prev_x;
		const diff_y = e.pageY - prev_y;

		placeOnScreen(diff_x, diff_y);

		prev_x = e.pageX;
		prev_y = e.pageY;
	}, true)

}
backing.appendChild(content);

const totalHeight = 258
const gradientWidth = 24

let colorUpdateCallback
let colorDoneCallback
let wheelPickerUpdate
let rgbaUpdate

let colorAlpha = 1

const makeDraggable = function (element, callbackUpdate, callbackComplete, validHit) {
	let is_dragging = false
	const handle = function (e, ondown) {
		const rect = element.getBoundingClientRect()
		const x = e.pageX - rect.left
		const y = e.pageY - rect.top
		if (ondown) {
			if (!validHit || validHit(x, y)) is_dragging = true
			else return
		}
		if (callbackUpdate) callbackUpdate(x, y)
	}

	element.onmousedown = function (e) {
		handle(e, true)
	}
	window.addEventListener('mouseup', function (e) {
		if (is_dragging) {
			if (callbackComplete) callbackComplete()
			is_dragging = false
		}
	}, true)
	window.addEventListener('mousemove', function (e) {
		if (!is_dragging) return
		handle(e)
	}, true)
}

const table = document.createElement('table')
{
	table.className = "___element ___colors"

	const rowHeight = 24

	const maxRowCount = Math.floor(totalHeight / rowHeight)
	const colCount = Math.ceil(SWATCHES.length / maxRowCount)
	const rowCount = Math.ceil(SWATCHES.length / colCount)

	const rows = []
	let col = 0
	let colStarted = false

	for (let i = 0; i < SWATCHES.length; i++) {
		let row
		if (colStarted) {
			row = rows[col]
		} else {
			row = table.insertRow(-1)
			row.className = "center"
			rows[col] = row
		}

		const color = SWATCHES[i].rgb
		const cell = row.insertCell(-1)
		cell.style.height = rowHeight + 'px'
		cell.appendChild(document.createTextNode(SWATCHES[i].name))
		cell.style.backgroundColor = 'rgb(' + color.join(",") + ')'

		cell.className = "___colorBox"
		if (isLightSwatch(color)) cell.className += " ___black"
		else cell.className += " ___white"

		!function (color) {
			cell.onclick = function () {
				rgbaUpdate(color)
				wheelPickerUpdate(color)

				const callbackColor = [color[0], color[1], color[2], colorAlpha]
				if (colorUpdateCallback) colorUpdateCallback(callbackColor)
				if (colorDoneCallback) colorDoneCallback(callbackColor)
			}
		}(color)

		col++
		if (col === rowCount) {
			col = 0
			colStarted = true
		}
	}
}

const wheelPicker = document.createElement('canvas')
let wheelPickerSetRes
{
	const assign2 = function (r, v) { r[0] = v[0]; r[1] = v[1]; return r; }
	const assign3 = function (r, v) { r[0] = v[0]; r[1] = v[1]; r[2] = v[2]; return r; }

	let geometry
	let corners

	wheelPicker.className = "___element"
	wheelPickerSetRes = function () {
		wheelPicker.width = totalHeight * window.devicePixelRatio
		wheelPicker.height = totalHeight * window.devicePixelRatio

		geometry = wheelGeometry(wheelPicker.width, wheelPicker.height, totalHeight, window.devicePixelRatio)
	}
	wheelPickerSetRes()
	wheelPicker.style.width = totalHeight + 'px'
	wheelPicker.style.height = totalHeight + 'px'

	// Drawn by WebGL, and not at all where the browser gives the canvas no context.
	const wheel = makeWebGLWheel(wheelPicker)

	const colorHue = [255, 0, 0]
	const colorBase = [255, 0, 0]
	let colorSaturation = 1.0
	let colorIntensity = 1.0
	const colorUnit = [1, 0]
	wheelPickerUpdate = function (colorIn, unit) {
		if (colorIn) {
			const values = saturatedOf(colorIn)
			colorSaturation = values.saturation
			colorIntensity = values.intensity
			if (colorSaturation > 0) assign3(colorHue, values.hue)
			assign3(colorBase, colorIn)
		}

		if (colorIn && !unit) unit = unitOfHue(colorHue)

		if (unit) assign2(colorUnit, unit)

		corners = triangleOf(colorUnit, geometry)
		wheel?.draw(geometry, { unit: colorUnit, hue: colorHue, base: colorBase, saturation: colorSaturation, intensity: colorIntensity })
	}

	{
		const saturatedColor = function () {
			const color = triangleColour(colorHue, colorSaturation, colorIntensity)
			color[3] = colorAlpha
			return color
		}
		let hitMode

		const callbackUpdate = function (x, y) {
			let color;
			if (hitMode === 'triangle') {
				const terms = triangleAt(geometry, corners, x, y)
				colorSaturation = terms.saturation
				colorIntensity = terms.intensity

				color = saturatedColor()
				assign3(colorBase, color)
				wheelPickerUpdate()
			} else {
				const ring = ringAt(geometry, x, y)
				if (!ring) return
				assign3(colorHue, ring.hue)
				color = saturatedColor()
				assign3(colorBase, color)
				wheelPickerUpdate(undefined, ring.unit)
			}

			rgbaUpdate(color)
			if (colorUpdateCallback) colorUpdateCallback(color)
		}
		const callbackComplete = function () {
			if (colorDoneCallback) colorDoneCallback(saturatedColor())
		}

		const validHit = function (x, y) {
			const region = wheelRegionAt(geometry, corners, x, y)
			if (region) hitMode = region
			return region !== null
		}
		makeDraggable(wheelPicker, callbackUpdate, callbackComplete, validHit)
	}
}

const rGradient = document.createElement('canvas')
const gGradient = document.createElement('canvas')
const bGradient = document.createElement('canvas')
const aGradient = document.createElement('canvas')
let rGradientSetRes
let gGradientSetRes
let bGradientSetRes
let aGradientSetRes
{
	const color = [255, 0, 0]

	const drawComponent = function (canvas, color1, color2, val, grid) {
		paintBar(canvas.getContext("2d"), { x: 0, y: 0, w: canvas.width, h: canvas.height }, window.devicePixelRatio, [color1, color2], val, grid)
	}

	const drawPicker = function () {
		drawComponent(rGradient, [255, 0, 0], [0, 0, 0], color[0] / 255)
		drawComponent(gGradient, [0, 255, 0], [0, 0, 0], color[1] / 255)
		drawComponent(bGradient, [0, 0, 255], [0, 0, 0], color[2] / 255)
		const color1 = [color[0], color[1], color[2]]
		const color2 = [color[0], color[1], color[2]]
		color1.push(1)
		color2.push(0)
		drawComponent(aGradient, color1, color2, colorAlpha, true)
	}

	rgbaUpdate = function (colorIn) {
		if (colorIn) {
			color[0] = colorIn[0]
			color[1] = colorIn[1]
			color[2] = colorIn[2]
		}
		drawPicker()
	}

	const callbackUpdate = function (x, y, canvas) {
		let unit = y * window.devicePixelRatio / canvas.height
		if (unit < 0) unit = 0
		if (unit > 1) unit = 1
		return 1 - unit
	}
	const updateDraws = function () {
		drawPicker()
		wheelPickerUpdate(color)
		if (colorUpdateCallback) colorUpdateCallback([color[0], color[1], color[2], colorAlpha])
	}
	const makeUpdate = function (canvas, component) {
		return function (x, y) {
			const unit = callbackUpdate(x, y, canvas)
			let val = Math.floor(unit * 256);
			if (val >= 256) val = 255;
			color[component] = val
			updateDraws()
		}
	}
	const aUpdate = function (x, y) {
		colorAlpha = callbackUpdate(x, y, aGradient)
		updateDraws()
	}

	const callbackComplete = function () {
		if (colorDoneCallback) colorDoneCallback([color[0], color[1], color[2], colorAlpha])
	}

	const makeSlider = function (canvas, callbackUpdate) {
		canvas.className = "___element"
		makeDraggable(canvas, callbackUpdate, callbackComplete)
		const setRes = function () {
			canvas.width = gradientWidth * window.devicePixelRatio
			canvas.height = totalHeight * window.devicePixelRatio
		}
		canvas.style.width = gradientWidth + 'px'
		canvas.style.height = totalHeight + 'px'
		setRes()
		return setRes
	}
	rGradientSetRes = makeSlider(rGradient, makeUpdate(rGradient, 0))
	gGradientSetRes = makeSlider(gGradient, makeUpdate(gGradient, 1))
	bGradientSetRes = makeSlider(bGradient, makeUpdate(bGradient, 2))
	aGradientSetRes = makeSlider(aGradient, aUpdate)
}

// Color Palette
content.appendChild(table)

// Color Wheel Triangle
content.appendChild(wheelPicker)

// RGBA
content.appendChild(rGradient)
content.appendChild(gGradient)
content.appendChild(bGradient)
content.appendChild(aGradient)

const resize = function () {
	placeOnScreen();
}
pickerHide = function () {
	colorUpdateCallback = undefined
	colorDoneCallback = undefined
	removeResolutionCallback()
	window.removeEventListener("resize", resize)
	if (backing.parentElement) backing.parentElement.removeChild(backing)
}

const update = (color) => {
	if (color.length > 3) {
		colorAlpha = color[3]
		if (colorAlpha < 0) colorAlpha = 0
		if (colorAlpha > 1) colorAlpha = 1
	}
	rgbaUpdate(color)
	wheelPickerUpdate(color)
}

let callerObject = null;
export const pickerShow = function (view, color, doneCallback, updateCallback, caller) {
	loadFaces()
	callerObject = caller;
	pickerHide()
	colorUpdateCallback = updateCallback
	colorDoneCallback = doneCallback

	update(color);

	view.appendChild(backing)

	window.addEventListener("resize", resize)

	setResolutionCallback(function () {
		closeSetRes()
		rGradientSetRes()
		gGradientSetRes()
		bGradientSetRes()
		aGradientSetRes()
		rgbaUpdate()
		wheelPickerSetRes()
		wheelPickerUpdate()
	})

	placeOnScreen()
}
export const pickerUpdate = (color, caller) => {
	if (!backing.parentElement) return;
	if (caller != callerObject) return;
	update(color);
}
