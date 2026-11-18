/**
 * @fileoverview The colour wheel and triangle: a hue ring around a triangle
 * whose corners are the hue, white and black, drawn by two WebGL programs, and
 * the maths that reads a colour into the wheel's terms, a point on the wheel
 * back into a colour, and a point into the part of the wheel it lies on.
 *
 * A colour is held as four terms: the hue, its fully saturated colour (one
 * channel 255, one 0 and the third between, but for the green of 256 that
 * `hueOfAngle` gives at 180°); the hue's unit vector, the direction from the
 * wheel's centre to that hue on the ring, in screen axes (y down); the
 * saturation, the weight of the hue's corner; and the intensity, where the
 * rest lies between black (0) and white (1). An angle on the ring is in
 * degrees from -180 to 180, clockwise from the wheel's right in those axes:
 * red at 0°, magenta at 60°, blue at 120°, cyan at ±180°, green at -120° and
 * yellow at -60°, as `hueOfAngle` and `angleOfHue` read it.
 *
 * Every function is pure but `makeWheelRenderer` and the `makeShape` and
 * `makeProgram` it makes its buffers and programs with. The wheel is laid out
 * by a `WheelGeometry`: a canvas of `width` × `height` texels showing a wheel
 * `size` logical pixels across at `ratio` texels per logical pixel. A point on
 * the wheel is given in logical pixels from the canvas's top-left corner. The
 * triangle's corners are in the quad's normalised units: the canvas spans
 * -0.5..0.5 on both axes, y up.
 *
 * The renderer draws into a canvas it is given or one of its own. Its context
 * keeps no drawing buffer between tasks, so the drawing is read or copied in
 * the same task it is drawn in.
 */

/** A 2-vector. */
export type Vec2 = [number, number];
/** A colour's red, green and blue, each 0..255 but for the green of 256 that `hueOfAngle` gives at 180°. */
export type Rgb = [number, number, number];
/** The triangle's corners: the hue, white, black. */
export type Corners = [Vec2, Vec2, Vec2];

/** The ring's thickness as a share of the wheel's diameter. */
export const WHEEL_RING = 26 / 258;

/** The width, in logical pixels, each drawn edge fades over: the ring's and the triangle's edges, the sides of the line across the ring, and the triangle handle's inner and outer edges. */
export const WHEEL_ANTIALIAS = 1.0;

/** The context the wheel is drawn with: no depth, stencil or multisampling, premultiplied alpha. */
export const WHEEL_CONTEXT: WebGLContextAttributes = {
	antialias: false,
	stencil: false,
	alpha: true,
	depth: false,
	premultipliedAlpha: true,
};

const DEGtoRAD = Math.PI / 180;
const RADtoDEG = 180 / Math.PI;

const rotate2 = (v: Vec2, angle: number): Vec2 => {
	const cosAngle = Math.cos(angle);
	const sinAngle = Math.sin(angle);
	return [cosAngle * v[0] - sinAngle * v[1], sinAngle * v[0] + cosAngle * v[1]];
};

/** Where the wheel stands on its canvas, in texels: the centre, the ring's radii, the side of its square. */
export interface WheelGeometry {
	/** The canvas's texels across. */
	width: number;
	/** The canvas's texels down. */
	height: number;
	/** The wheel's logical pixels across. */
	size: number;
	/** Texels per logical pixel. */
	ratio: number;
	/** The side of the square the wheel fills, in texels. */
	dim: number;
	/** The wheel's centre, in texels. */
	mid: Vec2;
	/** The ring's outer radius, in texels. */
	outer: number;
	/** The ring's inner radius, in texels. */
	inner: number;
}

/** The geometry of a wheel `size` logical pixels across on a canvas of `width` × `height` texels at `ratio` texels per logical pixel. */
export const wheelGeometry = (width: number, height: number, size: number, ratio: number): WheelGeometry => {
	const dim = Math.min(width, height);
	const half = dim * 0.5;
	return { width, height, size, ratio, dim, mid: [half, half], outer: half, inner: half - WHEEL_RING * size * ratio };
};

