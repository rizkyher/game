import * as THREE from 'three';

export type PopupStyle = 'chaos' | 'combo' | 'collect' | 'speech' | 'trick' | 'bad';

interface Popup {
	el: HTMLDivElement;
	pos: THREE.Vector3;
	life: number;
	max: number;
	rise: number;
	active: boolean;
}

const POOL = 28;

/**
 * Floating world-space text (score popups, NPC speech) rendered as pooled DOM nodes.
 * Positions are projected each frame; no Svelte reactivity involved.
 */
export class ScorePopups {
	private pool: Popup[] = [];
	private head = 0;
	private v = new THREE.Vector3();

	constructor(private container: HTMLElement) {
		for (let i = 0; i < POOL; i++) {
			const el = document.createElement('div');
			el.className = 'bm-popup';
			el.style.display = 'none';
			container.appendChild(el);
			this.pool.push({ el, pos: new THREE.Vector3(), life: 0, max: 1, rise: 0, active: false });
		}
	}

	show(text: string, pos: THREE.Vector3, style: PopupStyle = 'chaos', duration = 1.4): void {
		const p = this.pool[this.head];
		this.head = (this.head + 1) % POOL;
		p.el.textContent = text;
		p.el.className = `bm-popup bm-popup-${style}`;
		p.pos.copy(pos);
		p.pos.x += (Math.random() - 0.5) * 0.8;
		p.life = duration;
		p.max = duration;
		p.rise = style === 'speech' ? 0.6 : 2.2;
		p.active = true;
		p.el.style.display = 'block';
	}

	update(dt: number, camera: THREE.PerspectiveCamera, width: number, height: number): void {
		for (const p of this.pool) {
			if (!p.active) continue;
			p.life -= dt;
			if (p.life <= 0) {
				p.active = false;
				p.el.style.display = 'none';
				continue;
			}
			p.pos.y += p.rise * dt;
			this.v.copy(p.pos).project(camera);
			if (this.v.z > 1 || this.v.z < -1) {
				p.el.style.opacity = '0';
				continue;
			}
			const x = (this.v.x * 0.5 + 0.5) * width;
			const y = (-this.v.y * 0.5 + 0.5) * height;
			const t = 1 - p.life / p.max;
			const scale = t < 0.12 ? 0.6 + (t / 0.12) * 0.55 : 1.15 - Math.min(0.15, (t - 0.12) * 0.5);
			p.el.style.opacity = String(t > 0.7 ? (1 - t) / 0.3 : 1);
			p.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
		}
	}

	clear(): void {
		for (const p of this.pool) {
			p.active = false;
			p.el.style.display = 'none';
		}
	}

	dispose(): void {
		for (const p of this.pool) p.el.remove();
		this.pool = [];
		void this.container;
	}
}
