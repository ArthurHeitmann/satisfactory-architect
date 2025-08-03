import type { IVector2D } from "./components/datamodel/GraphView.svelte";

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
			this.timeoutId = null;
		}, this.delay);
	}

	cancel() {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
	}

	hasPendingCall(): boolean {
		return this.timeoutId !== null;
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

export function randomId(): string {
	return Math.random().toString(36).substring(2, 10);
}

export function copyText(text: string) {
	if (navigator.clipboard && window.isSecureContext) {
		return navigator.clipboard.writeText(text);
	} else {
		const textArea = document.createElement("textarea");
		textArea.value = text;
		textArea.style.position = "fixed";
		textArea.style.opacity = "0";
		document.body.appendChild(textArea);
		textArea.focus();
		textArea.select();
		try {
			document.execCommand("copy");
		} catch (err) {
			console.error("Failed to copy text: ", err);
		}
		document.body.removeChild(textArea);
	}
}

export async function getClipboardText(): Promise<string | null> {
	if (navigator.clipboard && window.isSecureContext) {
		try {
			return await navigator.clipboard.readText();
		} catch (err) {
			console.error("Failed to read clipboard text: ", err);
			return null;
		}
	} else {
		console.error("Clipboard API not available in this context.");
		return null;
	}
}

export function bezierPoint(startP: IVector2D, endP: IVector2D, ctrl1: IVector2D, ctrl2: IVector2D, t: number): IVector2D {
	const u = 1 - t;
	return {
		x: u * u * u * startP.x + 3 * u * u * t * ctrl1.x + 3 * u * t * t * ctrl2.x + t * t * t * endP.x,
		y: u * u * u * startP.y + 3 * u * u * t * ctrl1.y + 3 * u * t * t * ctrl2.y + t * t * t * endP.y,
	};
}

export function parseFloatExpr(s: string): number {
	if (!/^[\d\-+*/().\s]+$/.test(s)) {
		throw NaN;
	}
	const result = Function(`"use strict"; return (${s})`)();
	if (typeof result !== "number" || isNaN(result) || !isFinite(result)) {
		throw NaN;
	}
	return result;
}

export function isThroughputBalanced(pushed: number, pulled: number): boolean {
	if (!pushed && !pulled) {
		return true;
	}
	const diff = Math.abs(pushed - pulled);
	if (diff < 5) {
		if (diff / Math.max(pushed, pulled) < 0.015) {
			return true;
		}
	}
	return false;
}