/**
 * A colour as the wheel holds it: its hue's fully saturated colour (red where
 * the colour is a grey), the saturation, the share of the channels' range, and
 * the intensity, where the least channel stands in what the range leaves (0.5
 * for a full range). The saturated colour's channels are byte-quantised: each
 * is its place in the range times 256, floored, held to 255.
 */
export const saturatedOf = (colour: ArrayLike<number>): { hue: Rgb; saturation: number; intensity: number } => {
	const hue: number[] = [];
	let max = 0;
	let min = 255;
	for (let i = 0; i < 3; i++) {
		const componentIn = colour[i];
		if (componentIn > max) max = componentIn;
		if (componentIn < min) min = componentIn;
	}

	const range = max - min;
	const intensity = range < 255 ? min / (255 - range) : 0.5;
	const saturation = range / 255;
	if (range > 0) {
		for (let i = 0; i < 3; i++) {
			const colorVal = Math.floor((colour[i] - min) / range * 256);
			if (colorVal >= 256) hue[i] = 255;
			else hue[i] = colorVal;
		}
	} else {
		hue[0] = 255;
		hue[1] = 0;
		hue[2] = 0;
	}
	return { hue: hue as Rgb, saturation, intensity };
};

/**
 * The colour at a point of the triangle: the grey of the intensity mixed with
 * the hue by the saturation, each channel times 256, floored, held to 255.
 */
export const triangleColour = (hue: Rgb, saturation: number, intensity: number): Rgb => {
	const colour: number[] = [];
	const colorSaturationInv = 1.0 - saturation;
	for (let i = 0; i < 3; i++) {
		const colorVal = Math.floor((intensity * colorSaturationInv + hue[i] / 255 * saturation) * 256);
		if (colorVal >= 256) colour[i] = 255;
		else colour[i] = colorVal;
	}
	return colour as Rgb;
};

/**
 * The angle, in degrees from -180 to 180, at which a fully saturated colour
 * stands on the ring, read off the 60° sector its zero and full channels name;
 * 0 for a colour lacking a channel at 0 or one at 255, and just past 180 for
 * the green of 256 that `hueOfAngle` gives at 180°.
 */
export const angleOfHue = (hue: Rgb): number => {
	let degree = 0;
	const r = hue[0];
	const g = hue[1];
	const b = hue[2];
	if (r === 0 && g === 255) {
		degree = 60 - b * 60 / 255 + (-180);
	} else if (b === 0 && g === 255) {
		degree = r * 60 / 255 + (-120);
	} else if (b === 0 && r === 255) {
		degree = 60 - g * 60 / 255 + (-60);
	} else if (g === 0 && r === 255) {
		degree = b * 60 / 255 + 0;
	} else if (g === 0 && b === 255) {
		degree = 60 - r * 60 / 255 + 60;
	} else if (r === 0 && b === 255) {
		degree = g * 60 / 255 + 120;
	}
	return degree;
};

/** The unit vector toward a fully saturated colour's place on the ring. */
export const unitOfHue = (hue: Rgb): Vec2 => rotate2([1, 0], angleOfHue(hue) * DEGtoRAD);

/**
 * The fully saturated colour at an angle on the ring, in degrees from -180 to
 * 180. Through each 60° sector one channel holds at 255, one at 0, and the
 * third moves: rising, it is the angle's place in the sector, as a share of
 * the sector, times 256, floored; falling, 255 less that. The last sector
 * reaches a share of 1 at 180° itself, where green reads 256.
 */
export const hueOfAngle = (degree: number): Rgb => {
	if (degree < -120) return [0, 255, 255 - Math.floor((degree - (-180)) * 256 / 60)];
	if (degree < -60) return [Math.floor((degree - (-120)) * 256 / 60), 255, 0];
	if (degree < 0) return [255, 255 - Math.floor((degree - (-60)) * 256 / 60), 0];
	if (degree < 60) return [255, 0, Math.floor((degree - 0) * 256 / 60)];
	if (degree < 120) return [255 - Math.floor((degree - 60) * 256 / 60), 0, 255];
	return [0, Math.floor((degree - 120) * 256 / 60), 255];
};

/**
 * The triangle's corners for a hue's unit vector: the hue's on the ring's
 * inner edge in that direction, white and black a third of a turn either side.
 */
