import * as THREE from 'three';

export type NumberKind = 'normal' | 'crit' | 'weak' | 'player' | 'heal' | 'mana' | 'reaction' | 'status' | 'block' | 'exp' | 'info';

interface Popup {
	el: HTMLDivElement;
	pos: THREE.Vector3;
	life: number;
	maxLife: number;
	vx: number;
	rise: number;
	scale: number;
	active: boolean;
}

const _v = new THREE.Vector3();

/**
 * Pooled DOM popups for damage numbers and reaction callouts. Positions are written straight
 * to `transform` each frame (never through Svelte), so they cost nothing when idle.
 */
export class DamageNumbers {
	private pool: Popup[] = [];
	private next = 0;
	enabled = true;

	constructor(private layer: HTMLElement) {
		for (let i = 0; i < 56; i++) {
			const el = document.createElement('div');
			el.className = 'af-num';
			el.style.opacity = '0';
			layer.appendChild(el);
			this.pool.push({ el, pos: new THREE.Vector3(), life: 0, maxLife: 1, vx: 0, rise: 1, scale: 1, active: false });
		}
	}

	spawn(pos: THREE.Vector3, text: string, kind: NumberKind = 'normal'): void {
		if (!this.enabled && kind !== 'reaction' && kind !== 'info' && kind !== 'exp') return;
		const p = this.pool[this.next];
		this.next = (this.next + 1) % this.pool.length;
		p.active = true;
		p.pos.copy(pos);
		p.pos.x += (Math.random() - 0.5) * 0.6;
		p.pos.y += Math.random() * 0.4;
		p.maxLife = kind === 'reaction' ? 1.5 : kind === 'crit' || kind === 'weak' ? 1.1 : 0.9;
		p.life = p.maxLife;
		p.vx = (Math.random() - 0.5) * 40;
		p.rise = kind === 'reaction' ? 1.3 : 1.0;
		p.scale = kind === 'crit' || kind === 'weak' ? 1.35 : kind === 'reaction' ? 1.2 : 1;
		p.el.className = `af-num af-num-${kind}`;
		p.el.textContent = text;
	}

	update(dt: number, camera: THREE.Camera, width: number, height: number): void {
		for (const p of this.pool) {
			if (!p.active) continue;
			p.life -= dt;
			if (p.life <= 0) {
				p.active = false;
				p.el.style.opacity = '0';
				continue;
			}
			const t = 1 - p.life / p.maxLife;
			_v.copy(p.pos);
			_v.y += t * 1.4 * p.rise;
			_v.project(camera);
			if (_v.z > 1 || _v.z < -1) {
				p.el.style.opacity = '0';
				continue;
			}
			const x = (_v.x * 0.5 + 0.5) * width + p.vx * t;
			const y = (-_v.y * 0.5 + 0.5) * height;
			const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.6 : 1.2 - Math.min(0.2, (t - 0.12) * 0.6);
			const s = p.scale * pop;
			p.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${s.toFixed(3)})`;
			p.el.style.opacity = String(t > 0.7 ? (1 - t) / 0.3 : 1);
		}
	}

	clear(): void {
		for (const p of this.pool) {
			p.active = false;
			p.el.style.opacity = '0';
		}
	}

	dispose(): void {
		for (const p of this.pool) p.el.remove();
	}
}
