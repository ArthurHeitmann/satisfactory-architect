<script lang="ts">
    import type { GraphNodeProductionProperties, LayoutOrientation, ProductionExtractionDetails } from "$lib/datamodel/GraphNode.svelte";
    import type { GraphPage } from "$lib/datamodel/GraphPage.svelte";
    import type { Id } from "$lib/datamodel/IdGen";
    import { floatToString, formatPower, loadFileFromDisk, openLinkInNewTab, saveFileToDisk, showConfirmationPrompt } from "$lib/utilties";
    import { getContext, untrack } from "svelte";
    import PresetSvg from "../icons/PresetSvg.svelte";
    import type { SvgPresetName } from "../icons/svgPresets";
    import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
    import SfIconView from "../SFIconView.svelte";
    import type { EventStream, ShowContextMenuEvent } from "$lib/EventStream.svelte";
	import { darkTheme, globals } from "$lib/datamodel/globals.svelte";
    import type { SFVariablePowerConsumption } from "$lib/satisfactoryDatabaseTypes";
    import type { AppState } from "$lib/datamodel/AppState.svelte";

	interface Props {
		page: GraphPage;
	}
	const {
		page,
	}: Props = $props();

	const appState = getContext("app-state") as AppState;
	const eventStream = getContext("overlay-layer-event-stream") as EventStream;

	interface AggregateResult<T> {
		hasValues: boolean;
		value: T | undefined;
		setValues: (value: T) => void;
	}
	function aggregateValues<I, V>(items: I[], getValue: (value: I) => V, setValue: (items: I, value: V) => void): AggregateResult<V> {
		function setValues(value: V) {
			for (const item of items) {
				setValue(item, value);
			}
		}
		if (items.length === 0) {
			return { hasValues: false, value: undefined, setValues };
		}
		const first = getValue(items[0]);
		for (let i = 1; i < items.length; i++) {
			const value = getValue(items[i]);
			if (value !== first) {
				return { hasValues: true, value: undefined, setValues };
			}
		}
		return { hasValues: true, value: first, setValues };
	}

	const selectedNodes = $derived.by(() => Array.from(
		page.selectedNodes.values()
			.map(id => page.nodes.get(id))
			.filter(n => n !== undefined)
	));
	const selectedEdges = $derived.by(() => Array.from(
		page.selectedEdges.values()
			.map(id => page.edges.get(id))
			.filter(e => e !== undefined)
	));
	const aggPurityModifier = $derived.by(() => {
		const purityValues = selectedNodes
			.values()
			.map(node => node.properties)
			.filter(properties => properties.type === "production")
			.map(properties => properties as GraphNodeProductionProperties)
			.filter(properties => properties.details.type === "extraction")
			.map(properties => properties.details as ProductionExtractionDetails)
			.filter(details => {
				const building = satisfactoryDatabase.extractionBuildings[details.buildingClassName];
				return building && building.supportsPurity;
			});
		return aggregateValues(
			Array.from(purityValues),
			v => v.purityModifier,
			(v, value) => v.purityModifier = value,
		);
	});
	const aggAutoMultiplier = $derived.by(() => {
		const multiplierValues = selectedNodes
			.values()
			.map(node => node.properties)
			.filter(properties => properties.type === "production")
			.map(properties => properties as GraphNodeProductionProperties)
			.filter(properties => properties.details.type === "factory-input" || properties.details.type === "factory-output");

		return aggregateValues(
			Array.from(multiplierValues),
			v => v.autoMultiplier,
			(v, value) => v.autoMultiplier = value,
		);
	});
	const aggDisplayType = $derived.by(() => {
		return aggregateValues(
			selectedEdges,
			v => v.properties.displayType,
			(v, value) => v.properties.displayType = value,
		);
	});
	const aggStartOrientation = $derived.by(() => {
		const edges = selectedEdges.filter(e => {
			if (!e.startNode) return false;
			if (e.startNode.properties.type !== "resource-joint") return true;
			return !e.startNode.properties.locked;
		});
		return aggregateValues(
			edges,
			v => v.properties.startOrientation,
			(v, value) => v.properties.startOrientation = value,
		);
	});
	const aggEndOrientation = $derived.by(() => {
		const edges = selectedEdges.filter(e => {
			if (!e.endNode) return false;
			if (e.endNode.properties.type !== "resource-joint") return true;
			return !e.endNode.properties.locked;
		});
		return aggregateValues(
			edges,
			v => v.properties.endOrientation,
			(v, value) => v.properties.endOrientation = value,
		);
	});
	const aggIsDrainLine = $derived.by(() => {
		return aggregateValues(
			selectedEdges,
			v => v.properties.isDrainLine,
			(v, value) => v.properties.isDrainLine = value,
		);
	});

	let initialNodeMultipliers: Record<Id, number> = {};
	$effect(() => {
		initialNodeMultipliers = {};
		for (const nodeId of page.selectedNodes.values()) {
			untrack(() => {
				const node = page.nodes.get(nodeId);
				if (node && node.properties.type === "production" && !node.properties.autoMultiplier) {
					initialNodeMultipliers[node.id] = node.properties.multiplier;
				}
				
			});
		}
		if (Object.values(initialNodeMultipliers).length === 1) {
			const firstId = Object.keys(initialNodeMultipliers)[0];
			nodesMultiplier = initialNodeMultipliers[firstId];
			initialNodeMultipliers[firstId] = 1.0;
		} else {
			nodesMultiplier = 1.0;
		}
	});
	let nodesMultiplier: number = $state(1.0);
	function setNodesMultiplier(value: number) {
		nodesMultiplier = value;
		for (const nodeId of page.selectedNodes.values()) {
			const node = page.nodes.get(nodeId);
			const initialMultiplier = initialNodeMultipliers[nodeId] ?? 1.0;
			if (node && node.properties.type === "production" && !node.properties.autoMultiplier) {
				node.properties.multiplier = initialMultiplier * nodesMultiplier;
			}
		}
	}
	const hasProductionNodesSelected = $derived.by(() => {
		for (const nodeId of page.selectedNodes.values()) {
			const node = page.nodes.get(nodeId);
			if (node && node.properties.type === "production" && !node.properties.autoMultiplier) {
				return true;
			}
		}
		return false;
	});

	interface UsedBuilding {
		buildingClassName: string;
		displayName: string;
		icon: string;
		count: number;
		variablePowerRecipes: number[];
	}
	const usedBuildings: UsedBuilding[] = $derived.by(() => {
		const used: Record<string, UsedBuilding> = {};
		for (const node of selectedNodes) {
			if (node.properties.type !== "production") continue;
			const details = node.properties.details;
			let buildingClassName: string | undefined;
			let variablePower: number | undefined;
			switch (details.type) {
				case "recipe":
					const recipe = satisfactoryDatabase.recipes[details.recipeClassName];
					buildingClassName = recipe?.producedIn;
					variablePower = recipe?.customPowerConsumption?.max;
					if (variablePower) {
						variablePower *= node.properties.multiplier;
					}
					break;
				case "extraction":
					buildingClassName = details.buildingClassName;
					break;
				case "power-production":
					buildingClassName = details.powerBuildingClassName;
					break;
			}
			if (buildingClassName) {
				const count = node.properties.multiplier;
				if (!used[buildingClassName]) {
					const building = satisfactoryDatabase.buildings[buildingClassName];
					if (!building)
						continue;
					used[buildingClassName] = {
						buildingClassName: buildingClassName,
						displayName: building.displayName,
						icon: building.icon,
						count: 0,
						variablePowerRecipes: [],
					};
				}
				if (variablePower) {
					used[buildingClassName].variablePowerRecipes.push(variablePower);
				}
				used[buildingClassName].count += count;
			}
		}
		return Object.values(used).toReversed();
	});
	const { powerConsumed, powerProduced } = $derived.by(() => {
		let powerConsumed = 0;
		let powerProduced = 0;
		for (const usedBuilding of usedBuildings) {
			if (usedBuilding.variablePowerRecipes.length === 0) {
				const building = satisfactoryDatabase.buildings[usedBuilding.buildingClassName];
				if (building) {
					powerConsumed += building.powerConsumption * usedBuilding.count;
					powerProduced += building.powerProduction * usedBuilding.count;
				}
			} else {
				for (const recipeVariablePower of usedBuilding.variablePowerRecipes) {
					powerConsumed += recipeVariablePower;
				}
			}
		}
		return { powerConsumed, powerProduced };
	});

	function showMenu() {
		eventStream.emit({
			type: "showContextMenu",
			x: 0,
			y: 30,
			items: [
				{
					label: "Save All Pages",
					icon: "save-as",
					onClick: saveAllPages,
				},
				{
					label: "Save Current Page",
					icon: "export",
					onClick: saveCurrentPage,
				},
				{
					label: "Load File",
					icon: "load",
					onClick: loadFile,
				},
				{
					label: "Import File",
					icon: "import",
					onClick: importFile,
				},
				{
					label: $darkTheme ? "Use Light Theme" : "Use Dark Theme",
					icon: $darkTheme ? "light-theme" : "dark-theme",
					onClick: () => $darkTheme = !$darkTheme,
				},
				{
					label: "View on GitHub",
					icon: "github",
					onClick: () => openLinkInNewTab("https://github.com/ArthurHeitmann/satisfactory-architect"),
				},
				{
					label: "Debug",
					icon: "debug",
					onClick: () => eventStream.emit({
						type: "showContextMenu",
						x: 0,
						y: 30,
						items: [
							{
								label: globals.debugConsoleLog ? "Disable Debug Log" : "Enable Debug Log",
								onClick: () => globals.debugConsoleLog = !globals.debugConsoleLog
							},
							{
								label: globals.debugShowNodeIds ? "Hide Node IDs" : "Show Node IDs",
								onClick: () => globals.debugShowNodeIds = !globals.debugShowNodeIds
							},
							{
								label: globals.debugShowEdgeIds ? "Hide Edge IDs" : "Show Edge IDs",
								onClick: () => globals.debugShowEdgeIds = !globals.debugShowEdgeIds
							},
						],
					}),
				},
			]
		});
	}

	function saveAllPages() {
		const jsonData = JSON.stringify(appState.toJSON());
		saveFileToDisk("save.json", jsonData);
	}

	function saveCurrentPage() {
		const jsonData = JSON.stringify(appState.toJSON([page.id]));
		saveFileToDisk(`${page.name}.json`, jsonData);
	}

	async function loadFile() {
		const text = await loadFileFromDisk();
		if (!text) return;
		let jsonData;
		try {
			jsonData = JSON.parse(text);
		} catch (error) {
			console.error("Failed to parse JSON from file", error);
			return;
		}
		const answer = await showConfirmationPrompt(eventStream, {
			message: "After loading this file, any unsaved changes will be lost. \nDo you want to continue?",
			confirmLabel: "Load",
		});
		if (answer !== true) {
			return;
		}
		appState.replaceFromJSON(jsonData);
	}

	async function importFile() {
		const text = await loadFileFromDisk();
		if (!text) return;
		let jsonData;
		try {
			jsonData = JSON.parse(text);
		} catch (error) {
			console.error("Failed to parse JSON from file", error);
			return;
		}
		appState.insertPagesFromJSON(jsonData);
	}

	type DisplayMethod = {text: string} | {icon: SvgPresetName};
