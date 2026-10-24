import * as THREE from 'three';
import type { Terrain } from './Terrain';
import { FALLS, LAKE, MILLPOND } from './WorldLayout';
import { worldUniforms } from './Materials';

const WATER_VERT = /* glsl */ `
	attribute vec3 aFlow;
	varying vec3 vWorld;
	varying vec3 vFlow;
	#include <fog_pars_vertex>
	void main() {
		vFlow = aFlow;
		vec4 wp = modelMatrix * vec4(position, 1.0);
		vWorld = wp.xyz;
		vec4 mvPosition = viewMatrix * wp;
		gl_Position = projectionMatrix * mvPosition;
		#include <fog_vertex>
	}
`;

const WATER_FRAG = /* glsl */ `
	uniform float uTime;
	uniform vec3 uDeep;
	uniform vec3 uShallow;
	uniform vec3 uSky;
	uniform vec3 uSunDir;
	varying vec3 vWorld;
	varying vec3 vFlow;
	#include <fog_pars_fragment>
	float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
	float noise(vec2 p) {
		vec2 i = floor(p); vec2 f = fract(p);
		vec2 u = f * f * (3.0 - 2.0 * f);
		return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
	}
	void main() {
		vec2 flow = vFlow.xy * vFlow.z;
		vec2 p = vWorld.xz * 0.35 - flow * uTime * 1.2;
		float n1 = noise(p + uTime * 0.15);
		float n2 = noise(p * 2.3 - uTime * 0.2);
		float h = n1 * 0.6 + n2 * 0.4;
		vec3 nrm = normalize(vec3((n1 - 0.5) * 0.6, 1.0, (n2 - 0.5) * 0.6));
		vec3 viewDir = normalize(cameraPosition - vWorld);
		float fres = pow(1.0 - max(dot(viewDir, nrm), 0.0), 3.0);
		vec3 col = mix(uDeep, uShallow, h * 0.6);
		col = mix(col, uSky, clamp(fres * 0.9 + 0.12, 0.0, 1.0));
		vec3 refl = reflect(-uSunDir, nrm);
		float spec = pow(max(dot(refl, viewDir), 0.0), 120.0);
		col += vec3(1.0, 0.85, 0.6) * spec * 2.5;
		// Foam streaks on fast water.
		float foam = smoothstep(0.72, 0.95, noise(p * 3.0 + vec2(0.0, uTime))) * vFlow.z * 0.6;
		col += vec3(foam);
		gl_FragColor = vec4(col, 0.86);
		#include <tonemapping_fragment>
		#include <colorspace_fragment>
		#include <fog_fragment>
	}
`;

const FALL_FRAG = /* glsl */ `
	uniform float uTime;
	varying vec2 vUv;
	#include <fog_pars_fragment>
	float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
	float noise(vec2 p) {
		vec2 i = floor(p); vec2 f = fract(p);
		vec2 u = f * f * (3.0 - 2.0 * f);
		return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
	}
	void main() {
		float streak = noise(vec2(vUv.x * 26.0, vUv.y * 3.0 + uTime * 2.6));
		float streak2 = noise(vec2(vUv.x * 60.0, vUv.y * 6.0 + uTime * 4.0));
		float s = streak * 0.6 + streak2 * 0.4;
		vec3 col = mix(vec3(0.35, 0.65, 0.75), vec3(0.95, 1.0, 1.0), smoothstep(0.35, 0.8, s));
		float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
		float a = (0.55 + s * 0.4) * edge;
		gl_FragColor = vec4(col * 1.15, a);
		#include <tonemapping_fragment>
		#include <colorspace_fragment>
		#include <fog_fragment>
	}
`;

/** Lake, millpond, both rivers and the Moonwell waterfall. */
export class Water {
	readonly group = new THREE.Group();
	readonly material: THREE.ShaderMaterial;
	private fallMat: THREE.ShaderMaterial;
	private geos: THREE.BufferGeometry[] = [];
	/** Waterfall base, for mist particles and ambience. */
	readonly fallBase = new THREE.Vector3();
	readonly fallTop = new THREE.Vector3();

