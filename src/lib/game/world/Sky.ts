import * as THREE from 'three';
import { REGIONS, type RegionWeights } from './WorldLayout';
import { damp } from '../utils/math';

/** Direction towards the sun: low golden-hour sun in the west-south-west. */
export const SUN_DIR = new THREE.Vector3(-0.72, 0.46, 0.52).normalize();

const _c = new THREE.Color();
const _blend = { fog: new THREE.Color(), sky: new THREE.Color(), ground: new THREE.Color(), sun: new THREE.Color() };

/**
 * Gradient sky dome with procedural clouds and sun glow, hemisphere + directional lighting,
 * and region-driven atmosphere (fog colour/distance, light tint) blended by position.
 */
export class Sky {
	readonly sun: THREE.DirectionalLight;
	readonly hemi: THREE.HemisphereLight;
	readonly dome: THREE.Mesh;
	readonly fog: THREE.Fog;
	private uniforms: Record<string, THREE.IUniform>;
	private shadowExtent = 70;
	private fogNear = 90;
	private fogFar = 520;
	private drawDistance = 520;
	/** 0..1 darkening used by the boss arena / cutscenes. */
	gloom = 0;
	private gloomSmooth = 0;
	readonly fogColor = new THREE.Color(0xe9c6b4);

	constructor(private scene: THREE.Scene) {
		this.uniforms = {
			uTop: { value: new THREE.Color(0x26307a) },
			uMid: { value: new THREE.Color(0x6a7fd0) },
			uHorizon: { value: new THREE.Color(0xf2b58e) },
			uFog: { value: this.fogColor },
			uSunDir: { value: SUN_DIR },
			uSunColor: { value: new THREE.Color(0xffd29a) },
			uTime: { value: 0 },
			uGloom: { value: 0 }
		};
		const skyMat = new THREE.ShaderMaterial({
			side: THREE.BackSide,
			depthWrite: false,
			fog: false,
			uniforms: this.uniforms,
			vertexShader: /* glsl */ `
				varying vec3 vDir;
				void main() {
					vDir = normalize(position);
					vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
					gl_Position = p.xyww;
				}
			`,
			fragmentShader: /* glsl */ `
				uniform vec3 uTop;
				uniform vec3 uMid;
				uniform vec3 uHorizon;
				uniform vec3 uFog;
				uniform vec3 uSunDir;
				uniform vec3 uSunColor;
				uniform float uTime;
				uniform float uGloom;
				varying vec3 vDir;
				float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
				float noise(vec2 p) {
					vec2 i = floor(p); vec2 f = fract(p);
					vec2 u = f * f * (3.0 - 2.0 * f);
					return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
				}
				float fbm(vec2 p) {
					float s = 0.0; float a = 0.5;
					for (int i = 0; i < 5; i++) { s += noise(p) * a; p *= 2.03; a *= 0.5; }
					return s;
				}
				void main() {
					vec3 d = normalize(vDir);
					float h = d.y;
					vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.32, h));
					col = mix(col, uTop, smoothstep(0.3, 0.95, h));
					float s = max(dot(d, uSunDir), 0.0);
					// Warm haze around the sun near the horizon.
					col = mix(col, uSunColor, pow(s, 8.0) * 0.45 * (1.0 - smoothstep(0.0, 0.6, h)));
					// Wispy clouds on a virtual plane.
					if (h > 0.0) {
						vec2 uv = d.xz / (h + 0.18) * 1.6 + vec2(uTime * 0.006, uTime * 0.002);
						float c = fbm(uv);
						c = smoothstep(0.48, 0.82, c) * smoothstep(0.0, 0.18, h);
						vec3 cloudLit = mix(vec3(1.0, 0.82, 0.7), uSunColor * 1.3, pow(s, 3.0));
						vec3 cloudShade = mix(uMid, uHorizon, 0.5) * 0.9;
						vec3 cc = mix(cloudShade, cloudLit, smoothstep(0.4, 0.9, fbm(uv + 0.3)));
						col = mix(col, cc, c * 0.85);
					}
					col += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 60.0) * 0.5);
					// Blend into the fog colour at and below the horizon so distant terrain melts in.
					col = mix(col, uFog, (1.0 - smoothstep(-0.02, 0.14, h)) * 0.85);
					col = mix(col, col * vec3(0.5, 0.3, 0.6), uGloom);
					gl_FragColor = vec4(col, 1.0);
					#include <tonemapping_fragment>
					#include <colorspace_fragment>
				}
			`
		});
		this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat);
		this.dome.scale.setScalar(1800);
		this.dome.frustumCulled = false;
		this.dome.renderOrder = -10;
		scene.add(this.dome);

