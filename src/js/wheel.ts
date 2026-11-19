/**
 * @fileoverview The colour wheel and triangle: a hue ring around a triangle
 * whose corners are the hue, white and black, and the maths that reads a
 * colour into the wheel's terms, a point on the wheel back into a colour,
 * and a point into the part of the wheel it lies on. What draws it is its
 * renderer's (renderer.ts): WebGL's (wheelWebGL.ts) or WebGPU's
 * (wheelWebGPU.ts), each from what the geometry and terms laid out here give
 * it to draw from (`wheelUniforms`).
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
 * Every function is pure. The wheel is laid out by a `WheelGeometry`: a
 * canvas of `width` × `height` texels showing a wheel `size` logical pixels
 * across at `ratio` texels per logical pixel. A point on the wheel is given
 * in logical pixels from the canvas's top-left corner. The triangle's
 * corners are in the quad's normalised units: the canvas spans -0.5..0.5 on
 * both axes, y up.
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

/** What the wheel is drawn from: the hue's unit vector and colour, the colour the handle rings, and the triangle's terms. */
export interface WheelTerms {
	unit: Vec2;
	hue: Rgb;
	base: Rgb;
	saturation: number;
	intensity: number;
}

/**
 * What a renderer draws the wheel from, each point and length in the quad's
 * normalised units (the canvas spans -0.5..0.5, y up) and each colour's
 * channels 0..1: the triangle's corners, the hue at the first, and a logical
 * pixel as a share of the wheel (`triangleUnit`); the hue's direction, y up,
 * where the line across the ring stands (`handle`), a logical pixel as a
 * share of the wheel's square (`ringUnit`), and the ring's radii; where the
 * triangle's handle stands (`handleTri`) and the colour it rings (`base`);
 * and the logical pixels each edge fades over (`antialias`).
 */
export interface WheelUniforms {
	corners: Corners;
	hue: [number, number, number];
	triangleUnit: number;
	handle: Vec2;
	ringUnit: number;
	innerRad: number;
	outerRad: number;
	handleTri: Vec2;
	base: [number, number, number];
	antialias: number;
}

/** What a renderer draws the wheel from (`WheelUniforms`) for a geometry and a colour's terms, the same whichever draws it. */
export const wheelUniforms = (geometry: WheelGeometry, terms: WheelTerms): WheelUniforms => {
	const corners = triangleOf(terms.unit, geometry);
	return {
		corners,
		hue: [terms.hue[0] / 255, terms.hue[1] / 255, terms.hue[2] / 255],
		triangleUnit: 1.0 / geometry.size,
		handle: [terms.unit[0], -terms.unit[1]],
		ringUnit: geometry.ratio / geometry.dim,
		innerRad: geometry.inner / geometry.size / geometry.ratio,
		outerRad: geometry.outer / geometry.size / geometry.ratio,
		handleTri: triangleHandle(corners, terms.saturation, terms.intensity),
		base: [terms.base[0] / 255, terms.base[1] / 255, terms.base[2] / 255],
		antialias: WHEEL_ANTIALIAS,
	};
};
