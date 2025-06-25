
export function debounce<T extends (...args: any[]) => void>(func: T, delay: number): (...args: Parameters<T>) => void {
	let timeoutId: NodeJS.Timeout | null = null;
	return (...args: Parameters<T>) => {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		timeoutId = setTimeout(() => {
			func(...args);
		}, delay);
	};
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
