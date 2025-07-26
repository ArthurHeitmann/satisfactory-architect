<script lang="ts">
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
	import { innerWidth } from "svelte/reactivity/window";
	import SfIconView from "./SFIconView.svelte";
	import { getContext, onMount } from "svelte";
	import type { SFPart, SFRecipe } from "$lib/satisfactoryDatabaseTypes";
	import MergerIcon from "./icons/MergerIcon.svelte";
	import SplitterIcon from "./icons/SplitterIcon.svelte";
	import type { GraphNode, GraphNodeProductionProperties, NewNodeDetails } from "./datamodel/GraphNode.svelte";
    import type { GraphPage } from "./datamodel/GraphPage.svelte";
    import type { AppState } from "./datamodel/AppState.svelte";

	interface Props {
		requiredInputsClassName?: string;
		requiredOutputsClassName?: string;
		onRecipeSelected: (details: NewNodeDetails) => void;
		onNoAvailableRecipes: () => void;
		cssWidth?: string;
		autofocusSearch?: boolean;
	}
	let {
		requiredInputsClassName = "",
		requiredOutputsClassName = "",
		onRecipeSelected,
		onNoAvailableRecipes,
		cssWidth = $bindable(""),
		autofocusSearch = false,
	}: Props = $props();

	const page = getContext("graph-page") as GraphPage;
	const appState = getContext("app-state") as AppState;

	let searchQuery = $derived("");

	let availableRecipes = Object.values(satisfactoryDatabase.recipes);
	if (requiredInputsClassName) {
		availableRecipes = availableRecipes.filter(recipe =>
			recipe.inputs.some(input => input.itemClass === requiredInputsClassName)
		);
	}
	if (requiredOutputsClassName) {
		availableRecipes = availableRecipes.filter(recipe =>
			recipe.outputs.some(output => output.itemClass === requiredOutputsClassName)
		);
	}
	const recipesByCategory = $derived.by(() => {
		const map: Record<string, SFRecipe[]> = {};
		for (const recipe of availableRecipes) {
			const categoryName = satisfactoryDatabase.categories[recipe.category] ?? "";
			const nameMatches = recipe.recipeDisplayName.toLowerCase().includes(searchQuery.trim().toLowerCase());
			const categoryMatches = categoryName.toLowerCase().includes(searchQuery.trim().toLowerCase());
			if (!nameMatches && !categoryMatches) {
				continue;
			}
			if (!map[categoryName]) {
				map[categoryName] = [];
			}
			map[categoryName].push(recipe);
		}
		return map;
	});

	const factoryPages = (() => {
		const pages: GraphPage[] = [];
		const currentPageId = page.id;
		for (const page of appState.pages) {
			if (page.id === currentPageId) {
				continue;
			}
			const inputNodeTypes: string[] = [];
			const outputNodeTypes: string[] = [];
			for (const node of page.nodes.values()) {
				if (node.properties.type !== "production") {
					continue;
				}
				if (node.properties.details.type === "factory-output") {
					inputNodeTypes.push(node.properties.details.partClassName);
				} else if (node.properties.details.type === "factory-input") {
					outputNodeTypes.push(node.properties.details.partClassName);
				}
			}
			if (inputNodeTypes.length === 0 && outputNodeTypes.length === 0) {
				continue;
			}
			if (requiredInputsClassName) {
				if (outputNodeTypes.includes(requiredInputsClassName)) {
					pages.push(page);
				}
			} else if (requiredOutputsClassName) {
				if (inputNodeTypes.includes(requiredOutputsClassName)) {
					pages.push(page);
				}
			} else {
				pages.push(page);
			}
		}
		return pages;
	})();

	const { factoryPart, inputOutputType, productionBuildings } = $derived.by(() => {
		let factoryPart: SFPart | null = null;
		let inputOutputType: "input" | "output" | null = null;
		let requiredClassName: string = "";
		if (requiredInputsClassName.length > 0) {
			inputOutputType = "input";
			requiredClassName = requiredInputsClassName;
		} else if (requiredOutputsClassName.length > 0) {
			inputOutputType = "output";
			requiredClassName = requiredOutputsClassName;
		}

		if (inputOutputType !== null) {
			factoryPart = satisfactoryDatabase.parts[requiredClassName];
		}
		const productionBuildings: string[] = [];
		if (inputOutputType === "output") {
			for (const building of Object.values(satisfactoryDatabase.productionBuildings)) {
				if (building.outputs.includes(requiredClassName)) {
					productionBuildings.push(building.buildingClassName);
				}
			}
		}

		return {factoryPart, inputOutputType, productionBuildings};
	});
	
	const maxPerCategoryCount = $derived(Math.max(
		...Object.values(recipesByCategory).map(groupRecipes => groupRecipes.length),
		(factoryPart !== null ? 3 : 0) + productionBuildings.length + factoryPages.length,
	));

	const iconSize = 100;
	const iconTopPadding = 5;
	const labelHeight = 40;
	const itemSize = iconSize + iconTopPadding + labelHeight;
	const itemsPerRow = $derived(Math.max(2, Math.min(maxPerCategoryCount, 5,
		Math.floor(((innerWidth.current ?? 500) - 150) / itemSize))
	));
	$effect(() => {
		cssWidth = `calc(${itemsPerRow} * ${itemSize}px + (${itemsPerRow} - 1) * 10px + 50px)`;
	});

	let input: HTMLInputElement;
	onMount(() => {
		if (maxPerCategoryCount === 0) {
			onNoAvailableRecipes();
		}
		if (input && autofocusSearch) {
			input.focus();
		}
	});
</script>

