import * as THREE from 'three';
import { GRID, WORLD_HALF } from './Biomes';

/** Uniforms shared by every wind-animated material; updated once per frame by the world. */
export const windUniforms = {
	uTime: { value: 0 },
	uWind: { value: new THREE.Vector2(0.6, 0.2) }
};

const SWAY_GLSL = /* glsl */ `
	#ifdef USE_INSTANCING
		mat3 swayM = mat3(instanceMatrix);
		vec3 swayBase = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
	#else
		mat3 swayM = mat3(modelMatrix);
		vec3 swayBase = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
	#endif
	float swayS = length(swayM[0]);
	float swayH = clamp(transformed.y * uBendInv, 0.0, 1.4);
	float swayK = swayH * swayH;
	float swayPhase = swayBase.x * 0.13 + swayBase.z * 0.17;
	float swayOsc = sin(uTime * 1.7 + swayPhase) * 0.65 + sin(uTime * 2.9 + swayPhase * 1.9) * 0.3;
	vec2 swayW = uWind * (0.55 + 0.45 * swayOsc);
	#ifdef USE_WOBBLE
		swayW += aWobble.xy * aWobble.z * sin(uTime * 13.0 + swayPhase) * 2.5;
	#endif
	vec3 swayWorld = vec3(swayW.x, 0.0, swayW.y) * swayK * swayS * uBendAmount;
	vec3 swayLocal = (transpose(swayM) * swayWorld) / (swayS * swayS);
	transformed += swayLocal;
	transformed.y -= length(swayLocal.xz) * 0.25 * swayK;
`;

// three r18x uses a vec4 vColor varying.
const TINT_GLSL = /* glsl */ `
	vColor = vec4(1.0);
	#ifdef USE_COLOR
		vColor.rgb *= color;
	#endif
	#ifdef USE_INSTANCING_COLOR
		vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aTint);
	#endif
`;

/** Lambert material where only aTint = 1 vertices take the instance colour (no wind). */
export function tintMaterial(params: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial {
	const mat = new THREE.MeshLambertMaterial(params);
	mat.onBeforeCompile = (shader) => {
		shader.vertexShader = 'attribute float aTint;\n' + shader.vertexShader.replace('#include <color_vertex>', TINT_GLSL);
	};
	mat.customProgramCacheKey = () => 'tint';
	return mat;
}

export interface WindOptions {
	/** Local-space height of the geometry; bending scales with y / height. */
	height: number;
	/** World-space bend at the top per unit wind. */
	amount: number;
	/** Adds a per-instance aWobble (dirX, dirZ, amplitude) attribute for touch reactions. */
	wobble?: boolean;
	/** Only vertices with aTint = 1 receive the per-instance colour. */
	tint?: boolean;
}

/** Lambert material with vertex colours and GPU wind sway. Works for meshes and InstancedMeshes. */
export function windMaterial(params: THREE.MeshLambertMaterialParameters, opts: WindOptions): THREE.MeshLambertMaterial {
	const mat = new THREE.MeshLambertMaterial(params);
	const key = `wind-${opts.wobble ? 'w' : 'n'}-${opts.tint ? 't' : 'n'}-${opts.height}-${opts.amount}`;
	mat.onBeforeCompile = (shader) => {
		shader.uniforms.uTime = windUniforms.uTime;
		shader.uniforms.uWind = windUniforms.uWind;
		shader.uniforms.uBendInv = { value: 1 / opts.height };
		shader.uniforms.uBendAmount = { value: opts.amount };
		let header = 'uniform float uTime;\nuniform vec2 uWind;\nuniform float uBendInv;\nuniform float uBendAmount;\n';
		if (opts.wobble) header += '#define USE_WOBBLE\nattribute vec3 aWobble;\n';
		let vs = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWAY_GLSL);
		if (opts.tint) {
			header += 'attribute float aTint;\n';
			vs = vs.replace('#include <color_vertex>', TINT_GLSL);
		}
		shader.vertexShader = header + vs;
	};
	mat.customProgramCacheKey = () => key;
	return mat;
}

/**
 * Grass: one instanced draw of blades that wrap around the camera. Blade height and
 * colour come from the terrain data texture (height, density, forestness).
 */
