type Handler<T> = (payload: T) => void;

/**
 * Minimal typed pub/sub. Systems announce gameplay facts (hits, kills, pickups) and others
 * react without holding references to each other.
 */
export class EventBus<Events extends object> {
	private handlers = new Map<keyof Events, Handler<never>[]>();

	on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
		let list = this.handlers.get(type);
		if (!list) {
			list = [];
			this.handlers.set(type, list);
		}
		list.push(fn as Handler<never>);
		return () => {
			const l = this.handlers.get(type);
			if (!l) return;
			const i = l.indexOf(fn as Handler<never>);
			if (i >= 0) l.splice(i, 1);
		};
	}

	emit<K extends keyof Events>(type: K, payload: Events[K]): void {
		const list = this.handlers.get(type);
		if (!list) return;
		for (let i = 0; i < list.length; i++) (list[i] as Handler<Events[K]>)(payload);
	}

	clear(): void {
		this.handlers.clear();
	}
}