export const triangleOf = (unit: Vec2, geometry: WheelGeometry): Corners => {
	const scale = geometry.inner / geometry.dim;
	const tri1: Vec2 = [unit[0] * scale, unit[1] * scale];
	tri1[1] = -tri1[1];
	return [tri1, rotate2(tri1, -120 * DEGtoRAD), rotate2(tri1, 120 * DEGtoRAD)];
};

/** The point's barycentric weights on the triangle `v1`, `v2`, `v3`. */
export const barycentric = (pt: Vec2, v1: Vec2, v2: Vec2, v3: Vec2): [number, number, number] => {
	const e0x = v2[0] - v1[0], e0y = v2[1] - v1[1];
	const e1x = v3[0] - v1[0], e1y = v3[1] - v1[1];
	const e2x = pt[0] - v1[0], e2y = pt[1] - v1[1];
	const d00 = e0x * e0x + e0y * e0y;
	const d01 = e0x * e1x + e0y * e1y;
	const d11 = e1x * e1x + e1y * e1y;
	const d20 = e2x * e0x + e2y * e0y;
	const d21 = e2x * e1x + e2y * e1y;
	const denom = d00 * d11 - d01 * d01;
	const b2 = (d11 * d20 - d01 * d21) / denom;
	const b3 = (d00 * d21 - d01 * d20) / denom;
	const b1 = 1 - b2 - b3;
	return [b1, b2, b3];
};

/** A point in logical pixels as an offset from the wheel's centre, in texels. */
const fromCentre = (geometry: WheelGeometry, x: number, y: number): Vec2 =>
	[x * geometry.ratio - geometry.mid[0], y * geometry.ratio - geometry.mid[1]];

/** A point in logical pixels in the quad's normalised units, y up. */
const toQuad = (geometry: WheelGeometry, x: number, y: number): Vec2 => {
	const unit = fromCentre(geometry, x, y);
	return [unit[0] / geometry.dim, -(unit[1] / geometry.dim)];
};

/**
 * The part of the wheel under a point: the ring, from its inner to its outer
 * radius; the triangle, inside its corners or on an edge; or nothing, in the
 * gap between them and outside the ring.
 */
export const wheelRegionAt = (geometry: WheelGeometry, corners: Corners, x: number, y: number): 'ring' | 'triangle' | null => {
	const unit = fromCentre(geometry, x, y);
	const length = Math.sqrt(unit[0] * unit[0] + unit[1] * unit[1]);
	if (length >= geometry.inner && length <= geometry.outer) return 'ring';
	const bary = barycentric(toQuad(geometry, x, y), corners[0], corners[1], corners[2]);
	if (bary[0] >= 0 && bary[0] <= 1 && bary[1] >= 0 && bary[1] <= 1 && bary[2] >= 0 && bary[2] <= 1) return 'triangle';
	return null;
};

/**
 * The hue a point sets as the ring is dragged: the direction from the centre
 * as a unit vector and the colour at its angle, wherever the point lies; null
 * at the centre itself.
 */
export const ringAt = (geometry: WheelGeometry, x: number, y: number): { unit: Vec2; hue: Rgb } | null => {
	const unit = fromCentre(geometry, x, y);
	const length = Math.sqrt(unit[0] * unit[0] + unit[1] * unit[1]);
	if (length === 0) return null;
	unit[0] /= length;
	unit[1] /= length;
	return { unit, hue: hueOfAngle(Math.atan2(unit[1], unit[0]) * RADtoDEG) };
};

/**
 * The saturation and intensity a point sets as the triangle is dragged. A
 * point beyond an edge is taken onto it, the edge facing the hue's corner
 * tested first, then the one facing white, then the one facing black, so a
 * point beyond two edges is taken onto the first of them; each term is then
 * held to 0..1, and the intensity is 0.5 at full saturation.
 */
export const triangleAt = (geometry: WheelGeometry, corners: Corners, x: number, y: number): { saturation: number; intensity: number } => {
	const bary = barycentric(toQuad(geometry, x, y), corners[0], corners[1], corners[2]);

	if (bary[0] < 0) bary[1] = (1 + bary[1] - bary[2]) / 2;
	else if (bary[1] < 0) bary[0] = (1 + bary[0] - bary[2]) / 2;
	else if (bary[2] < 0) bary[0] = (1 + bary[0] - bary[1]) / 2;

	let saturation = bary[0];
	if (saturation < 0) saturation = 0;
	else if (saturation > 1) saturation = 1;

	let intensity = saturation < 1 ? bary[1] / (1 - saturation) : 0.5;
	if (intensity < 0) intensity = 0;
	else if (intensity > 1) intensity = 1;

	return { saturation, intensity };
};

