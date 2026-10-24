import * as THREE from 'three';
import type { Terrain } from './TerrainGenerator';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { windUniforms } from './Materials';
import { Random } from '../utils/Random';
import { merge, place, prep } from '../utils/geometry';

function waterMaterial(color: number, flowing: boolean): THREE.MeshPhongMaterial {
	const mat = new THREE.MeshPhongMaterial({
		color,
		specular: 0xddeeff,
		shininess: 80,
		transparent: true,
		opacity: 0.82,
		depthWrite: false
	});
	mat.onBeforeCompile = (shader) => {
		shader.uniforms.uTime = windUniforms.uTime;
		shader.vertexShader =
			'uniform float uTime;\nattribute vec2 aFlow;\nvarying vec2 vFlow;\nvarying vec3 vWPos;\n' +
			shader.vertexShader.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				vFlow = aFlow;
				vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
				vWPos = wp0.xyz;
				transformed.y += sin(wp0.x * 0.35 + uTime * 1.6) * 0.06 + cos(wp0.z * 0.29 + uTime * 1.3) * 0.06;`
			);
		shader.fragmentShader =
			'uniform float uTime;\nvarying vec2 vFlow;\nvarying vec3 vWPos;\n' +
			shader.fragmentShader.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
				${
					flowing
						? `float streak = sin(vFlow.y * 0.55 - uTime * 5.0 + sin(vFlow.x * 9.0 + vFlow.y * 0.1) * 1.6) * 0.5 + 0.5;
				float edge = 1.0 - abs(vFlow.x * 2.0 - 1.0);
				float foam = smoothstep(0.86, 1.0, streak) * 0.45 + (1.0 - smoothstep(0.0, 0.25, edge)) * 0.35;`
						: `float ring = sin(vWPos.x * 0.21 + vWPos.z * 0.17 + uTime * 0.8) * 0.5 + 0.5;
				float foam = smoothstep(0.93, 1.0, ring) * 0.18;`
				}
				diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.97, 1.0), foam);`
			);
	};
	mat.customProgramCacheKey = () => (flowing ? 'water-flow' : 'water-still');
	return mat;
}

/** Pond, stream ribbon, waterfall and lily pads. */
export class Water {
	readonly group = new THREE.Group();
	/** Bottom of the waterfall (for mist particles + updraft). */
	readonly fallBase = new THREE.Vector3();
	readonly fallTop = new THREE.Vector3();
	readonly lilyPads: { x: number; y: number; z: number; r: number }[] = [];

