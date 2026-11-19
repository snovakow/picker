/**
 * @fileoverview The wheel drawn by WebGL, the `webgl` renderer
 * (renderer.ts): the triangle by one program, then the ring, the line across
 * it at the hue and the triangle's handle over it by another, as wheel.ts
 * lays the wheel out, into a canvas it is given or one of its own. Its
 * context keeps no drawing buffer between tasks, so the drawing is read or
 * copied in the same task it is drawn in.
 */

import { wheelUniforms, type WheelGeometry, type WheelTerms } from './wheel.ts';
import type { RendererEvents, WheelRenderer } from './renderer.ts';

/** The context the wheel is drawn with: no depth, stencil or multisampling, premultiplied alpha. */
export const WHEEL_CONTEXT: WebGLContextAttributes = {
	antialias: false,
	stencil: false,
	alpha: true,
	depth: false,
	premultipliedAlpha: true,
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

/**
 * Makes the wheel's WebGL context on the canvas given, or on a canvas of its
 * own, with its two programs and their buffers; null where the browser gives
 * the canvas no context. It draws at once, a canvas drawn at a geometry of
 * another size resized first, and tells `events` as its context is lost,
 * after which it draws nothing.
 */
export const makeWebGLWheel = (canvas: HTMLCanvasElement = document.createElement('canvas'), events?: RendererEvents): WheelRenderer | null => {
	const gl = canvas.getContext('webgl', WHEEL_CONTEXT);
	if (!gl) return null;
	canvas.addEventListener('webglcontextlost', () => events?.lost());

	const quad = makeShape(gl, [
		-0.5, 0.5, 0.0,
		-0.5, -0.5, 0.0,
		0.5, -0.5, 0.0,
		0.5, 0.5, 0.0,
	], [0, 1, 2, 0, 2, 3]);
	const ring = makeProgram(gl, WHEEL_VERTEX, WHEEL_FRAGMENT, ['aVertexPosition'], ['innerRad', 'outerRad', 'unit', 'handle', 'antialias', 'handleTri', 'colorBase']);
	const triangle = makeShape(gl, [0, 1, 2]);
	const tri = makeProgram(gl, TRIANGLE_VERTEX, TRIANGLE_FRAGMENT, ['aVertexIndex'], ['pos0', 'pos1', 'pos2', 'color', 'unit', 'antialias']);

	const draw = (geometry: WheelGeometry, terms: WheelTerms): boolean => {
		if (gl.isContextLost()) return false;
		if (canvas.width !== geometry.width) canvas.width = geometry.width;
		if (canvas.height !== geometry.height) canvas.height = geometry.height;
		const uniforms = wheelUniforms(geometry, terms);
		const { corners } = uniforms;

		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.disable(gl.CULL_FACE);

		gl.viewport(0.0, 0.0, geometry.width, geometry.height);

		gl.clearColor(0.0, 0.0, 0.0, 0.0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.useProgram(tri.program);

		gl.uniform1f(tri.uniform.unit, uniforms.triangleUnit);
		gl.uniform1f(tri.uniform.antialias, uniforms.antialias);
		gl.uniform3fv(tri.uniform.color, uniforms.hue);
		gl.uniform2fv(tri.uniform.pos0, corners[0]);
		gl.uniform2fv(tri.uniform.pos1, corners[1]);
		gl.uniform2fv(tri.uniform.pos2, corners[2]);

		gl.bindBuffer(gl.ARRAY_BUFFER, triangle.vertexBuffer);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

		const aVertexIndex = tri.attribute.aVertexIndex;
		gl.vertexAttribPointer(aVertexIndex, 1, gl.FLOAT, false, 0, 0);
		gl.enableVertexAttribArray(aVertexIndex);
		gl.drawArrays(gl.TRIANGLES, 0, triangle.indexLength);

		gl.useProgram(ring.program);

		gl.uniform2fv(ring.uniform.handle, uniforms.handle);
		gl.uniform1f(ring.uniform.unit, uniforms.ringUnit);
		gl.uniform1f(ring.uniform.innerRad, uniforms.innerRad);
		gl.uniform1f(ring.uniform.outerRad, uniforms.outerRad);
		gl.uniform1f(ring.uniform.antialias, uniforms.antialias);
		gl.uniform3fv(ring.uniform.colorBase, uniforms.base);
		gl.uniform2fv(ring.uniform.handleTri, uniforms.handleTri);

		gl.bindBuffer(gl.ARRAY_BUFFER, quad.vertexBuffer);
		const aVertexPosition = ring.attribute.aVertexPosition;
		gl.vertexAttribPointer(aVertexPosition, 3, gl.FLOAT, false, 0, 0);
		gl.enableVertexAttribArray(aVertexPosition);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quad.indexBuffer);

		gl.drawElements(gl.TRIANGLES, quad.indexLength, gl.UNSIGNED_SHORT, 0);
		return true;
	};

	return { canvas, ready: true, draw };
};