	constructor(terrain: Terrain, sunDir: THREE.Vector3, skyColor: THREE.Color) {
		this.material = new THREE.ShaderMaterial({
			transparent: true,
			depthWrite: false,
			fog: true,
			uniforms: THREE.UniformsUtils.merge([
				THREE.UniformsLib.fog,
				{
					uTime: worldUniforms.uTime,
					uDeep: { value: new THREE.Color(0x0b3a4a) },
					uShallow: { value: new THREE.Color(0x2a8a8a) },
					uSky: { value: skyColor },
					uSunDir: { value: sunDir }
				}
			]),
			vertexShader: WATER_VERT,
			fragmentShader: WATER_FRAG
		});
		// UniformsUtils.merge clones; re-link the shared references.
		this.material.uniforms.uTime = worldUniforms.uTime;
		this.material.uniforms.uSky = { value: skyColor };

		this.addDisc(LAKE.x, LAKE.z, LAKE.r * 1.3, terrain.lakeLevel, 1 / 0.95);
		this.addDisc(FALLS.x, FALLS.z + 8, 13, terrain.lakeLevel, 1);
		this.addDisc(MILLPOND.x, MILLPOND.z, MILLPOND.r * 1.3, terrain.millLevel, 1);
		this.addRiver(terrain.streamSamples(terrain.upper), terrain.upper.halfWidth * 1.35, 0.9);
		this.addRiver(terrain.streamSamples(terrain.lower), terrain.lower.halfWidth * 1.35, 0.7);

		// Waterfall from the lip of the upper river down into the plunge pool.
		const up = terrain.streamSamples(terrain.upper);
		const lip = up[up.length - 1];
		this.fallTop.set(lip.x, lip.y, lip.z);
		this.fallBase.set(lip.x, terrain.lakeLevel, lip.z + 4);
		const width = terrain.upper.halfWidth * 2.2;
		const height = lip.y - terrain.lakeLevel + 0.6;
		const fall = new THREE.PlaneGeometry(width, height, 6, 8);
		const pos = fall.attributes.position;
		for (let i = 0; i < pos.count; i++) {
			const y = pos.getY(i) / height + 0.5; // 0 bottom .. 1 top
			// Bulge outward as the water falls.
			pos.setZ(i, (1 - y) * (1 - y) * 3.5 + Math.sin(pos.getX(i) * 0.8) * 0.2);
		}
		fall.computeVertexNormals();
		this.geos.push(fall);
		this.fallMat = new THREE.ShaderMaterial({
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			fog: true,
			uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
			vertexShader: /* glsl */ `
				varying vec2 vUv;
				#include <fog_pars_vertex>
				void main() {
					vUv = uv;
					vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
					gl_Position = projectionMatrix * mvPosition;
					#include <fog_vertex>
				}
			`,
			fragmentShader: FALL_FRAG
		});
		this.fallMat.uniforms.uTime = worldUniforms.uTime;
		const fallMesh = new THREE.Mesh(fall, this.fallMat);
		fallMesh.position.set(lip.x, terrain.lakeLevel + height / 2 - 0.3, lip.z + 0.6);
		fallMesh.rotation.y = Math.atan2(lip.dx, lip.dz);
		fallMesh.renderOrder = 2;
		this.group.add(fallMesh);
		this.group.name = 'water';
	}

	private flowAttr(geo: THREE.BufferGeometry, fx: number, fz: number, speed: number): void {
		const n = geo.attributes.position.count;
		const arr = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) {
			arr[i * 3] = fx;
			arr[i * 3 + 1] = fz;
			arr[i * 3 + 2] = speed;
		}
		geo.setAttribute('aFlow', new THREE.BufferAttribute(arr, 3));
	}

	private addDisc(x: number, z: number, r: number, level: number, stretchX: number): void {
		const g = new THREE.CircleGeometry(r, 48);
		g.rotateX(-Math.PI / 2);
		g.scale(stretchX, 1, 1);
		g.translate(x, level, z);
		this.flowAttr(g, 0, 0, 0);
		this.geos.push(g);
		const m = new THREE.Mesh(g, this.material);
		m.renderOrder = 1;
		this.group.add(m);
	}

	private addRiver(samples: { x: number; z: number; y: number; dx: number; dz: number }[], halfWidth: number, speed: number): void {
		const pos: number[] = [];
		const flow: number[] = [];
		const idx: number[] = [];
		for (let i = 0; i < samples.length; i++) {
			const s = samples[i];
			const nx = -s.dz;
			const nz = s.dx;
			pos.push(s.x + nx * halfWidth, s.y, s.z + nz * halfWidth, s.x - nx * halfWidth, s.y, s.z - nz * halfWidth);
			flow.push(s.dx, s.dz, speed, s.dx, s.dz, speed);
			if (i > 0) {
				const b = (i - 1) * 2;
				idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
			}
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 3));
		g.setIndex(idx);
		g.computeBoundingSphere();
		this.geos.push(g);
		const m = new THREE.Mesh(g, this.material);
		m.renderOrder = 1;
		this.group.add(m);
	}

	dispose(): void {
		for (const g of this.geos) g.dispose();
		this.material.dispose();
		this.fallMat.dispose();
	}
}
