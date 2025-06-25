import { untrack } from "svelte";
import { debounce } from "../../utilties";

export type JsonPrimitive = string | number | boolean;
export type JsonElement = JsonPrimitive | JsonElement[] | { [key: string]: JsonElement };

export interface JsonSerializable {
	applyJson(json: any): void;
	toJSON(): any;
}

export class StateHistory {
	private history: any[] = [];
	private index: number = -1;
	private push: (state: any) => void;
	private lastRestoreAt: number = 0;
	private serializer: JsonSerializable;
	private static readonly PUSH_DEBOUNCE_MS = 500;
	private static readonly AFTER_RESTORE_DEBOUNCE_MS = 100;
	canUndo: boolean = $state(false);
	canRedo: boolean = $state(false);

	constructor(serializer: JsonSerializable) {
		this.serializer = serializer;
		this.push = debounce(this.pushState.bind(this), StateHistory.PUSH_DEBOUNCE_MS);
		$effect(() => {
			const state = this.serializer.toJSON();
			if (Date.now() - this.lastRestoreAt < StateHistory.AFTER_RESTORE_DEBOUNCE_MS) {
				return;
			}
			untrack(() => this.onData(state));
		});
	}

	private onData(state: any): void {
		this.push(state);
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
		const state = this.history[this.index];
		this.serializer.applyJson(state);
		this.lastRestoreAt = Date.now();
		this.updateUndoRedoStates();
	}

	private updateUndoRedoStates() {
		this.canUndo = this.index > 0;
		this.canRedo = this.index < this.history.length - 1;
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