	constructor(terrain: Terrain, physics: PhysicsWorld) {
		// Pond surface.
		const pond = terrain.pond;
		const pondGeo = new THREE.CircleGeometry(51, 64);
		pondGeo.rotateX(-Math.PI / 2);
		pondGeo.setAttribute('aFlow', new THREE.Float32BufferAttribute(new Float32Array(pondGeo.attributes.position.count * 2), 2));
		const pondMesh = new THREE.Mesh(pondGeo, waterMaterial(0x3aa6d0, false));
		pondMesh.position.set(pond.x, terrain.pondLevel, pond.z);
		pondMesh.renderOrder = 2;
		pondMesh.receiveShadow = true;
		this.group.add(pondMesh);

		// Stream ribbon following the precomputed water profile.
		const samples = terrain.stream;
		const half = 7.5;
		const pos: number[] = [];
		const flow: number[] = [];
		const idx: number[] = [];
		let s = 0;
		for (let i = 0; i < samples.length; i++) {
			const p = samples[i];
			if (i > 0) s += Math.hypot(p.x - samples[i - 1].x, p.z - samples[i - 1].z);
			const nx = -p.dz;
			const nz = p.dx;
			pos.push(p.x + nx * half, p.y, p.z + nz * half, p.x - nx * half, p.y, p.z - nz * half);
			flow.push(0, s, 1, s);
			if (i > 0) {
				const a = (i - 1) * 2;
				// Counter-clockwise seen from above so the ribbon faces up.
				idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
			}
		}
		// Waterfall: walk back from the steepest step to where the drop starts, and forward to
		// where it flattens out again.
		let steep = 1;
		for (let i = 1; i < samples.length; i++) {
			if (samples[i - 1].y - samples[i].y > samples[steep - 1].y - samples[steep].y) steep = i;
		}
		let top = steep - 1;
		while (top > 0 && samples[top - 1].y - samples[top].y > 0.25) top--;
		let bottom = steep;
		while (bottom < samples.length - 1 && samples[bottom].y - samples[bottom + 1].y > 0.25) bottom++;
		this.fallTop.set(samples[top].x, samples[top].y, samples[top].z);
		this.fallBase.set(samples[bottom].x, samples[bottom].y, samples[bottom].z);
		const streamGeo = new THREE.BufferGeometry();
		streamGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		streamGeo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
		streamGeo.setIndex(idx);
		streamGeo.computeVertexNormals();
		const streamMesh = new THREE.Mesh(streamGeo, waterMaterial(0x46b3dc, true));
		streamMesh.renderOrder = 2;
		this.group.add(streamMesh);

		// Lily pads (static, landable) and lotus flowers.
		const rng = new Random(909);
		const padParts: THREE.BufferGeometry[] = [];
		const lotusParts: THREE.BufferGeometry[] = [];
		for (let i = 0; i < 22; i++) {
			const a = rng.range(0, Math.PI * 2);
			const d = rng.range(8, 42);
			const x = pond.x + Math.cos(a) * d;
			const z = pond.z + Math.sin(a) * d;
			const r = rng.range(2.4, 4.6);
			const y = terrain.pondLevel + 0.12;
			const notch = rng.range(0, Math.PI * 2);
			const pad = new THREE.CylinderGeometry(r, r, 0.25, 22, 1, false, notch, Math.PI * 1.82);
			padParts.push(prep(place(pad, x, y, z), i % 3 === 0 ? 0x4f9e3a : 0x5fb045));
			this.lilyPads.push({ x, y, z, r });
			physics.addCylinder(x, y, z, 0.15, r * 0.95, { kind: 'static', material: 'plant' });
			if (rng.chance(0.35)) {
				for (let k = 0; k < 8; k++) {
					const petal = new THREE.SphereGeometry(0.9, 8, 6);
					petal.scale(0.45, 0.35, 1);
					petal.translate(0, 0.25, 0.75);
					petal.rotateX(-0.5);
					petal.rotateY((k / 8) * Math.PI * 2);
					lotusParts.push(prep(place(petal, x, y + 0.2, z), k % 2 ? 0xffb3d1 : 0xffd1e4));
				}
				lotusParts.push(prep(place(new THREE.SphereGeometry(0.45, 8, 6), x, y + 0.55, z), 0xffe066));
			}
		}
		const padMat = new THREE.MeshLambertMaterial({ vertexColors: true });
		const pads = new THREE.Mesh(merge(padParts), padMat);
		pads.receiveShadow = true;
		this.group.add(pads);
		if (lotusParts.length) this.group.add(new THREE.Mesh(merge(lotusParts), padMat));

		// Cattails and reeds around the shore.
		const reedParts: THREE.BufferGeometry[] = [];
		for (let i = 0; i < 70; i++) {
			const a = rng.range(0, Math.PI * 2);
			const d = rng.range(44, 54);
			const x = pond.x + Math.cos(a) * d;
			const z = pond.z + Math.sin(a) * d;
			const y = terrain.heightAt(x, z) - 0.3;
			const h = rng.range(7, 13);
			reedParts.push(prep(place(new THREE.CylinderGeometry(0.12, 0.18, h, 5), x, y + h / 2, z), 0x5a8f3a));
			if (rng.chance(0.6)) {
				reedParts.push(prep(place(new THREE.CapsuleGeometry(0.42, 1.8, 3, 6), x, y + h - 0.6, z), 0x7a4a2a));
			}
			const leaf = new THREE.ConeGeometry(0.35, h * 0.8, 3);
			reedParts.push(prep(place(leaf, x + 0.4, y + h * 0.4, z, 0.12, rng.range(0, 6), 0.1), 0x6aa848));
		}
		const reeds = new THREE.Mesh(merge(reedParts), padMat);
		reeds.castShadow = true;
		this.group.add(reeds);
	}

	dispose(): void {
		this.group.traverse((o) => {
			if (o instanceof THREE.Mesh) {
				o.geometry.dispose();
				(o.material as THREE.Material).dispose();
			}
		});
	}
}
