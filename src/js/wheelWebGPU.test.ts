/**
 * @fileoverview The wheel drawn by WebGPU, on a stand-in for the browser's
 * WebGPU that records what it is asked: whether the renderer can be had, its
 * device coming after it is made, or never, or lost, and what it draws with
 * and in what order once the device has come. Its drawing itself, its shaders
 * run on a GPU against WebGL's, is checked in a browser.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RING_WGSL, TRIANGLE_WGSL, makeWebGPUWheel, ringFloats, triangleFloats } from './wheelWebGPU.ts';
import { wheelGeometry, wheelUniforms, type WheelTerms } from './wheel.ts';

const GEOMETRY = wheelGeometry(360, 360, 180, 2);
const TERMS: WheelTerms = { unit: [1, 0], hue: [255, 0, 0], base: [255, 139, 48], saturation: 0.8, intensity: 0.4 };

/** How the stand-in's adapter, device and pipelines come: each as the browser gives them, or not at all. */
interface Comes {
	adapter?: boolean;
	device?: boolean;
	pipelines?: boolean;
	/** Whether the canvas gives a WebGPU context. */
	context?: boolean;
}

/** A stand-in for the browser's WebGPU and a canvas, with a record of what is asked of each, and a way to lose the device. */
const standIn = (comes: Comes = {}) => {
	const asked = {
		configured: [] as unknown[],
		modules: [] as string[],
		pipelines: [] as { fragment: { targets: { format: string; blend: unknown }[] }; primitive: unknown }[],
		writes: [] as { buffer: number; floats: number[] }[],
		/** Each pass's clear, then each stage it drew: its shader's code and the vertices drawn. */
		passes: [] as { clear: unknown; loadOp: string; stages: { code: string; vertices: number }[] }[],
		submits: 0,
	};
	let lose!: (info: unknown) => void;
	const lost = new Promise((resolve) => {
		lose = resolve;
	});
	let buffers = 0;
	const device = {
		lost,
		queue: {
			writeBuffer: (buffer: { id: number }, _offset: number, data: Float32Array) => asked.writes.push({ buffer: buffer.id, floats: [...data] }),
			submit: (commands: unknown[]) => {
				asked.submits += commands.length;
			},
		},
		createShaderModule: ({ code }: { code: string }) => {
			asked.modules.push(code);
			return { code };
		},
		createRenderPipelineAsync: async (descriptor: { vertex: { module: { code: string } } } & (typeof asked.pipelines)[number]) => {
			if (comes.pipelines === false) throw new Error('The pipeline could not be made');
			asked.pipelines.push(descriptor);
			return { code: descriptor.vertex.module.code, getBindGroupLayout: () => ({}) };
		},
		createBuffer: () => ({ id: buffers++ }),
		createBindGroup: () => ({}),
		createCommandEncoder: () => ({
			beginRenderPass: ({ colorAttachments: [attachment] }: { colorAttachments: { clearValue: unknown; loadOp: string }[] }) => {
				const pass = { clear: attachment.clearValue, loadOp: attachment.loadOp, stages: [] as { code: string; vertices: number }[] };
				let code = '';
				return {
					setPipeline: (pipeline: { code: string }) => {
						code = pipeline.code;
					},
					setBindGroup: () => { },
					draw: (vertices: number) => pass.stages.push({ code, vertices }),
					end: () => asked.passes.push(pass),
				};
			},
			finish: () => ({}),
		}),
	};
	const gpu = {
		requestAdapter: async () => (comes.adapter === false ? null : {
			requestDevice: async () => {
				if (comes.device === false) throw new Error('The device was refused');
				return device;
			},
		}),
		getPreferredCanvasFormat: () => 'bgra8unorm',
	};
	const context = {
		configure: (configuration: unknown) => asked.configured.push(configuration),
		getCurrentTexture: () => ({ createView: () => ({}) }),
	};
	const canvas = { width: 300, height: 150, getContext: (kind: string) => (kind === 'webgpu' && comes.context !== false ? context : null) };
	vi.stubGlobal('navigator', { gpu });
	vi.stubGlobal('GPUBufferUsage', { UNIFORM: 0x40, COPY_DST: 0x8 });
	const events = { ready: vi.fn(), lost: vi.fn() };
	return { asked, device, canvas: canvas as unknown as HTMLCanvasElement, events, lose };
};

