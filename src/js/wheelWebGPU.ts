/// <reference types="@webgpu/types" />
/**
 * @fileoverview The wheel drawn by WebGPU, the `webgpu` renderer
 * (renderer.ts): the triangle by one pipeline, then the ring, the line across
 * it at the hue and the triangle's handle over it by another, in one pass, as
 * wheel.ts lays the wheel out, into a canvas it is given or one of its own.
 * Its shaders are WebGL's (wheelWebGL.ts) in WGSL, line for line, and it
 * blends and keeps its drawing as WebGL's does, premultiplied, eight bits to
 * a channel, so the two draw the same wheel.
 *
 * Its device comes after it is made, asked of the browser: till then it draws
 * nothing, and it tells `ready` as the device comes, or `lost` where no
 * adapter or device comes or its pipelines cannot be made. A device lost
 * after it came is told as `lost` too, and it draws no more. The canvas's
 * texture is not kept past the task it is drawn in, so the drawing is read
 * or copied in that task.
 */

import { wheelUniforms, type WheelGeometry, type WheelTerms, type WheelUniforms } from './wheel.ts';
import type { RendererEvents, WheelRenderer } from './renderer.ts';

/**
 * The ring's shaders: the quad over the whole canvas, then WebGL's ring
 * (`WHEEL_FRAGMENT`): the hue at each angle between the radii, faded at both
 * edges; a line across the ring at the hue, white at the outer edge and black
 * at the inner; and the triangle's handle, a ring around the base colour,
 * over whatever it covers.
 */
export const RING_WGSL = /* wgsl */ `
struct Ring {
	handle: vec2f,
	handleTri: vec2f,
	unit: f32,
	innerRad: f32,
	outerRad: f32,
	antialias: f32,
	colorBase: vec3f,
}

@group(0) @binding(0) var<uniform> ring: Ring;

struct Varyings {
	@builtin(position) position: vec4f,
	@location(0) vertexPosition: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> Varyings {
	var quad = array<vec2f, 6>(vec2f(-0.5, 0.5), vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(-0.5, 0.5), vec2f(0.5, -0.5), vec2f(0.5, 0.5));
	var varyings: Varyings;
	varyings.vertexPosition = quad[index];
	varyings.position = vec4f(quad[index] * 2.0, 0.0, 1.0);
	return varyings;
}

const PI: f32 = 3.141592653589793;
const DEGtoRAD: f32 = PI / 180.0;
const rad60: f32 = 60.0 * DEGtoRAD;

const handleRad: f32 = 4.0;
const handleTriWidth: f32 = 1.0;
const handleTriWidthHalf: f32 = 0.1;

const handleWidth: f32 = 1.0;
const handleWidthHalf: f32 = handleWidth * 0.5;

@fragment
fn fragmentMain(varyings: Varyings) -> @location(0) vec4f {
	let position = varyings.vertexPosition;
	let unit = ring.unit;
	let antialias = ring.antialias;
	let innerRad = ring.innerRad;
	let outerRad = ring.outerRad;

	let handleTriWidthTotalHalf = handleTriWidthHalf + handleTriWidth + antialias;
	let handleTriUnit = (handleRad + handleTriWidthTotalHalf) * unit;
	let handleTriUnitSq = handleTriUnit * handleTriUnit;

	let innerRadSq = innerRad * innerRad;
	let outerRadSq = outerRad * outerRad;

	let handleWidthHalfUnit = handleWidthHalf * unit;
	let handleWidthTotalHalfUnit = (handleWidthHalf + antialias) * unit;
	let fadeUnit = antialias * unit;

	let handlePerp = vec2f(ring.handle.y, -ring.handle.x);

	let lengthSq = dot(position, position);
	var fragColor: vec4f;
	if (lengthSq < innerRadSq || lengthSq > outerRadSq) {
		fragColor = vec4f(0.0, 0.0, 0.0, 0.0);
	} else {
		let dist = sqrt(lengthSq);
		let degree = atan2(position.y, position.x) / rad60;
		var color: vec3f;
		if (degree >= 2.0) {
			color = vec3f(0.0, 1.0, degree - 2.0);
		} else if (degree >= 1.0) {
			color = vec3f(2.0 - degree, 1.0, 0.0);
		} else if (degree >= 0.0) {
			color = vec3f(1.0, degree, 0.0);
		} else if (degree >= -1.0) {
			color = vec3f(1.0, 0.0, -degree);
		} else if (degree >= -2.0) {
			color = vec3f(degree + 2.0, 0.0, 1.0);
		} else {
			color = vec3f(0.0, -2.0 - degree, 1.0);
		}

		let handleDist = abs(dot(handlePerp, position));
		if (handleDist < handleWidthTotalHalfUnit) {
			let handleAngle = dot(ring.handle, position);
			if (handleAngle > 0.0) {
				var interp: f32 = 1.0;
				let handleColorVal = (dist - innerRad) / (outerRad - innerRad);
				let handleColor = vec3f(handleColorVal, handleColorVal, handleColorVal);
				if (handleDist > handleWidthHalfUnit) {
					interp = (handleWidthTotalHalfUnit - handleDist) / fadeUnit;
				}
				color = mix(color, handleColor, interp);
			}
		}

		var alpha: f32 = 1.0;
		if (dist < innerRad + fadeUnit) {
			alpha = (dist - innerRad) / fadeUnit;
		} else if (dist > outerRad - fadeUnit) {
			alpha = -(dist - outerRad) / fadeUnit;
		}

		fragColor = vec4f(color, alpha);
	}

	let handleTriDiff = position - ring.handleTri;
	let triLengthSq = dot(handleTriDiff, handleTriDiff);
	if (triLengthSq < handleTriUnitSq) {
		let triLength = sqrt(triLengthSq) / unit;
		if (triLength < handleRad - handleTriWidthTotalHalf) {
			fragColor = vec4f(ring.colorBase, 1.0);
		} else if (triLength < handleRad - handleTriWidthHalf - handleTriWidth) {
			let interp = (handleRad - handleTriWidthHalf - handleTriWidth - triLength) / antialias;
			fragColor = vec4f(ring.colorBase * interp, 1.0);
		} else if (triLength < handleRad - handleTriWidthHalf) {
			let interp = 1.0 - (handleRad - handleTriWidthHalf - triLength) / handleTriWidth;
			fragColor = vec4f(interp, interp, interp, 1.0);
		} else if (triLength < handleRad + handleTriWidthHalf) {
			fragColor = vec4f(1.0, 1.0, 1.0, 1.0);
		} else if (triLength < handleRad + handleTriWidthHalf + handleTriWidth) {
			let interp = (handleRad + handleTriWidthHalf + handleTriWidth - triLength) / handleTriWidth;
			fragColor = vec4f(interp, interp, interp, 1.0);
		} else {
			let interp = (handleRad + handleTriWidthHalf + handleTriWidth + antialias - triLength) / antialias;
			fragColor = mix(fragColor, vec4f(0.0, 0.0, 0.0, interp), interp);
		}
	}
	return fragColor;
}
`;