/** The triangle's handle: the hue's corner weighted by the saturation, the rest between white and black by the intensity. */
export const triangleHandle = (corners: Corners, saturation: number, intensity: number): Vec2 => {
	const [tri1, tri2, tri3] = corners;
	const grey = (k: number) => tri2[k] * intensity + tri3[k] * (1.0 - intensity);
	return [tri1[0] * saturation + grey(0) * (1.0 - saturation), tri1[1] * saturation + grey(1) * (1.0 - saturation)];
};

/** The quad's vertex program: a unit quad drawn over the whole canvas, its position passed on. */
export const WHEEL_VERTEX =
	"attribute vec3 aVertexPosition;" +
	"varying vec2 vVertexPosition;" +

	"void main(void) {" +
	"	vVertexPosition = vec2(aVertexPosition);" +
	"	gl_Position = vec4(aVertexPosition*2.0, 1.0);" +
	"}";

/**
 * The ring's fragment program: the hue at each angle between the radii, faded
 * at both edges; a line across the ring at the hue, white at the outer edge
 * and black at the inner; and the triangle's handle, a ring around the base
 * colour, over whatever it covers.
 */
export const WHEEL_FRAGMENT =
	"precision highp float;" +
	"varying vec2 vVertexPosition;" +

	"uniform float unit;" +
	"uniform vec2 handle;" +
	"uniform float innerRad;" +
	"uniform float outerRad;" +
	"uniform float antialias;" +
	"uniform vec2 handleTri;" +
	"uniform vec3 colorBase;" +

	"const float PI = 3.141592653589793;" +
	"const float DEGtoRAD = PI / 180.0;" +
	"const float rad60 = 60.0 * DEGtoRAD;" +
	"const float rad120 = 120.0 * DEGtoRAD;" +

	"const float handleRad = 4.0;" +
	"const float handleTriWidth = 1.0;" +
	"const float handleTriWidthHalf = 0.1;" +
	"float handleTriWidthTotalHalf = handleTriWidthHalf + handleTriWidth + antialias;" +
	"float handleTriUnit = (handleRad + handleTriWidthTotalHalf)*unit;" +
	"float handleTriUnitSq = handleTriUnit * handleTriUnit;" +

	"float innerRadSq = innerRad * innerRad;" +
	"float outerRadSq = outerRad * outerRad;" +

	"const float handleWidth = 1.0;" +
	"const float handleWidthHalf = handleWidth * 0.5;" +
	"float handleWidthHalfUnit = handleWidthHalf * unit;" +
	"float handleWidthTotalHalfUnit = (handleWidthHalf + antialias) * unit;" +
	"float fadeUnit = antialias * unit;" +

	"vec2 handlePerp = vec2(handle.y, -handle.x);" +

	"void main(void) {" +
	"	float lengthSq = dot(vVertexPosition, vVertexPosition);" +
	"	vec4 fragColor;" +
	"	if(lengthSq<innerRadSq || lengthSq>outerRadSq) fragColor = vec4(0.0, 0.0, 0.0, 0.0);" +
	"	else {" +
	"		float dist = sqrt(lengthSq);" +
	"		float degree = atan(vVertexPosition.y, vVertexPosition.x) / rad60;" +
	"		vec3 color;" +
	"		if (degree >= 2.0) {" +
	"			color.r = 0.0;" +
	"			color.g = 1.0;" +
	"			color.b = degree - 2.0;" +
	"		} else if (degree >= 1.0) {" +
	"			color.r = 2.0 - degree;" +
	"			color.g = 1.0;" +
	"			color.b = 0.0;" +
	"		} else if (degree >= 0.0) {" +
	"			color.r = 1.0;" +
	"			color.g = degree;" +
	"			color.b = 0.0;" +
	"		} else if (degree >= -1.0) {" +
	"			color.r = 1.0;" +
	"			color.g = 0.0;" +
	"			color.b = -degree;" +
	"		} else if (degree >= -2.0) {" +
	"			color.r = degree + 2.0;" +
	"			color.g = 0.0;" +
	"			color.b = 1.0;" +
	"		} else {" +
	"			color.r = 0.0;" +
	"			color.g = -2.0 - degree;" +
	"			color.b = 1.0;" +
	"		}" +

	"		float handleDist = abs(dot(handlePerp, vVertexPosition));" +
	"		if (handleDist<handleWidthTotalHalfUnit) {" +
	"			float handleAngle = dot(handle, vVertexPosition);" +
	"			if (handleAngle>0.0) {" +
	"				float interp = 1.0;" +
	"				float handleColorVal = (dist-innerRad)/(outerRad-innerRad);" +
	"				vec3 handleColor = vec3(handleColorVal,handleColorVal,handleColorVal);" +
	"				if (handleDist > handleWidthHalfUnit) {" +
	"					interp = (handleWidthTotalHalfUnit - handleDist)/fadeUnit;" +
	"				}" +
	"				color = mix(color, handleColor, interp);" +
	"			}" +
	"		}" +

	"		float alpha = 1.0;" +
	"		if (dist < innerRad+fadeUnit) {" +
	"			alpha = (dist-innerRad)/fadeUnit;" +
	"		} else if (dist > outerRad-fadeUnit) {" +
	"			alpha = -(dist-outerRad)/fadeUnit;" +
	"		}" +

	"		fragColor = vec4(color, alpha);" +
	"	}" +

	"	vec2 handleTriDiff = vVertexPosition - handleTri;" +
	"	float triLengthSq = dot(handleTriDiff, handleTriDiff);" +
	"	if(triLengthSq < handleTriUnitSq) {" +
	"		float triLength = sqrt(triLengthSq)/unit;" +
	"		if(triLength < handleRad - handleTriWidthTotalHalf) {" +
	"			fragColor = vec4(colorBase, 1.0);" +
	"		} else if(triLength < handleRad - handleTriWidthHalf - handleTriWidth) {" +
	"			float interp = (handleRad - handleTriWidthHalf - handleTriWidth - triLength)/antialias;" +
	"			fragColor = vec4(colorBase*interp, 1.0);" +
	"		} else if(triLength < handleRad - handleTriWidthHalf) {" +
	"			float interp = 1.0 - (handleRad - handleTriWidthHalf - triLength)/handleTriWidth;" +
	"			fragColor = vec4(interp, interp, interp, 1.0);" +
	"		} else if(triLength < handleRad + handleTriWidthHalf) {" +
	"			fragColor = vec4(1.0, 1.0, 1.0, 1.0);" +
	"		} else if(triLength < handleRad + handleTriWidthHalf + handleTriWidth) {" +
	"			float interp = (handleRad + handleTriWidthHalf + handleTriWidth - triLength)/handleTriWidth;" +
	"			fragColor = vec4(interp, interp, interp, 1.0);" +
	"		} else {" +
	"			float interp = (handleRad + handleTriWidthHalf + handleTriWidth + antialias - triLength)/antialias;" +
	"			fragColor = mix(fragColor, vec4(0.0, 0.0, 0.0, interp), interp);" +
	"		}" +
	"	}" +
	"	gl_FragColor = fragColor;" +
	"}";

