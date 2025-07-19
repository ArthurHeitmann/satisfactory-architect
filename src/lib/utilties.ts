
export class Debouncer<T extends (...args: any[]) => void> {
	private timeoutId: NodeJS.Timeout | null = null;
	private func: T;
	private delay: number;

	constructor(func: T, delay: number) {
		this.func = func;
		this.delay = delay;
	}

	call(...args: Parameters<T>) {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
		}
		this.timeoutId = setTimeout(() => {
			this.func(...args);
		}, this.delay);
	}

	cancel() {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
	}
}

export class Throttler<T extends (...args: any[]) => void> {
	private lastCallTime: number = 0;
	private func: T;
	private delay: number;

	constructor(func: T, delay: number) {
		this.func = func;
		this.delay = delay;
	}

	call(...args: Parameters<T>) {
		const now = Date.now();
		if (now - this.lastCallTime >= this.delay) {
			this.lastCallTime = now;
			this.func(...args);
		}
	}

	callNow(...args: Parameters<T>) {
		this.lastCallTime = Date.now();
		this.func(...args);
	}

	reset() {
		this.lastCallTime = 0;
	}
}

export function roundToNearest(value: number, nearest: number): number {
	if (nearest === 0) {
		return value;
	}
	if (nearest < 0) {
		throw new Error("Nearest must be >= 0");
	}
	return Math.round(value / nearest) * nearest;
}

export function floorToNearest(value: number, nearest: number): number {
	if (nearest === 0) {
		return value;
	}
	if (nearest < 0) {
		throw new Error("Nearest must be >= 0");
	}
	return Math.floor(value / nearest) * nearest;
}

export function ceilToNearest(value: number, nearest: number): number {
	if (nearest === 0) {
		return value;
	}
	if (nearest < 0) {
		throw new Error("Nearest must be >= 0");
	}
	return Math.ceil(value / nearest) * nearest;
}

export function pluralStr(base: string, count: number): string {
	if (count === 1) {
		return `${count} ${base}`;
	} else {
		return `${count} ${base}s`;
	}
}

export function floatToString(value: number, precision: number = 2): string {
	return value.toFixed(precision).replace(/\.?0+$/, "");
}

export function angleBetweenPoints(
	centerPoint: { x: number; y: number },
	outerPoint: { x: number; y: number }
): number {
	const dx = outerPoint.x - centerPoint.x;
	const dy = outerPoint.y - centerPoint.y;
	const angle = Math.atan2(dy, dx);
	return angle < 0 ? angle + 2 * Math.PI : angle;
}

export function assertUnreachable(x: never): never {
	throw new Error("Didn't expect to get here");
}