/**
 * The triangle's shaders, WebGL's (`TRIANGLE_VERTEX`, `TRIANGLE_FRAGMENT`):
 * corner 0 in the hue, 1 white, 2 black, the corners' colours blended and
 * faded inside each edge over the antialias width.
 */
export const TRIANGLE_WGSL = /* wgsl */ `
struct Triangle {
	pos0: vec2f,
	pos1: vec2f,
	pos2: vec2f,
	unit: f32,
	antialias: f32,
	color: vec3f,
}

@group(0) @binding(0) var<uniform> tri: Triangle;

struct Varyings {
	@builtin(position) position: vec4f,
	@location(0) vertexPosition: vec2f,
	@location(1) color: vec3f,
}

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> Varyings {
	var varyings: Varyings;
	if (index == 0u) {
		varyings.vertexPosition = tri.pos0;
		varyings.color = tri.color;
	} else if (index == 1u) {
		varyings.vertexPosition = tri.pos1;
		varyings.color = vec3f(1.0, 1.0, 1.0);
	} else {
		varyings.vertexPosition = tri.pos2;
		varyings.color = vec3f(0.0, 0.0, 0.0);
	}
	varyings.position = vec4f(varyings.vertexPosition * 2.0, 0.0, 1.0);
	return varyings;
}

@fragment
fn fragmentMain(varyings: Varyings) -> @location(0) vec4f {
	let dir_0_1_unit = normalize(tri.pos1 - tri.pos0);
	let dir_1_2_unit = normalize(tri.pos2 - tri.pos1);
	let dir_2_0_unit = normalize(tri.pos0 - tri.pos2);
	let perp_0_1_unit = vec2f(dir_0_1_unit.y, -dir_0_1_unit.x);
	let perp_1_2_unit = vec2f(dir_1_2_unit.y, -dir_1_2_unit.x);
	let perp_2_0_unit = vec2f(dir_2_0_unit.y, -dir_2_0_unit.x);

	let mid_0_1 = (tri.pos0 + tri.pos1) * 0.5;
	let mid_1_2 = (tri.pos1 + tri.pos2) * 0.5;
	let mid_2_0 = (tri.pos2 + tri.pos0) * 0.5;

	let fadeRange = tri.antialias * tri.unit;

	let length0 = dot(perp_0_1_unit, varyings.vertexPosition - mid_0_1);
	let length1 = dot(perp_1_2_unit, varyings.vertexPosition - mid_1_2);
	let length2 = dot(perp_2_0_unit, varyings.vertexPosition - mid_2_0);
	let nearest = min(min(length0, length1), length2);
	var alpha: f32 = 1.0;
	if (nearest < fadeRange) {
		alpha = nearest / fadeRange;
	}
	return vec4f(varyings.color, alpha);
}
`;

