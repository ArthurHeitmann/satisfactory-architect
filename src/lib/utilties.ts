import type { IVector2D } from "./datamodel/GraphView.svelte";

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

export function formatPower(mw: number): string {
	if (mw >= 1000) {
		return `${floatToString(mw / 1000, 2)} GW`;
	}
	if (mw >= 1) {
		return `${Math.round(mw)} MW`;
	}
	return `${floatToString(mw, 2)} MW`;
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

export function getThroughputColor(isBalanced: boolean, pushThroughput: number, pullThroughput: number): string {
	if (isBalanced) {
		return "var(--edge-stroke-color)";
	} else {
		const mixPercent = (pushThroughput - pullThroughput) / Math.max(pushThroughput, pullThroughput);
		const minPercent = 0.2;
		const mixPercentAbs = Math.min(1.0, Math.abs(mixPercent) * 2 + minPercent);
		if (mixPercent < 0) {
			return `color-mix(in srgb, var(--underflow-color) ${mixPercentAbs * 100}%, var(--edge-stroke-color))`;
		} else if (mixPercent > 0) {
			return `color-mix(in srgb, var(--overflow-color) ${mixPercentAbs * 100}%, var(--edge-stroke-color))`;
		} else {
			return "var(--edge-stroke-color)";
		}
	}
}

export function targetsInput(event: Event): boolean {
	const target = event.target as Element|null;
	if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA")
		return true;
	const contentEditable = target?.getAttribute("contenteditable");
	if (contentEditable === "true" || contentEditable === "plaintext-only")
		return true;
	return false;
}

export function saveFileToDisk(filename: string, content: string): void {
	const blob = new Blob([content], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

export function loadFileFromDisk(): Promise<string> {
	return new Promise((resolve, reject) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json";
		input.style.display = "none";
		document.body.appendChild(input);
		input.addEventListener("change", async (event) => {
			const file = (event.target as HTMLInputElement).files?.[0];
			if (!file) {
				reject(new Error("No file selected"));
				return;
			}
			const reader = new FileReader();
			reader.onload = () => {
				resolve(reader.result as string);
			};
			reader.onerror = () => {
				reject(new Error("Failed to read file"));
			};
			reader.readAsText(file);
		});
		document.body.appendChild(input);
		input.click();
		document.body.removeChild(input);
	});
}