<div
	class="recipe-selector"
	style="--items-per-row: {itemsPerRow}; --item-size: {itemSize}px; --icon-size: {iconSize}px; --icon-top-padding: {iconTopPadding}px; --label-height: {labelHeight}px;"
>
	<div class="search-bar">
		<input
			type="text"
			placeholder="Search recipes..."
			bind:value={searchQuery}
			bind:this={input}
		/>
	</div>
	<div class="recipe-list">
		{#if factoryPages.length > 0}
			<div class="recipe-group">
				<div class="recipe-group-title-wrapper">
					<div class="recipe-group-title">
						<div>Factories</div>
					</div>
				</div>
				<div class="recipe-grid">
					{#each factoryPages as factoryPage}
						<button
							class="recipe-item"
							onclick={() => onRecipeSelected({type: "factory-reference", factoryId: factoryPage.id, jointsToExternalNodes: {}})}
						>
							<div
								class="recipe-name"
								style="line-height: {labelHeight / 2}px; max-height: {labelHeight}px;"
							>
								<span>{factoryPage.name}</span>
							</div>
						</button>
					{/each}
				</div>
			</div>
		{/if}
		{#if inputOutputType !== null}
			<div class="recipe-group">
				<div class="recipe-group-title-wrapper">
					<div class="recipe-group-title">
						<div>Special</div>
					</div>
				</div>
				<div class="recipe-grid">
					{#each ["splitter", "merger"] as const as splitterMerger}
						<button
							class="recipe-item"
							onclick={() => onRecipeSelected({ type: splitterMerger, resourceClassName: factoryPart!.className })}
						>
							{#if splitterMerger === "splitter"}
								<SplitterIcon
									size={iconSize}
									fill="var(--text)"
								/>
							{:else}
								<MergerIcon
									size={iconSize}
									fill="var(--text)"
								/>
							{/if}
							<div
								class="recipe-name"
								style="line-height: {labelHeight / 2}px; max-height: {labelHeight}px;"
							>
								<span>{splitterMerger === "splitter" ? "Splitter" : "Merger"}</span>
							</div>
						</button>
					{/each}
					<button
						class="recipe-item"
						onclick={() => onRecipeSelected({type: inputOutputType === "input" ? "factory-output" : "factory-input", partClassName: factoryPart!.className})}
					>
						<SfIconView icon={factoryPart!.icon} size={iconSize} />
						<div
							class="recipe-name"
							style="line-height: {labelHeight / 2}px; max-height: {labelHeight}px;"
						>
							<span>Factory {inputOutputType === "input" ? "Output" : "Input"}</span>
						</div>
					</button>
					{#each productionBuildings as productionBuildingName}
						{@const building = satisfactoryDatabase.buildings[productionBuildingName]}
						<button
							class="recipe-item"
							onclick={() => onRecipeSelected({type: "extraction", partClassName: factoryPart!.className, buildingClassName: productionBuildingName})}
						>
							<SfIconView icon={factoryPart!.icon} size={iconSize} />
							<div
								class="recipe-name"
								style="line-height: {labelHeight / 2}px; max-height: {labelHeight}px;"
							>
								<span>{building.displayName ?? productionBuildingName}</span>
							</div>
						</button>
					{/each}
				</div>
			</div>
		{/if}
		{#each Object.entries(recipesByCategory) as [category, groupRecipes]}
			<div class="recipe-group">
				<div class="recipe-group-title-wrapper">
					<div class="recipe-group-title">
						<div>{category ?? ""}</div>
					</div>
				</div>
				<div class="recipe-grid">
					{#each groupRecipes as recipe (recipe.className)}
						{@const firstOutput = satisfactoryDatabase.parts[recipe.outputs[0].itemClass]}
						<button
							class="recipe-item"
							onclick={() => onRecipeSelected({type: "recipe", recipeClassName: recipe.className})}
						>
							<SfIconView icon={firstOutput.icon} size={iconSize} />
							<div
								class="recipe-name"
								style="line-height: {labelHeight / 2}px; max-height: {labelHeight}px;"
							>
								<span>{recipe.recipeDisplayName}</span>
							</div>
						</button>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>

<style lang="scss">
	.recipe-selector {
		display: flex;
		flex-direction: column;
		padding: 0 10px 10px 10px;
		background-color: var(--recipe-selector-background-color);
		border-radius: var(--rounded-border-radius);
		border: var(--rounded-border-width) solid var(--recipe-selector-border-color);
		max-height: var(--max-height);
	}

	.search-bar {
		width: 100%;
		line-height: 40px;

		input {
			width: 100%;
		}
	}

	.recipe-list {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.recipe-group {
		position: relative;
		display: flex;
		flex-direction: column;

		.recipe-group-title-wrapper {
			position: sticky;
			top: 0;
			background: var(--recipe-selector-background-color);
			padding-bottom: 5px;

			.recipe-group-title {
				background: var(--recipe-selector-tile-color);
				border-radius: var(--rounded-border-radius);
				display: flex;
				align-items: center;
				gap: 5px;
				padding: 4px 4px;
				font-weight: bold;
			}
		}
	}

	.recipe-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.recipe-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: var(--item-size);
		padding-top: var(--icon-top-padding);
		background-color: var(--recipe-selector-tile-color);
		border-radius: var(--rounded-border-radius);
		border: var(--rounded-border-width) solid var(--recipe-selector-tile-border-color);

		&:hover {
			background-color: var(--recipe-selector-tile-hover-color);	
		}

		&:active {
			background-color: var(--recipe-selector-tile-active-color);
		}

		.recipe-name {
			flex: 1;
			display: flex;
			align-items: center;
			font-size: 14px;
			word-break: break-word;
			padding: 0 4px;
			overflow: hidden;
		}
	}
</style>