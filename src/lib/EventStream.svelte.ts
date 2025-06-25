
export type EventType = "" | "showContextMenu" | "showRecipeSelector";

export interface EventBase {
	type: EventType;
}

export class EventStream {
	private readonly listeners: ((event: EventBase) => void)[] = [];

	addListener(listener: (event: EventBase) => void): void {
		this.listeners.push(listener);
	}

	removeListener(listener: (event: EventBase) => void): void {
		const index = this.listeners.indexOf(listener);
		if (index !== -1) {
			this.listeners.splice(index, 1);
		}
	}

	emit(event: EventBase): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}

export interface ShowContextMenuEvent extends EventBase {
	type: "showContextMenu";
	x: number;
	y: number;
	onClick?: (item: string) => void;
	items: ContextMenuItem[];
}

interface ContextMenuItem1 {
	label: string;
	hint?: string;
	value: string;
	disabled?: boolean;
	icon?: string;
}
interface ContextMenuItem2 {
	label: string;
	hint?: string;
	disabled?: boolean;
	icon?: string;
	onClick: () => void;
}
export type ContextMenuItem = ContextMenuItem1 | ContextMenuItem2;

export interface ShowRecipeSelectorEvent extends EventBase {
	type: "showRecipeSelector";
	onSelect: (recipe: string) => void;
	onCancel?: () => void;
	x: number;
	y: number;
	requiredInputsClassName?: string;
	requiredOutputsClassName?: string;
	autofocus?: boolean;
}