export function grassMaterial(dataTex: THREE.DataTexture): THREE.MeshLambertMaterial {
	const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
	const uniforms = {
		uTime: windUniforms.uTime,
		uWind: windUniforms.uWind,
		uData: { value: dataTex },
		uCenter: { value: new THREE.Vector2() },
		uPlayer: { value: new THREE.Vector3() },
		uArea: { value: 90 },
		uRadius: { value: 45 },
		uBlade: { value: 2.6 }
	};
	mat.userData.uniforms = uniforms;
	mat.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader =
			/* glsl */ `
			uniform float uTime;
			uniform vec2 uWind;
			uniform sampler2D uData;
			uniform vec2 uCenter;
			uniform vec3 uPlayer;
			uniform float uArea;
			uniform float uRadius;
			uniform float uBlade;
			attribute vec4 aOffset;
			const float WORLD_HALF = ${WORLD_HALF.toFixed(1)};
			const float GRID_V = ${(GRID + 1).toFixed(1)};
		` +
			shader.vertexShader
				.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
				.replace(
					'#include <begin_vertex>',
					/* glsl */ `
			vec2 gOff = aOffset.xy;
			vec2 gWp = gOff - uArea * floor((gOff - uCenter) / uArea + 0.5);
			vec2 gUv = ((gWp + WORLD_HALF) / (2.0 * WORLD_HALF)) * ((GRID_V - 1.0) / GRID_V) + 0.5 / GRID_V;
			vec4 gData = texture2D(uData, gUv);
			float gKeep = step(aOffset.z, gData.g);
			float gDist = length(gWp - uCenter);
			float gFade = 1.0 - smoothstep(uRadius * 0.7, uRadius, gDist);
			float gScale = gKeep * gFade * (0.55 + aOffset.w * 0.9) * mix(1.0, 0.75, gData.b);
			float gAng = aOffset.z * 61.0 + aOffset.w * 17.0;
			float gc = cos(gAng);
			float gs = sin(gAng);
			vec3 gP = position;
			float gT = gP.y;
			gP.x *= 0.75 + aOffset.w * 0.6;
			gP.y *= uBlade * gScale;
			gP.x *= step(0.001, gScale);
			gP = vec3(gP.x * gc, gP.y, gP.x * gs);
			float gPhase = gWp.x * 0.15 + gWp.y * 0.11;
			vec2 gWind = uWind * (0.6 + 0.5 * sin(uTime * 2.1 + gPhase)) + vec2(sin(uTime * 3.3 + gPhase * 2.0), cos(uTime * 2.7 + gPhase)) * 0.12;
			vec2 gTo = gWp - uPlayer.xz;
			float gPd = length(gTo) + 0.0001;
			float gPush = (1.0 - smoothstep(0.5, 4.0, gPd)) * (1.0 - smoothstep(1.0, 5.0, uPlayer.y - gData.r));
			vec2 gBend = gWind * 0.9 + (gTo / gPd) * gPush * 2.2;
			gP.xz += gBend * gT * gT * uBlade * gScale;
			gP.y -= length(gBend) * gT * gT * 0.35 * gScale;
			vec3 transformed = vec3(gWp.x, gData.r - 0.05, gWp.y) + gP;
			// Linear-space colours (they brighten a lot after sRGB output).
			vec3 gMeadow = mix(vec3(0.2, 0.46, 0.07), vec3(0.42, 0.62, 0.1), aOffset.w);
			vec3 gForest = mix(vec3(0.07, 0.22, 0.05), vec3(0.16, 0.36, 0.08), aOffset.w);
			vColor = vec4(mix(gMeadow, gForest, gData.b) * mix(0.4, 1.08, gT), 1.0);
		`
				)
				.replace('#include <color_vertex>', '');
	};
	mat.customProgramCacheKey = () => 'grass';
	return mat;
}

export function grassGeometry(maxBlades: number, area: number, seed: number): THREE.InstancedBufferGeometry {
	const geo = new THREE.InstancedBufferGeometry();
	// Tapered three-segment blade, x in [-0.5, 0.5] * width, y in [0, 1].
	const w = 0.32;
	const ys = [0, 0.4, 0.75];
	const ws = [1, 0.78, 0.45];
	const pos: number[] = [];
	for (let i = 0; i < ys.length; i++) {
		pos.push(-0.5 * w * ws[i], ys[i], 0, 0.5 * w * ws[i], ys[i], 0);
	}
	pos.push(0, 1, 0);
	const idx = [0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6];
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
	geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
	geo.setIndex(idx);
	const offsets = new Float32Array(maxBlades * 4);
	let s = seed >>> 0;
	const rnd = () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	for (let i = 0; i < maxBlades; i++) {
		offsets[i * 4] = rnd() * area;
		offsets[i * 4 + 1] = rnd() * area;
		offsets[i * 4 + 2] = rnd();
		offsets[i * 4 + 3] = rnd();
	}
	geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 4));
	geo.instanceCount = maxBlades;
	geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
	return geo;
}
