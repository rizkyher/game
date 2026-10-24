import * as THREE from 'three';
import { Random } from '../utils/Random';
import { blob, merge, prep } from '../utils/geometry';

export const SUN_DIR = new THREE.Vector3(0.45, 0.78, 0.35).normalize();

/** Gradient sky dome, sun, hemisphere + directional lighting and drifting cartoon clouds. */
export class Sky {
	readonly sun: THREE.DirectionalLight;
	readonly hemi: THREE.HemisphereLight;
	readonly dome: THREE.Mesh;
	readonly clouds: THREE.InstancedMesh;
	readonly fogColor = new THREE.Color(0xcfe8ff);
	private cloudData: { x: number; y: number; z: number; s: number; speed: number }[] = [];
	private m = new THREE.Matrix4();
	private shadowExtent = 80;

	constructor(private scene: THREE.Scene) {
		const skyMat = new THREE.ShaderMaterial({
			side: THREE.BackSide,
			depthWrite: false,
			fog: false,
			uniforms: {
				uTop: { value: new THREE.Color(0x3d8fe8) },
				uMid: { value: new THREE.Color(0x8cc8ff) },
				uHorizon: { value: new THREE.Color(0xe6f3ff) },
				uSunDir: { value: SUN_DIR },
				uSunColor: { value: new THREE.Color(0xfff2cc) }
			},
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
				uniform vec3 uSunDir;
				uniform vec3 uSunColor;
				varying vec3 vDir;
				void main() {
					vec3 d = normalize(vDir);
					float h = d.y;
					vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.25, h));
					col = mix(col, uTop, smoothstep(0.25, 0.95, h));
					col = mix(col, vec3(0.78, 0.86, 0.8), smoothstep(0.0, -0.3, h));
					float s = max(dot(d, uSunDir), 0.0);
					col += uSunColor * (pow(s, 600.0) * 3.0 + pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12);
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

		this.hemi = new THREE.HemisphereLight(0xcde8ff, 0x6f8f45, 1.35);
		scene.add(this.hemi);

		this.sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
		this.sun.position.copy(SUN_DIR).multiplyScalar(200);
		this.sun.castShadow = true;
		const cam = this.sun.shadow.camera;
		cam.near = 1;
		cam.far = 600;
		this.setShadowExtent(80);
		this.sun.shadow.bias = -0.0004;
		this.sun.shadow.normalBias = 0.6;
		scene.add(this.sun);
		scene.add(this.sun.target);

		scene.fog = new THREE.Fog(this.fogColor, 150, 520);

		// Clouds: lumpy blob clusters merged into one geometry, instanced across the sky.
		const rng = new Random(77);
		const parts: THREE.BufferGeometry[] = [];
		for (let i = 0; i < 6; i++) {
			const g = blob(rng.range(14, 24), 2, 0.12, i);
			g.translate(rng.range(-30, 30), rng.range(-4, 6), rng.range(-12, 12));
			parts.push(prep(g, 0xffffff));
		}
		const cloudGeo = merge(parts);
		cloudGeo.scale(1, 0.6, 1);
		const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xb8c8e0, emissiveIntensity: 0.55, fog: false });
		const count = 22;
		this.clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, count);
		for (let i = 0; i < count; i++) {
			const a = rng.range(0, Math.PI * 2);
			const r = rng.range(250, 900);
			this.cloudData.push({ x: Math.cos(a) * r, y: rng.range(230, 380), z: Math.sin(a) * r, s: rng.range(0.7, 1.6), speed: rng.range(1.5, 4) });
		}
		this.clouds.frustumCulled = false;
		scene.add(this.clouds);
		this.updateClouds(0);
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
		const fog = this.scene.fog as THREE.Fog;
		fog.far = d;
		fog.near = d * 0.3;
	}

	private updateClouds(t: number): void {
		const q = new THREE.Quaternion();
		const s = new THREE.Vector3();
		const p = new THREE.Vector3();
		for (let i = 0; i < this.cloudData.length; i++) {
			const c = this.cloudData[i];
			let x = c.x + t * c.speed;
			x = ((x + 1000) % 2000) - 1000;
			p.set(x, c.y, c.z);
			s.setScalar(c.s);
			this.m.compose(p, q, s);
			this.clouds.setMatrixAt(i, this.m);
		}
		this.clouds.instanceMatrix.needsUpdate = true;
	}

	private cloudTimer = 0;

	/** Keeps the dome and shadow frustum centred on the focus point. */
	update(dt: number, time: number, focus: THREE.Vector3, camera: THREE.Camera): void {
		this.dome.position.copy(camera.position);
		this.cloudTimer += dt;
		if (this.cloudTimer > 0.25) {
			this.cloudTimer = 0;
			this.updateClouds(time);
		}
		// Snap the shadow camera to texel-sized steps to avoid shimmering while moving.
		const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
		const fx = Math.round(focus.x / texel) * texel;
		const fz = Math.round(focus.z / texel) * texel;
		const fy = Math.round(focus.y / texel) * texel;
		this.sun.target.position.set(fx, fy, fz);
		this.sun.position.set(fx + SUN_DIR.x * 250, fy + SUN_DIR.y * 250, fz + SUN_DIR.z * 250);
	}

	dispose(): void {
		this.dome.geometry.dispose();
		(this.dome.material as THREE.Material).dispose();
		this.clouds.geometry.dispose();
		(this.clouds.material as THREE.Material).dispose();
		this.sun.shadow.map?.dispose();
	}
}