/** The triangle's vertex program: corner 0 in the hue, 1 white, 2 black. */
export const TRIANGLE_VERTEX =
	"attribute float aVertexIndex;" +
	"varying vec2 vVertexPosition;" +
	"varying vec3 vColor;" +

	"uniform vec2 pos0;" +
	"uniform vec2 pos1;" +
	"uniform vec2 pos2;" +
	"uniform vec3 color;" +

	"void main(void) {" +
	"	if(aVertexIndex == 0.0) {" +
	"		vVertexPosition = pos0;" +
	"		vColor = color;" +
	"	} else if(aVertexIndex == 1.0) {" +
	"		vVertexPosition = pos1;" +
	"		vColor = vec3(1.0, 1.0, 1.0);" +
	"	} else {" +
	"		vVertexPosition = pos2;" +
	"		vColor = vec3(0.0, 0.0, 0.0);" +
	"	};" +
	"	gl_Position = vec4(vVertexPosition*2.0, 0.0, 1.0);" +
	"}";

/** The triangle's fragment program: the corners' colours blended, faded inside each edge over the antialias width. */
export const TRIANGLE_FRAGMENT =
	"precision highp float;" +
	"varying vec2 vVertexPosition;" +
	"varying vec3 vColor;" +

	"uniform float unit;" +
	"uniform float antialias;" +

	"uniform vec2 pos0;" +
	"uniform vec2 pos1;" +
	"uniform vec2 pos2;" +

	"vec2 dir_0_1_unit = normalize(pos1 - pos0);" +
	"vec2 dir_1_2_unit = normalize(pos2 - pos1);" +
	"vec2 dir_2_0_unit = normalize(pos0 - pos2);" +
	"vec2 perp_0_1_unit = vec2(dir_0_1_unit.y, -dir_0_1_unit.x);" +
	"vec2 perp_1_2_unit = vec2(dir_1_2_unit.y, -dir_1_2_unit.x);" +
	"vec2 perp_2_0_unit = vec2(dir_2_0_unit.y, -dir_2_0_unit.x);" +

	"vec2 mid_0_1 = (pos0 + pos1) * 0.5;" +
	"vec2 mid_1_2 = (pos1 + pos2) * 0.5;" +
	"vec2 mid_2_0 = (pos2 + pos0) * 0.5;" +

	"float fadeRange = antialias * unit;" +

	"void main(void) {" +
	"	float length0 = dot(perp_0_1_unit, vVertexPosition - mid_0_1);" +
	"	float length1 = dot(perp_1_2_unit, vVertexPosition - mid_1_2);" +
	"	float length2 = dot(perp_2_0_unit, vVertexPosition - mid_2_0);" +
	"	float length = min(min(length0, length1), length2);" +
	"	float alpha = 1.0;" +
	"	if(length<fadeRange) alpha = (length/fadeRange);" +
	"	gl_FragColor = vec4(vColor, alpha);" +
	"}";

