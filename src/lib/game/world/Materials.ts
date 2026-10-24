import * as THREE from 'three';
import { GRID, WORLD_HALF } from './WorldLayout';

/** Uniforms shared by every animated world material; updated once per frame by the world. */
export const worldUniforms = {
	uTime: { value: 0 },
	uWind: { value: new THREE.Vector2(0.5, 0.25) },
	/** Player position, used by grass bending and proximity glow. */
	uPlayer: { value: new THREE.Vector3() }
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
	float swayOsc = sin(uTime * 1.5 + swayPhase) * 0.65 + sin(uTime * 2.6 + swayPhase * 1.9) * 0.3;
	vec2 swayW = uWind * (0.55 + 0.45 * swayOsc);
	vec3 swayWorld = vec3(swayW.x, 0.0, swayW.y) * swayK * swayS * uBendAmount;
	vec3 swayLocal = (transpose(swayM) * swayWorld) / (swayS * swayS);
	transformed += swayLocal;
	transformed.y -= length(swayLocal.xz) * 0.25 * swayK;
`;

export interface WindOptions {
	/** Local-space height of the geometry; bending scales with y / height. */
	height: number;
	/** World-space bend at the top per unit wind. */
	amount: number;
}

/** Lambert material with vertex colours and GPU wind sway. Works for meshes and InstancedMeshes. */
export function windMaterial(params: THREE.MeshLambertMaterialParameters, opts: WindOptions): THREE.MeshLambertMaterial {
	const mat = new THREE.MeshLambertMaterial(params);
	const key = `wind-${opts.height}-${opts.amount}-${params.emissive ? 'e' : 'n'}`;
	mat.onBeforeCompile = (shader) => {
		shader.uniforms.uTime = worldUniforms.uTime;
		shader.uniforms.uWind = worldUniforms.uWind;
		shader.uniforms.uBendInv = { value: 1 / opts.height };
		shader.uniforms.uBendAmount = { value: opts.amount };
		shader.vertexShader =
			'uniform float uTime;\nuniform vec2 uWind;\nuniform float uBendInv;\nuniform float uBendAmount;\n' +
			shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWAY_GLSL);
	};
	mat.customProgramCacheKey = () => key;
	return mat;
}

/**
 * Emissive glow that pulses per instance (crystals, mushrooms, runes). The `aGlow` vertex
 * attribute (0..1) marks which vertices glow; HDR emissive values feed the bloom pass.
 */
export function glowMaterial(
	params: THREE.MeshStandardMaterialParameters & { glow: THREE.ColorRepresentation; glowStrength?: number; pulse?: number; sway?: WindOptions }
): THREE.MeshStandardMaterial {
	const { glow, glowStrength = 2.2, pulse = 0.35, sway, ...rest } = params;
	const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, ...rest });
	const glowColor = new THREE.Color(glow);
	mat.userData.glowColor = glowColor;
	const key = `glow-${glowColor.getHexString()}-${glowStrength}-${pulse}-${sway ? `${sway.height}-${sway.amount}` : 'n'}`;
	mat.onBeforeCompile = (shader) => {
		shader.uniforms.uTime = worldUniforms.uTime;
		shader.uniforms.uWind = worldUniforms.uWind;
		shader.uniforms.uGlowColor = { value: glowColor };
		shader.uniforms.uGlowStrength = { value: glowStrength };
		shader.uniforms.uPulse = { value: pulse };
		shader.uniforms.uBendInv = { value: sway ? 1 / sway.height : 0 };
		shader.uniforms.uBendAmount = { value: sway ? sway.amount : 0 };
		shader.vertexShader =
			/* glsl */ `
			uniform float uTime;
			uniform vec2 uWind;
			uniform float uBendInv;
			uniform float uBendAmount;
			attribute float aGlow;
			varying float vGlow;
			varying float vPhase;
		` +
			shader.vertexShader.replace(
				'#include <begin_vertex>',
				/* glsl */ `#include <begin_vertex>
				vGlow = aGlow;
				#ifdef USE_INSTANCING
					vPhase = instanceMatrix[3][0] * 0.31 + instanceMatrix[3][2] * 0.17;
				#else
					vPhase = modelMatrix[3][0] * 0.31 + modelMatrix[3][2] * 0.17;
				#endif
				${sway ? SWAY_GLSL : ''}
			`
			);
		shader.fragmentShader =
			/* glsl */ `
			uniform float uTime;
			uniform vec3 uGlowColor;
			uniform float uGlowStrength;
			uniform float uPulse;
			varying float vGlow;
			varying float vPhase;
		` +
			shader.fragmentShader.replace(
				'#include <emissivemap_fragment>',
				/* glsl */ `#include <emissivemap_fragment>
				float pulseK = 1.0 - uPulse + uPulse * (0.5 + 0.5 * sin(uTime * 2.2 + vPhase));
				totalEmissiveRadiance += uGlowColor * vGlow * uGlowStrength * pulseK;
			`
			);
	};
	mat.customProgramCacheKey = () => key;
	return mat;
}

/** Terrain: vertex-coloured Lambert with world-space detail noise so wide slopes don't look flat. */
export function terrainMaterial(): THREE.MeshLambertMaterial {
	const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
	mat.onBeforeCompile = (shader) => {
		shader.vertexShader = 'varying vec3 vTerrainPos;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
		shader.fragmentShader =
			/* glsl */ `
			varying vec3 vTerrainPos;
			float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
			float tNoise(vec2 p) {
				vec2 i = floor(p); vec2 f = fract(p);
				vec2 u = f * f * (3.0 - 2.0 * f);
				return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
			}
		` +
			shader.fragmentShader.replace(
				'#include <color_fragment>',
				/* glsl */ `#include <color_fragment>
				float tn = tNoise(vTerrainPos.xz * 0.45) * 0.55 + tNoise(vTerrainPos.xz * 1.7) * 0.3 + tNoise(vTerrainPos.xz * 0.08) * 0.35;
				diffuseColor.rgb *= 0.78 + tn * 0.42;
			`
			);
	};
	mat.customProgramCacheKey = () => 'terrain-detail';
	return mat;
}

/**
 * Grass: one instanced draw of blades that wrap around the camera. Blade height and colour
 * come from the terrain data texture (height, density, forest, highland).
 */
export function grassMaterial(dataTex: THREE.DataTexture): THREE.MeshLambertMaterial {
	const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
	const uniforms = {
		uTime: worldUniforms.uTime,
		uWind: worldUniforms.uWind,
		uPlayer: worldUniforms.uPlayer,
		uData: { value: dataTex },
		uCenter: { value: new THREE.Vector2() },
		uArea: { value: 84 },
		uRadius: { value: 42 },
		uBlade: { value: 0.9 }
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
			float gSanct = smoothstep(-118.0, -150.0, gWp.y);
			float gScale = gKeep * gFade * (0.6 + aOffset.w * 0.7) * mix(1.0, 0.8, gData.b) * mix(1.0, 0.7, gSanct);
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
			float gPush = (1.0 - smoothstep(0.3, 1.6, gPd)) * (1.0 - smoothstep(0.5, 2.5, uPlayer.y - gData.r));
			vec2 gBend = gWind * 0.9 + (gTo / gPd) * gPush * 2.0;
			gP.xz += gBend * gT * gT * uBlade * gScale;
			gP.y -= length(gBend) * gT * gT * 0.35 * gScale;
			vec3 transformed = vec3(gWp.x, gData.r - 0.05, gWp.y) + gP;
			vec3 gVale = mix(vec3(0.2, 0.42, 0.06), vec3(0.5, 0.56, 0.1), aOffset.w);
			vec3 gForest = mix(vec3(0.03, 0.2, 0.12), vec3(0.1, 0.36, 0.2), aOffset.w);
			vec3 gHigh = mix(vec3(0.3, 0.34, 0.16), vec3(0.42, 0.26, 0.5), step(0.82, aOffset.w));
			vec3 gAsh = mix(vec3(0.22, 0.26, 0.17), vec3(0.32, 0.28, 0.34), aOffset.w);
			vec3 gCol = mix(gVale, gForest, gData.b);
			gCol = mix(gCol, gHigh, gData.a);
			gCol = mix(gCol, gAsh, gSanct);
			vColor = vec4(gCol * mix(0.6, 1.15, gT), 1.0);
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
	const w = 0.16;
	const ys = [0, 0.4, 0.75];
	const ws = [1, 0.78, 0.45];
	const pos: number[] = [];
	for (let i = 0; i < ys.length; i++) pos.push(-0.5 * w * ws[i], ys[i], 0, 0.5 * w * ws[i], ys[i], 0);
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

/** Adds an aGlow attribute (constant value) so glowMaterial can be used with merged geometry. */
export function withGlow(geo: THREE.BufferGeometry, glow: number): THREE.BufferGeometry {
	geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(glow), 1));
	return geo;
}
