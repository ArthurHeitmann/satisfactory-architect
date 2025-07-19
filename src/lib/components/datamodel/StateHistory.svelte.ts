import { EventStream } from "$lib/EventStream.svelte";
import { Debouncer } from "$lib/utilties";
import { untrack } from "svelte";
import type { SvelteMap, SvelteSet } from "svelte/reactivity";

export type JsonPrimitive = string | number | boolean;
export type JsonElement = JsonPrimitive | JsonElement[] | { [key: string]: JsonElement };

export interface JsonSerializable<Context> {
	applyJson(json: any, context: Context): void;
	toJSON(): any;
}

export class StateHistory<Context> {
	private history: any[] = [];
	private index: number = -1;
	private pushDebounced: Debouncer<any>;
	private lastRestoreAt: number = 0;
	private serializer: JsonSerializable<Context>;
	private context: Context;
	private static readonly PUSH_DEBOUNCE_MS = 500;
	private static readonly AFTER_RESTORE_DEBOUNCE_MS = 100;
	enabled: boolean = true;
	canUndo: boolean = $state(false);
	canRedo: boolean = $state(false);
	readonly onHistoryChange = new EventStream();

	constructor(serializer: JsonSerializable<Context>, context: Context) {
		this.serializer = serializer;
		this.context = context;
		this.pushDebounced = new Debouncer(this.pushState.bind(this), StateHistory.PUSH_DEBOUNCE_MS);
		$effect(() => {
			const state = this.serializer.toJSON();
			if (Date.now() - this.lastRestoreAt < StateHistory.AFTER_RESTORE_DEBOUNCE_MS) {
				return;
			}
			untrack(() => this.onData(state));
		});
	}

	private onData(state: any): void {
		if (this.enabled) {
			this.pushDebounced.call(state);
		}
	}

	undo(): void {
		if (this.index > 0) {
			this.index -= 1;
			this.restoreState();
		}
	}

	redo(): void {
		if (this.index < this.history.length - 1) {
			this.index += 1;
			this.restoreState();
		}
	}

	private restoreState(): void {
		this.pushDebounced.cancel();
		const state = this.history[this.index];
		this.serializer.applyJson(state, this.context);
		this.lastRestoreAt = Date.now();
		this.updateUndoRedoStates();
	}

	private updateUndoRedoStates() {
		this.canUndo = this.index > 0;
		this.canRedo = this.index < this.history.length - 1;
		this.onHistoryChange.emit({type: ""});
	}

	private pushState(state: any): void {
		if (this.index < this.history.length - 1) {
			this.history = this.history.slice(0, this.index + 1);
		}
		this.history.push(state);
		this.index = this.history.length - 1;
		this.updateUndoRedoStates();
	}
}


export function applyJsonToMap(
	json: Record<string, JsonElement>,
	map: SvelteMap<string, JsonElement>,
): void;
export function applyJsonToMap<C>(
	json: Record<string, JsonElement>,
	map: SvelteMap<string, JsonSerializable<C>>,
	makeFromJson: (json: JsonElement, context: C) => JsonSerializable<C>,
	context: C,
): void;
export function applyJsonToMap<C>(
	json: Record<string, JsonElement>,
	map: SvelteMap<string, JsonElement|JsonSerializable<C>>,
	makeFromJson?: (json: JsonElement, context: C) => JsonSerializable<C>,
	context?: C,
): void {
	const keysToRemove = map.keys().filter((key) => !(key in json));
	for (const key of keysToRemove) {
		map.delete(key);
	}
	for (const [key, value] of Object.entries(json)) {
		const existingValue = map.get(key);
		if (existingValue) {
			if (makeFromJson) {
				(existingValue as JsonSerializable<C>).applyJson(value, context!);
			}
			else {
				map.set(key, value);
			}
		} else {
			if (makeFromJson) {
				map.set(key, makeFromJson(value, context!));
			} else {
				map.set(key, value);
			}
		}
	}
}

export function applyJsonToSet(json: string[], set: SvelteSet<string>): void {
	set.clear();
	for (const value of json) {
		set.add(value);
	}
}

export function applyJsonToObject(json: Record<string, JsonElement>, obj: Record<string, JsonElement>): void {
	for (const [key, value] of Object.entries(json)) {
		obj[key] = value;
	}
}
