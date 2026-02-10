export const latestAppVersion = 1;
export const dataModelVersion = 1;

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
	static readonly TOP_LEVEL = 999;
}

export class StorageKeys {
	static readonly darkTheme = "dark-theme";
	static readonly appState = "app-state";
	static readonly appVersion = "app-version";
}

export const saveDataType = "app-state";
export const clipboardDataType = "factory-data";


export type ChangelogEntry = string | {
	text: string;
	items?: ChangelogEntry[];
};

export const changelog: Record<number, ChangelogEntry[]> = {
	2: [
		{
			text: "Multi User Collaboration",
			items: [
				"Work together with your friends on one save file in real-time",
				"To get started, click the new \"Multi-User Collaboration\" button in the top left dropdown menu",
				"If you encounter any issues, please report them",
				"If you want to host your own server, visit the GitHub repository for more information",
			],
		},
		{
			text: "Pages",
			items: [
				"Pages can now be reordered",
				"You can also change their icon",
			]
		},
		{
			text: "More view moving options",
			items: [
				"CTRL + left-click",
				"\"Drag View\" tool in left sidebar"
			]
		},
	],
	1: ["Initial release"],
};