		this.hemi = new THREE.HemisphereLight(0xb9ccff, 0x5f6a3a, 1.25);
		scene.add(this.hemi);

		this.sun = new THREE.DirectionalLight(0xffd2a0, 3.0);
		this.sun.position.copy(SUN_DIR).multiplyScalar(200);
		this.sun.castShadow = true;
		const cam = this.sun.shadow.camera;
		cam.near = 1;
		cam.far = 500;
		this.setShadowExtent(70);
		this.sun.shadow.bias = -0.0005;
		this.sun.shadow.normalBias = 0.5;
		scene.add(this.sun);
		scene.add(this.sun.target);

		this.fog = new THREE.Fog(this.fogColor, 90, 520);
		scene.fog = this.fog;
	}

	setShadowExtent(e: number): void {
		this.shadowExtent = e;
		const cam = this.sun.shadow.camera;
		cam.left = -e;
		cam.right = e;
		cam.top = e;
		cam.bottom = -e;
		cam.updateProjectionMatrix();
	}

	setShadowQuality(enabled: boolean, size: number): void {
		this.sun.castShadow = enabled;
		if (this.sun.shadow.mapSize.x !== size) {
			this.sun.shadow.mapSize.set(size, size);
			this.sun.shadow.map?.dispose();
			this.sun.shadow.map = null;
		}
	}

	setDrawDistance(d: number): void {
		this.drawDistance = d;
	}

	/** Blend atmosphere toward the regions around the focus point. */
	applyRegions(w: RegionWeights, dt: number): void {
		_blend.fog.setRGB(0, 0, 0);
		_blend.sky.setRGB(0, 0, 0);
		_blend.ground.setRGB(0, 0, 0);
		_blend.sun.setRGB(0, 0, 0);
		let near = 0;
		let far = 0;
		for (const id of ['hollow', 'vale', 'forest', 'highlands', 'sanctuary'] as const) {
			const k = w[id];
			if (k <= 0) continue;
			const r = REGIONS[id];
			_blend.fog.add(_c.setHex(r.fog).multiplyScalar(k));
			_blend.sky.add(_c.setHex(r.hemiSky).multiplyScalar(k));
			_blend.ground.add(_c.setHex(r.hemiGround).multiplyScalar(k));
			_blend.sun.add(_c.setHex(r.sunTint).multiplyScalar(k));
			near += r.fogNear * k;
			far += r.fogFar * k;
		}
		this.gloomSmooth = damp(this.gloomSmooth, this.gloom, 1.5, dt);
		const g = this.gloomSmooth;
		if (g > 0.001) {
			_blend.fog.lerp(_c.setRGB(0.18, 0.08, 0.24), g * 0.8);
			_blend.sun.lerp(_c.setRGB(0.9, 0.4, 0.7), g * 0.5);
		}
		const k = 1 - Math.exp(-2.5 * dt);
		this.fogColor.lerp(_blend.fog, k);
		this.hemi.color.lerp(_blend.sky, k);
		this.hemi.groundColor.lerp(_blend.ground, k);
		this.sun.color.lerp(_blend.sun, k);
		this.fogNear = damp(this.fogNear, near, 2.5, dt);
		this.fogFar = damp(this.fogFar, far, 2.5, dt);
		const scale = this.drawDistance / 520;
		this.fog.near = this.fogNear * scale;
		this.fog.far = Math.min(this.drawDistance, this.fogFar * scale);
		this.fog.color.copy(this.fogColor);
		(this.uniforms.uHorizon.value as THREE.Color).copy(this.fogColor).lerp(_c.setHex(0xf6b88c), 0.45);
		this.uniforms.uGloom.value = g;
		this.sun.intensity = 3.0 * (1 - g * 0.45);
	}

	/** Keeps the dome and shadow frustum centred on the focus point. */
	update(time: number, focus: THREE.Vector3, camera: THREE.Camera): void {
		this.dome.position.copy(camera.position);
		this.uniforms.uTime.value = time;
		// Snap the shadow camera to texel-sized steps to avoid shimmering while moving.
		const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
		const fx = Math.round(focus.x / texel) * texel;
		const fz = Math.round(focus.z / texel) * texel;
		const fy = Math.round(focus.y / texel) * texel;
		this.sun.target.position.set(fx, fy, fz);
		this.sun.position.set(fx + SUN_DIR.x * 220, fy + SUN_DIR.y * 220, fz + SUN_DIR.z * 220);
	}

	dispose(): void {
		this.dome.geometry.dispose();
		(this.dome.material as THREE.Material).dispose();
		this.sun.shadow.map?.dispose();
		this.scene.fog = null;
	}
}
