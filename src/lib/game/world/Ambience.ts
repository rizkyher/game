import * as THREE from 'three';
import type { Terrain } from './Terrain';
import { worldUniforms } from './Materials';
import { SUN_DIR } from './Sky';
import { Random } from '../utils/Random';
import { WORLD_HALF, forestMask, sanctuaryMask } from './WorldLayout';

/**
 * Atmosphere that follows the camera: drifting motes/fireflies (one Points draw whose
 * particles wrap around the viewer) and instanced god-ray shafts in forest clearings.
 */
export class Ambience {
	readonly motes: THREE.Points;
	readonly shafts: THREE.Mesh;
	private moteMat: THREE.ShaderMaterial;
	private shaftMat: THREE.ShaderMaterial;
	readonly moteColor = new THREE.Color(0xfff0b0);

	constructor(terrain: Terrain) {
		const count = 900;
		const area = 70;
		const rng = new Random(4040);
		const pos = new Float32Array(count * 3);
		const seed = new Float32Array(count);
		for (let i = 0; i < count; i++) {
			pos[i * 3] = rng.range(0, area);
			pos[i * 3 + 1] = rng.range(0, 14);
			pos[i * 3 + 2] = rng.range(0, area);
			seed[i] = rng.next();
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
		geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
		this.moteMat = new THREE.ShaderMaterial({
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			uniforms: {
				uTime: worldUniforms.uTime,
				uCenter: { value: new THREE.Vector3() },
				uArea: { value: area },
				uColor: { value: this.moteColor },
				uScale: { value: 600 },
				uGround: { value: 0 }
			},
			vertexShader: /* glsl */ `
				uniform float uTime;
				uniform vec3 uCenter;
				uniform float uArea;
				uniform float uScale;
				uniform float uGround;
				attribute float aSeed;
				varying float vA;
				void main() {
					vec3 p = position;
					p.x += sin(uTime * 0.3 + aSeed * 40.0) * 2.0 + uTime * 0.4;
					p.z += cos(uTime * 0.25 + aSeed * 31.0) * 2.0;
					p.y += sin(uTime * 0.6 + aSeed * 17.0) * 0.8;
					vec2 w = p.xz - uArea * floor((p.xz - uCenter.xz) / uArea + 0.5);
					vec3 wp = vec3(w.x, uGround + p.y, w.y);
					vec4 mv = modelViewMatrix * vec4(wp, 1.0);
					float d = length(wp.xz - uCenter.xz);
					float twinkle = 0.5 + 0.5 * sin(uTime * (2.0 + aSeed * 3.0) + aSeed * 60.0);
					vA = twinkle * (1.0 - smoothstep(uArea * 0.32, uArea * 0.5, d)) * smoothstep(0.5, 4.0, -mv.z);
					gl_PointSize = (0.12 + aSeed * 0.12) * uScale / max(0.5, -mv.z);
					gl_Position = projectionMatrix * mv;
				}
			`,
			fragmentShader: /* glsl */ `
				uniform vec3 uColor;
				varying float vA;
				void main() {
					float d = length(gl_PointCoord - 0.5);
					float a = smoothstep(0.5, 0.0, d);
					gl_FragColor = vec4(uColor * 2.5 * a * vA, a * vA);
				}
			`
		});
		this.motes = new THREE.Points(geo, this.moteMat);
		this.motes.frustumCulled = false;
		this.motes.renderOrder = 5;

		// God-ray shafts: quads stretched along the sun direction, billboarded around that axis.
		const shaftPos: number[] = [];
		const shaftRng = new Random(5050);
		let tries = 0;
		while (shaftPos.length < 40 * 4 && tries++ < 4000) {
			const x = shaftRng.range(-WORLD_HALF + 40, WORLD_HALF - 40);
			const z = shaftRng.range(-WORLD_HALF + 40, WORLD_HALF - 40);
			const inForest = forestMask(x, z) > 0.7;
			const inSanct = sanctuaryMask(x, z) > 0.7 && shaftRng.chance(0.25);
			if (!inForest && !inSanct) continue;
			shaftPos.push(x, terrain.heightAt(x, z), z, shaftRng.range(3, 7));
		}
		const n = shaftPos.length / 4;
		const quad = new THREE.InstancedBufferGeometry();
		quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
		quad.setIndex([0, 1, 2, 0, 2, 3]);
		quad.setAttribute('aShaft', new THREE.InstancedBufferAttribute(new Float32Array(shaftPos), 4));
		quad.instanceCount = n;
		quad.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
		this.shaftMat = new THREE.ShaderMaterial({
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
			uniforms: { uSun: { value: SUN_DIR }, uTime: worldUniforms.uTime, uColor: { value: new THREE.Color(0xffd9a0) }, uStrength: { value: 0.18 } },
			vertexShader: /* glsl */ `
				uniform vec3 uSun;
				uniform float uTime;
				attribute vec4 aShaft;
				varying float vA;
				varying vec2 vUv;
				void main() {
					float len = 42.0;
					vec3 base = aShaft.xyz;
					vec3 axis = normalize(uSun);
					vec3 toCam = normalize(cameraPosition - base);
					vec3 side = normalize(cross(axis, toCam));
					vec3 wp = base + axis * (position.y * len) + side * position.x * aShaft.w * (1.0 + position.y * 0.6);
					vUv = vec2(position.x + 0.5, position.y);
					float dist = length(cameraPosition - wp);
					vA = smoothstep(4.0, 22.0, dist) * (1.0 - smoothstep(160.0, 260.0, dist)) * (0.7 + 0.3 * sin(uTime * 0.4 + aShaft.x));
					gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
				}
			`,
			fragmentShader: /* glsl */ `
				uniform vec3 uColor;
				uniform float uStrength;
				varying float vA;
				varying vec2 vUv;
				void main() {
					float edge = sin(vUv.x * 3.14159);
					float fade = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
					float a = edge * edge * fade * vA * uStrength;
					gl_FragColor = vec4(uColor * a, a);
				}
			`
		});
		this.shafts = new THREE.Mesh(quad, this.shaftMat);
		this.shafts.frustumCulled = false;
		this.shafts.renderOrder = 4;
	}

	setViewport(height: number, fovDeg: number): void {
		this.moteMat.uniforms.uScale.value = height / (2 * Math.tan((fovDeg * Math.PI) / 360));
	}

	update(cam: THREE.Vector3, groundY: number, color: THREE.Color, gloom: number): void {
		this.moteMat.uniforms.uCenter.value.copy(cam);
		this.moteMat.uniforms.uGround.value = groundY - 1;
		this.moteColor.lerp(color, 0.03);
		this.shaftMat.uniforms.uStrength.value = 0.18 * (1 - gloom);
	}

	dispose(): void {
		this.motes.geometry.dispose();
		this.moteMat.dispose();
		this.shafts.geometry.dispose();
		this.shaftMat.dispose();
	}
}
