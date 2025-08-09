import type { SvgPresetName } from "./components/icons/svgPresets";
import type { NewNodeDetails } from "./datamodel/GraphNode.svelte";
import type { GraphPage } from "./datamodel/GraphPage.svelte";

export type EventType = "" | "showContextMenu" | "showProductionSelector";

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

	emit(event: AllowedEventTypes): void {
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
export type ContextMenuItemAction  = {value: string} | {onClick: () => void};
export interface ContextMenuTextItemBase {
	label: string;
	hint?: string;
	disabled?: boolean;
	icon?: SvgPresetName;
}
export interface ContextMenuIconButtonBase<T> {
	icon: SvgPresetName;
	disabled?: boolean;
	value: T;
}
export type ContextMenuTextItem = ContextMenuTextItemBase & ContextMenuItemAction;
export type ContextMenuIconButton<T> = ContextMenuIconButtonBase<T> & ContextMenuItemAction;
export interface ContextMenuItemButtonRow<T = any> {
	items: ContextMenuIconButton<T>[];
	currentValue: T;
	onClick: (item: T) => void;
}
export type ContextMenuItem = ContextMenuTextItem | ContextMenuItemButtonRow;

export interface ShowProductionSelectorEvent extends EventBase {
	type: "showProductionSelector";
	page: GraphPage;
	onSelect: (result: NewNodeDetails) => void;
	onCancel?: () => void;
	x: number;
	y: number;
	requiredInputsClassName?: string;
	requiredOutputsClassName?: string;
	autofocus?: boolean;
}

export interface EmptyEvent extends EventBase {
	type: "";
}

export type AllowedEventTypes = EmptyEvent | ShowContextMenuEvent | ShowProductionSelectorEvent;