/** The floats each shader's uniforms take, laid out as its struct is: 48 bytes, the colour's vec3 at the 32nd and the last float spare. */
const UNIFORM_FLOATS = 12;

/** The triangle's uniforms as `Triangle` lays them out: its corners, a logical pixel's share, the fade, then the hue. */
export const triangleFloats = (uniforms: WheelUniforms): Float32Array<ArrayBuffer> => {
	const { corners, triangleUnit, antialias, hue } = uniforms;
	return new Float32Array([...corners[0], ...corners[1], ...corners[2], triangleUnit, antialias, ...hue, 0]);
};

/** The ring's uniforms as `Ring` lays them out: the hue's direction, the handle's place, a logical pixel's share, the radii, the fade, then the base colour. */
export const ringFloats = (uniforms: WheelUniforms): Float32Array<ArrayBuffer> => {
	const { handle, handleTri, ringUnit, innerRad, outerRad, antialias, base } = uniforms;
	return new Float32Array([...handle, ...handleTri, ringUnit, innerRad, outerRad, antialias, ...base, 0]);
};

/** Blended as WebGL's `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)` blends: the alpha by the same factors as the colour. */
const BLEND: GPUBlendState = {
	color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
	alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

/** A pipeline with its uniforms' buffer and their bind group, and the vertices it draws. */
interface Stage {
	pipeline: GPURenderPipeline;
	uniforms: GPUBuffer;
	group: GPUBindGroup;
	vertices: number;
}

/** What it draws with once its device has come: the device, then the triangle's stage and the ring's, drawn in that order. */
interface Drawing {
	device: GPUDevice;
	stages: readonly [Stage, Stage];
}

/** Makes a stage from a shader's code, its pipeline drawing into the canvas's format with no culling, blended as WebGL's. */
const stageOf = async (device: GPUDevice, code: string, format: GPUTextureFormat, vertices: number): Promise<Stage> => {
	const module = device.createShaderModule({ code });
	const pipeline = await device.createRenderPipelineAsync({
		layout: 'auto',
		vertex: { module, entryPoint: 'vertexMain' },
		fragment: { module, entryPoint: 'fragmentMain', targets: [{ format, blend: BLEND }] },
		primitive: { topology: 'triangle-list', cullMode: 'none' },
	});
	const uniforms = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] });
	return { pipeline, uniforms, group, vertices };
};

/**
 * Makes the wheel's WebGPU renderer on the canvas given, or on a canvas of
 * its own; null where the browser offers no WebGPU or gives the canvas no
 * WebGPU context. It asks the browser for its device at once and can draw
 * once the device has come and its pipelines are made, telling `events` as
 * they come or as they never will; a canvas drawn at a geometry of another
 * size is resized first. Its device lost, it tells `events`, after which it
 * draws nothing.
 */
export const makeWebGPUWheel = (canvas: HTMLCanvasElement = document.createElement('canvas'), events?: RendererEvents): WheelRenderer | null => {
	const gpu = typeof navigator === 'undefined' ? undefined : navigator.gpu;
	if (!gpu) return null;
	const context = canvas.getContext('webgpu');
	if (!context) return null;

	let drawing: Drawing | null = null;
	// Whether it is done with: its device lost, or never to come.
	let lost = false;
	const lose = (): void => {
		if (lost) return;
		lost = true;
		drawing = null;
		events?.lost();
	};

	const come = async (): Promise<void> => {
		const adapter = await gpu.requestAdapter();
		if (!adapter) throw new Error('The browser offers no WebGPU adapter');
		const device = await adapter.requestDevice();
		void device.lost.then(lose);
		const format = gpu.getPreferredCanvasFormat();
		context.configure({ device, format, alphaMode: 'premultiplied' });
		const stages = await Promise.all([stageOf(device, TRIANGLE_WGSL, format, 3), stageOf(device, RING_WGSL, format, 6)]);
		if (lost) return;
		drawing = { device, stages };
		events?.ready();
	};
	come().catch(lose);

	const draw = (geometry: WheelGeometry, terms: WheelTerms): boolean => {
		if (!drawing) return false;
		const { device, stages: [triangle, ring] } = drawing;
		if (canvas.width !== geometry.width) canvas.width = geometry.width;
		if (canvas.height !== geometry.height) canvas.height = geometry.height;
		const uniforms = wheelUniforms(geometry, terms);
		device.queue.writeBuffer(triangle.uniforms, 0, triangleFloats(uniforms));
		device.queue.writeBuffer(ring.uniforms, 0, ringFloats(uniforms));

		const encoder = device.createCommandEncoder();
		const pass = encoder.beginRenderPass({
			colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
		});
		for (const stage of [triangle, ring]) {
			pass.setPipeline(stage.pipeline);
			pass.setBindGroup(0, stage.group);
			pass.draw(stage.vertices);
		}
		pass.end();
		device.queue.submit([encoder.finish()]);
		return true;
	};

	return {
		canvas,
		get ready() {
			return drawing !== null;
		},
		draw,
	};
};