/** What the wheel is drawn from: the hue's unit vector and colour, the colour the handle rings, and the triangle's terms. */
export interface WheelTerms {
	unit: Vec2;
	hue: Rgb;
	base: Rgb;
	saturation: number;
	intensity: number;
}

/** A canvas the wheel is drawn into, its context's programs and buffers made once. */
export interface WheelRenderer {
	canvas: HTMLCanvasElement;
	/** Clears the canvas and draws the triangle, then the ring and handles over it, for the geometry and terms given. */
	draw(geometry: WheelGeometry, terms: WheelTerms): void;
}

/** A vertex buffer, with an index buffer where one is given, and the count drawn. */
interface Shape {
	vertexBuffer: WebGLBuffer;
	indexBuffer: WebGLBuffer | null;
	indexLength: number;
}

const makeShape = (gl: WebGLRenderingContext, vertexArray: number[], indexArray?: number[]): Shape => {
	const vertexBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexArray), gl.STATIC_DRAW);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);

	let indexBuffer: WebGLBuffer | null = null;
	if (indexArray) {
		indexBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indexArray), gl.STATIC_DRAW);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
	}
	return { vertexBuffer, indexBuffer, indexLength: indexArray ? indexArray.length : vertexArray.length };
};

/** A linked program with its attributes' and uniforms' locations by name. */
interface Program {
	program: WebGLProgram;
	attribute: Record<string, number>;
	uniform: Record<string, WebGLUniformLocation | null>;
}

const makeProgram = (gl: WebGLRenderingContext, vertCode: string, fragCode: string, attributes: string[], uniforms: string[]): Program => {
	const vertShader = gl.createShader(gl.VERTEX_SHADER)!;
	gl.shaderSource(vertShader, vertCode);
	gl.compileShader(vertShader);

	const fragShader = gl.createShader(gl.FRAGMENT_SHADER)!;
	gl.shaderSource(fragShader, fragCode);
	gl.compileShader(fragShader);

	const program = gl.createProgram();
	gl.attachShader(program, vertShader);
	gl.attachShader(program, fragShader);
	gl.linkProgram(program);

	const attribute: Record<string, number> = {};
	const uniform: Record<string, WebGLUniformLocation | null> = {};
	for (const name of attributes) attribute[name] = gl.getAttribLocation(program, name);
	for (const name of uniforms) uniform[name] = gl.getUniformLocation(program, name);
	return { program, attribute, uniform };
};