</script>

{#snippet optionButton<T>(agg: AggregateResult<T>, value: T, canToggleToNull: boolean, display: DisplayMethod)}
	<button
		class="toggle-button"
		class:selected={agg.value === value}
		onclick={() => {
			if (agg.value === value) {
				if (canToggleToNull) {
					agg.setValues(null as any);
				}
			} else {
				agg.setValues(value);
			}
		}}
	>
		{#if "text" in display}
			<div class="button-text">{display.text}</div>
		{:else if "icon" in display}
			<PresetSvg name={display.icon} size={18} color="currentColor" />
		{/if}
	</button>
{/snippet}
{#snippet optionButtons<T>(agg: AggregateResult<T>, title: string, canToggleToNull: boolean, pairs: {v: T, display: DisplayMethod}[])}
	{#if agg.hasValues}
		<div class="option-group">
			{#if title}
				<div class="title">{title}</div>
			{/if}
			{#each pairs as pair}
				{@render optionButton(agg, pair.v, canToggleToNull, pair.display)}
			{/each}
		</div>
	{/if}
{/snippet}
<div class="properties-toolbar">
	<div class="option-group">
		<button class="click-button" onclick={showMenu}>
			<PresetSvg name={"hamburger-menu"} size={18} color="currentColor" />
		</button>
		<button class="click-button" onclick={() => page.history.undo()} disabled={!page.history.canUndo}>
			<PresetSvg name={"undo"} size={18} color="currentColor" />
		</button>
		<button class="click-button" onclick={() => page.history.redo()} disabled={!page.history.canRedo}>
			<PresetSvg name={"redo"} size={18} color="currentColor" />
		</button>
		<button class="toggle-button" class:selected={page.view.enableGridSnap} onclick={() => page.view.enableGridSnap = !page.view.enableGridSnap} data-tooltip="Grid Snap" data-tooltip-position="bottom">
			<PresetSvg name={"grid"} size={18} color="currentColor" />
		</button>
	</div>
	{@render optionButtons(aggAutoMultiplier, "", true, [
		{v: true, display: {text: "Auto Rate"}},
	])}
	{#if hasProductionNodesSelected}
		<div class="option-group">
			<div class="title">Multiplier</div>
			<input
				class="multiplier-input"
				value={floatToString(nodesMultiplier, 4)}
				oninput={e => {
					const value = Number((e.target as HTMLInputElement).value);
					if (!isNaN(value) && value !== 0) {
						setNodesMultiplier(value);
					}
				}}
				onkeydown={e => {
					if (e.key === "Enter") {
						(e.target as HTMLInputElement).blur();
					}
				}}
			/>
		</div>
	{/if}
	{@render optionButtons(aggPurityModifier, "", false, [
		{v: 0.5 as const, display: {text: "Impure"}},
		{v: 1.0 as const, display: {text: "Normal"}},
		{v: 2.0 as const, display: {text: "Pure"}},
	])}
	{@render optionButtons(aggDisplayType, "", false, [
		{v: "straight" as const, display: {icon: "straight-line"}},
		{v: "curved" as const, display: {icon: "curved-line"}},
		{v: "angled" as const, display: {icon: "angled-line"}},
		{v: "teleport" as const, display: {icon: "teleport-line"}},
	])}
	{@render optionButtons(aggIsDrainLine, "", true, [
		{v: true, display: {text: "Overflow Only"}},
	])}
	{@render optionButtons(aggStartOrientation, "", true, [
		{v: "right" as const, display: {icon: "arrow-right-base-left"}},
		{v: "left" as const, display: {icon: "arrow-left-base-right"}},
		{v: "top" as const, display: {icon: "arrow-up-base-bottom"}},
		{v: "bottom" as const, display: {icon: "arrow-down-base-top"}},
	])}
	{@render optionButtons(aggEndOrientation, "", true, [
		{v: "left" as const, display: {icon: "arrow-right-base-right"}},
		{v: "right" as const, display: {icon: "arrow-left-base-left"}},
		{v: "bottom" as const, display: {icon: "arrow-up-base-top"}},
		{v: "top" as const, display: {icon: "arrow-down-base-bottom"}},
	])}
	<div class="spacer"></div>
	{#if usedBuildings.length > 0}
		<div class="option-group">
			{#each usedBuildings as building}
				{#if building.icon}
					<div class="used-building" data-tooltip={building.displayName} data-tooltip-position="bottom">
						<SfIconView icon={building.icon} size={24} quality="min" />
						<span class="building-count">{floatToString(building.count, 1)}</span>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
	{#if powerConsumed !== 0 || powerProduced !== 0}
		<div class="option-group">
			{#if powerProduced !== 0}
				<PresetSvg name="power" size={18} color="currentColor" />
				<span class="power-value">+{formatPower(powerProduced)}</span>
			{/if}
			{#if powerConsumed !== 0}
				<PresetSvg name="power" size={18} color="currentColor" />
				<span class="power-value">{powerProduced === 0 ? "" : "-"}{formatPower(powerConsumed)}</span>
			{/if}
			{#if powerConsumed !== 0 && powerProduced !== 0}
				<span class="power-value">
					= {formatPower(powerProduced - powerConsumed)}
				</span>
			{/if}
		</div>
	{/if}
</div>

<style lang="scss">
	.properties-toolbar {
		height: 30px;
		background-color: var(--properties-toolbar-background-color);
		border-bottom: 1px solid var(--properties-toolbar-border-color);
		display: flex;
		align-items: center;
		overflow-x: auto;
		scrollbar-width: none;
		&::-webkit-scrollbar {
			display: none;
		}
	}

	.option-group {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 100%;
		border-right: 1px solid var(--toolbar-border-color);
		padding: 0 8px;
		white-space: nowrap;
		font-size: 14px;

		.title {
			margin-right: 4px;
		}

		input {
			width: 60px;
		}

		:Where(.toggle-button, .click-button) {
			display: flex;
			align-items: center;
			justify-content: center;
			border-radius: var(--rounded-border-radius);
			height: 24px;
			min-width: 24px;

			&:hover {
				background: var(--toggle-button-hover-background-color);
			}
			
			&:active {
				background: var(--toggle-button-active-background-color);
			}

			&:disabled {
				color: var(--toggle-button-disabled-text-color);
				cursor: default;
			}
		}
		
		.toggle-button {
			&.selected {
				color: var(--toggle-button-selected-text-color);
				background: var(--toggle-button-selected-background-color);
			}

			.button-text {
				padding: 0 4px;
			}
		}

		.power-value {
		}

		.used-building {
			display: flex;
			align-items: center;
			gap: 4px;

			& + .used-building {
				margin-left: 4px;
			}

			.building-count {
			}
		}
	}

	.spacer {
		flex-grow: 1;

		& + .option-group {
			border-left: 1px solid var(--toolbar-border-color);
		}
	}
</style>