/** Lets the stand-in's promises settle, as the browser's adapter, device and pipelines come. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the wheel drawn by WebGPU', () => {
	it('is had only where the browser offers WebGPU and gives the canvas a WebGPU context', () => {
		const { canvas, events } = standIn({ context: false });
		expect(makeWebGPUWheel(canvas, events)).toBeNull();
		const offered = standIn();
		vi.stubGlobal('navigator', {});
		expect(makeWebGPUWheel(offered.canvas, offered.events)).toBeNull();
	});

	it('draws nothing till its device comes, then tells it came and draws the triangle and then the ring in one pass, cleared first, from the wheel\'s uniforms', async () => {
		const { asked, device, canvas, events } = standIn();
		const renderer = makeWebGPUWheel(canvas, events)!;
		expect(renderer.canvas).toBe(canvas);
		expect(renderer.ready).toBe(false);
		expect(renderer.draw(GEOMETRY, TERMS)).toBe(false);
		await settle();
		expect(events.ready).toHaveBeenCalledTimes(1);
		expect(events.lost).not.toHaveBeenCalled();
		expect(renderer.ready).toBe(true);
		expect(asked.configured).toEqual([{ device, format: 'bgra8unorm', alphaMode: 'premultiplied' }]);
		expect(asked.modules).toEqual([TRIANGLE_WGSL, RING_WGSL]);
		// Blended as WebGL's blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA) blends, the alpha by the colour's factors, with no culling.
		const blend = { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' };
		for (const pipeline of asked.pipelines) {
			expect(pipeline.fragment.targets).toEqual([{ format: 'bgra8unorm', blend: { color: blend, alpha: blend } }]);
			expect(pipeline.primitive).toEqual({ topology: 'triangle-list', cullMode: 'none' });
		}
		expect(asked.submits).toBe(0);

		expect(renderer.draw(GEOMETRY, TERMS)).toBe(true);
		expect([canvas.width, canvas.height]).toEqual([360, 360]);
		const uniforms = wheelUniforms(GEOMETRY, TERMS);
		expect(asked.writes.map(({ floats }) => floats)).toEqual([[...triangleFloats(uniforms)], [...ringFloats(uniforms)]]);
		expect(asked.passes).toEqual([{ clear: [0, 0, 0, 0], loadOp: 'clear', stages: [{ code: TRIANGLE_WGSL, vertices: 3 }, { code: RING_WGSL, vertices: 6 }] }]);
		expect(asked.submits).toBe(1);
	});

	it('lays out each shader\'s uniforms in the order its struct declares them', () => {
		const uniforms = wheelUniforms(GEOMETRY, TERMS);
		const { corners, hue, handle, handleTri, base } = uniforms;
		expect(TRIANGLE_WGSL).toMatch(/struct Triangle \{\s*pos0: vec2f,\s*pos1: vec2f,\s*pos2: vec2f,\s*unit: f32,\s*antialias: f32,\s*color: vec3f,\s*\}/);
		expect([...triangleFloats(uniforms)]).toEqual([...corners[0], ...corners[1], ...corners[2], uniforms.triangleUnit, uniforms.antialias, ...hue, 0].map(Math.fround));
		expect(RING_WGSL).toMatch(/struct Ring \{\s*handle: vec2f,\s*handleTri: vec2f,\s*unit: f32,\s*innerRad: f32,\s*outerRad: f32,\s*antialias: f32,\s*colorBase: vec3f,\s*\}/);
		expect([...ringFloats(uniforms)]).toEqual([...handle, ...handleTri, uniforms.ringUnit, uniforms.innerRad, uniforms.outerRad, uniforms.antialias, ...base, 0].map(Math.fround));
	});

	it('tells it is lost, never ready, where no adapter or device comes or its pipelines cannot be made', async () => {
		for (const comes of [{ adapter: false }, { device: false }, { pipelines: false }]) {
			const { asked, canvas, events } = standIn(comes);
			const renderer = makeWebGPUWheel(canvas, events)!;
			await settle();
			expect(events.lost).toHaveBeenCalledTimes(1);
			expect(events.ready).not.toHaveBeenCalled();
			expect(renderer.ready).toBe(false);
			expect(renderer.draw(GEOMETRY, TERMS)).toBe(false);
			expect(asked.submits).toBe(0);
			vi.unstubAllGlobals();
		}
	});

	it('tells it is lost as its device is lost, once, and draws nothing after; a device lost before its pipelines are made is never told as come', async () => {
		const { asked, canvas, events, lose } = standIn();
		const renderer = makeWebGPUWheel(canvas, events)!;
		await settle();
		lose({ reason: 'unknown' });
		await settle();
		expect(events.lost).toHaveBeenCalledTimes(1);
		expect(renderer.ready).toBe(false);
		expect(renderer.draw(GEOMETRY, TERMS)).toBe(false);
		expect(asked.submits).toBe(0);

		const early = standIn();
		const lostEarly = makeWebGPUWheel(early.canvas, early.events)!;
		early.lose({ reason: 'unknown' });
		await settle();
		expect(early.events.lost).toHaveBeenCalledTimes(1);
		expect(early.events.ready).not.toHaveBeenCalled();
		expect(lostEarly.ready).toBe(false);
	});
});