const div3 = (v: Rgb, val: number): number[] => [v[0] / val, v[1] / val, v[2] / val];

/**
 * Makes the wheel's context on the canvas given, or on a canvas of its own,
 * with its two programs and their buffers. A canvas drawn at a geometry of
 * another size is resized first.
 */
export const makeWheelRenderer = (canvas: HTMLCanvasElement = document.createElement('canvas')): WheelRenderer => {
	const gl = canvas.getContext('webgl', WHEEL_CONTEXT)!;

	const quad = makeShape(gl, [
		-0.5, 0.5, 0.0,
		-0.5, -0.5, 0.0,
		0.5, -0.5, 0.0,
		0.5, 0.5, 0.0,
	], [0, 1, 2, 0, 2, 3]);
	const ring = makeProgram(gl, WHEEL_VERTEX, WHEEL_FRAGMENT, ['aVertexPosition'], ['innerRad', 'outerRad', 'unit', 'handle', 'antialias', 'handleTri', 'colorBase']);
	const triangle = makeShape(gl, [0, 1, 2]);
	const tri = makeProgram(gl, TRIANGLE_VERTEX, TRIANGLE_FRAGMENT, ['aVertexIndex'], ['pos0', 'pos1', 'pos2', 'color', 'unit', 'antialias']);

	const draw = (geometry: WheelGeometry, terms: WheelTerms) => {
		if (canvas.width !== geometry.width) canvas.width = geometry.width;
		if (canvas.height !== geometry.height) canvas.height = geometry.height;
		const corners = triangleOf(terms.unit, geometry);

		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.disable(gl.CULL_FACE);

		gl.viewport(0.0, 0.0, geometry.width, geometry.height);

		gl.clearColor(0.0, 0.0, 0.0, 0.0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.useProgram(tri.program);

		gl.uniform1f(tri.uniform.unit, 1.0 / geometry.size);
		gl.uniform1f(tri.uniform.antialias, WHEEL_ANTIALIAS);
		gl.uniform3fv(tri.uniform.color, div3(terms.hue, 255));
		gl.uniform2fv(tri.uniform.pos0, corners[0]);
		gl.uniform2fv(tri.uniform.pos1, corners[1]);
		gl.uniform2fv(tri.uniform.pos2, corners[2]);

		gl.bindBuffer(gl.ARRAY_BUFFER, triangle.vertexBuffer);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

		const aVertexIndex = tri.attribute.aVertexIndex;
		gl.vertexAttribPointer(aVertexIndex, 1, gl.FLOAT, false, 0, 0);
		gl.enableVertexAttribArray(aVertexIndex);
		gl.drawArrays(gl.TRIANGLES, 0, triangle.indexLength);

		const handleTri = triangleHandle(corners, terms.saturation, terms.intensity);

		gl.useProgram(ring.program);

		gl.uniform2fv(ring.uniform.handle, [terms.unit[0], -terms.unit[1]]);
		gl.uniform1f(ring.uniform.unit, geometry.ratio / geometry.dim);
		gl.uniform1f(ring.uniform.innerRad, geometry.inner / geometry.size / geometry.ratio);
		gl.uniform1f(ring.uniform.outerRad, geometry.outer / geometry.size / geometry.ratio);
		gl.uniform1f(ring.uniform.antialias, WHEEL_ANTIALIAS);
		gl.uniform3fv(ring.uniform.colorBase, div3(terms.base, 255));
		gl.uniform2fv(ring.uniform.handleTri, handleTri);

		gl.bindBuffer(gl.ARRAY_BUFFER, quad.vertexBuffer);
		const aVertexPosition = ring.attribute.aVertexPosition;
		gl.vertexAttribPointer(aVertexPosition, 3, gl.FLOAT, false, 0, 0);
		gl.enableVertexAttribArray(aVertexPosition);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quad.indexBuffer);

		gl.drawElements(gl.TRIANGLES, quad.indexLength, gl.UNSIGNED_SHORT, 0);
	};

	return { canvas, draw };
};
