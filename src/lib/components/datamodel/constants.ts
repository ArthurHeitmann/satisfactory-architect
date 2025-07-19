export const gridSize = 50;

export const resourceJointNodeRadius = 16;
export const splitterMergerNodeRadius = 16;

export const productionNodeIconSize = 55;
export const productionNodeVerticalPadding = 0;
export const productionNodeHorizontalPadding = resourceJointNodeRadius + 2;

export const edgeArrowLength = 11;

export class NodePriorities {
	static readonly RECIPE = 0;
	static readonly RESOURCE_JOINT = 1;
	static readonly OTHER = 0;
}

export class StorageKeys {
	static readonly darkTheme = "dark-theme";
	static readonly appState = "app-state";
}
