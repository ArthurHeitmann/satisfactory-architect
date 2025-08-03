<script lang="ts" module>
	interface RecipePart {
		itemClass: string;
		amountPerMinute?: number;
	}
	interface IconName {
		name: string;
	}
	interface IconComponent {
		component: "splitter" | "merger";
	}
	interface RecipeEntry {
		key: string;
		label: string;
		icon: IconName | IconComponent;
		iconSmall?: string;
		inputs: RecipePart[];
		outputs: RecipePart[];
		buildingClassName?: string;
		details: NewNodeDetails;
	}
	interface Category {
		name: string;
		recipes: RecipeEntry[];
	}
	interface Page {
		name: string;
		categories: Category[];
	}

	const recipesPage: Page = (() => {
		const categories: Record<string, RecipeEntry[]> = {};
		for (const recipe of Object.values(satisfactoryDatabase.recipes)) {
			const categoryName = satisfactoryDatabase.categories[recipe.category] ?? "";
			if (!categories[categoryName]) {
				categories[categoryName] = [];
			}
			const outputPart = satisfactoryDatabase.parts[recipe.outputs[0].itemClass];
			categories[categoryName].push({
				key: recipe.className,
				label: recipe.recipeDisplayName,
				icon: {name: outputPart?.icon ?? ""},
				inputs: recipe.inputs,
				outputs: recipe.outputs,
				buildingClassName: recipe.producedIn,
				details: { type: "recipe", recipeClassName: recipe.className },
			});
		}
		return {
			name: "Recipes",
			categories: Object.entries(categories).map(([name, recipes]) => ({
				name,
				recipes: recipes.sort((a, b) => a.label.localeCompare(b.label)),
			})),
		};
	})();

	const resourceExtractorsPage: Page = (() => {
		const categories: Record<string, RecipeEntry[]> = {};
		for (const productionBuilding of Object.values(satisfactoryDatabase.extractionBuildings)) {
			const building = satisfactoryDatabase.buildings[productionBuilding.buildingClassName];
			const buildingIcon = building?.icon;
			const buildingName = building?.displayName ?? productionBuilding.buildingClassName;
			const categoryName = buildingName;
			if (!categories[categoryName]) {
				categories[categoryName] = [];
			}
			for (const output of productionBuilding.outputs) {
				const part = satisfactoryDatabase.parts[output];
				const partIcon = part?.icon;
				const partName = part?.displayName ?? output;
				const recipe: NewNodeDetails = {
					type: "extraction",
					partClassName: output,
					buildingClassName: productionBuilding.buildingClassName,
				};
				categories[categoryName].push({
					key: `${productionBuilding.buildingClassName} ${output}`,
					label: partName,
					icon: {name: buildingIcon ?? ""},
					iconSmall: partIcon ?? "",
					inputs: [],
					outputs: [{itemClass: output, amountPerMinute: productionBuilding.baseProductionRate}],
					buildingClassName: productionBuilding.buildingClassName,
					details: recipe,
				});
			}
		}
		return {
			name: "Resource Extractors",
			categories: Object.entries(categories).map(([name, recipes]) => ({
				name,
				recipes: recipes.sort((a, b) => a.label.localeCompare(b.label)),
			})),
		};
	})();

	const powerRecipesPage: Page = (() => {
		const categories: Record<string, RecipeEntry[]> = {};
		for (const powerProducer of Object.values(satisfactoryDatabase.powerProducers)) {
			const building = satisfactoryDatabase.buildings[powerProducer.buildingClassName];
			const buildingIcon = building?.icon;
			const buildingName = building?.displayName ?? powerProducer.buildingClassName;
			const categoryName = buildingName;
			if (!categories[categoryName]) {
				categories[categoryName] = [];
			}
			for (const [fuelClassName, fuelRecipe] of Object.entries(powerProducer.fuels)) {
				const recipe: PowerProductionDetails = {
					type: "power-production",
					powerBuildingClassName: powerProducer.buildingClassName,
					fuelClassName,
				};
				const fuel = satisfactoryDatabase.parts[fuelClassName];
				const fuelIcon = fuel?.icon;
				const fuelName = fuel?.displayName ?? fuelClassName;
				const name = fuelName;

				categories[categoryName].push({
					key: `${powerProducer.buildingClassName} ${fuelClassName}`,
					label: name,
					icon: {name: buildingIcon ?? ""},
					iconSmall: fuelIcon ?? "",
					inputs: fuelRecipe.inputs,
					outputs: fuelRecipe.outputs,
					buildingClassName: powerProducer.buildingClassName,
					details: recipe,
				});
			}
		}
		return {
			name: "Power Production",
			categories: Object.entries(categories).map(([name, recipes]) => ({
				name,
				recipes: recipes.sort((a, b) => a.label.localeCompare(b.label)),
			})),
		};
	})();


	const [factoryInputsPage, factoryOutputsPage] = (() => {
		const inputs: RecipeEntry[] = [];
		const outputs: RecipeEntry[] = [];
		for (const part of Object.values(satisfactoryDatabase.parts)) {
			inputs.push({
				key: `input ${part.displayName}`,
				label: part.displayName,
				icon: {name: part.icon ?? ""},
				inputs: [{itemClass: part.className}],
				outputs: [],
				details: { type: "factory-input", partClassName: part.className },
			});
			outputs.push({
				key: `output ${part.displayName}`,
				label: part.displayName,
				icon: {name: part.icon ?? ""},
				inputs: [],
				outputs: [{itemClass: part.className}],
				details: { type: "factory-output", partClassName: part.className },
			});
		}
		return [
			{
				name: "Factory Inputs",
				categories: [{
					name: "",
					recipes: inputs.sort((a, b) => a.label.localeCompare(b.label)),
				}],
			},
			{
				name: "Factory Outputs",
				categories: [{
					name: "",
					recipes: outputs.sort((a, b) => a.label.localeCompare(b.label)),
				}],
			},
		]
	})();
</script>
<script lang="ts">
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
	import { innerWidth } from "svelte/reactivity/window";
	import SfIconView from "./SFIconView.svelte";
	import { getContext, onMount } from "svelte";
	import type { SFPart, SFRecipe, SFRecipePart } from "$lib/satisfactoryDatabaseTypes";
	import MergerIcon from "./icons/MergerIcon.svelte";
	import SplitterIcon from "./icons/SplitterIcon.svelte";
	import type { GraphNode, GraphNodeProductionProperties, NewNodeDetails, PowerProductionDetails } from "../datamodel/GraphNode.svelte";
    import type { GraphPage } from "../datamodel/GraphPage.svelte";
    import type { AppState } from "../datamodel/AppState.svelte";
    import { getProductionNodeDisplayName } from "../datamodel/nodeTypeProperties.svelte";
    import { floatToString } from "$lib/utilties";

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

	const factoriesPage: Page = (() => {
		const factories: RecipeEntry[] = [];
		const currentPageId = page.id;
		for (const page of appState.pages) {
			if (page.id === currentPageId) {
				continue;
			}
			const inputs: RecipePart[] = [];
			const outputs: RecipePart[] = [];
			for (const node of page.nodes.values()) {
				if (node.properties.type !== "production") {
					continue;
				}
				if (node.properties.details.type === "factory-output") {
					outputs.push({itemClass: node.properties.details.partClassName, amountPerMinute: node.properties.multiplier});
				} else if (node.properties.details.type === "factory-input") {
					inputs.push({itemClass: node.properties.details.partClassName, amountPerMinute: node.properties.multiplier});
				}
			}
			if (inputs.length === 0 && outputs.length === 0) {
				continue;
			}
			factories.push({
				key: page.id,
				label: page.name,
				icon: {name: ""},
				inputs: inputs,
				outputs: outputs,
				details: { type: "factory-reference", factoryId: page.id, jointsToExternalNodes: {} },
			});
		}
		return {
			name: "Factories",
			categories: [{
				name: "",
				recipes: factories.sort((a, b) => a.label.localeCompare(b.label)),
			}],
		};
	})();

	const allDefaultPages: Page[] = [
		recipesPage,
		factoryInputsPage,
		factoryOutputsPage,
		resourceExtractorsPage,
		powerRecipesPage,
		factoriesPage,
	];

	const allPages: Page[] = (() => {
		if (requiredInputsClassName || requiredOutputsClassName) {
			function filterRecipes(recipes: RecipeEntry[]): RecipeEntry[] {
				if (requiredInputsClassName) {
					return recipes.filter(recipe => recipe.inputs.some(e => e.itemClass === requiredInputsClassName));
				} else if (requiredOutputsClassName) {
					return recipes.filter(recipe => recipe.outputs.some(e => e.itemClass === requiredOutputsClassName));
				}
				return [];
			}
			const part = satisfactoryDatabase.parts[requiredInputsClassName || requiredOutputsClassName];
			const pages: Page[] = [{
				name: "Recipes",
				categories: [
					{
						name: "Special",
						recipes: part ? [
							<RecipeEntry>{
								key: "factory-output/input",
								label: requiredInputsClassName ? "Factory Output" : "Factory Input",
								icon: {name: part?.icon ?? ""},
								inputs: [],
								outputs: [],
								details: { type: requiredInputsClassName ? "factory-output" : "factory-input", partClassName: part?.className },
							},
							<RecipeEntry>{
								key: "Splitter",
								label: "Splitter",
								icon: {component: "splitter"},
								iconSmall: part.icon,
								inputs: [],
								outputs: [],
								details: { type: "splitter", resourceClassName: part.className },
							},
							<RecipeEntry>{
								key: "Merger",
								label: "Merger",
								icon: {component: "merger"},
								iconSmall: part.icon,
								inputs: [],
								outputs: [],
								details: { type: "merger", resourceClassName: part.className },
							},
						] : [],
					},
					{
						name: resourceExtractorsPage.name,
						recipes: filterRecipes(resourceExtractorsPage.categories.map(c => c.recipes).flat())
					},
					{
						name: factoriesPage.name,
						recipes: filterRecipes(factoriesPage.categories[0].recipes)
					},
					...recipesPage.categories.map(category => ({
						name: category.name,
						recipes: filterRecipes(category.recipes)
					})),
					{
						name: powerRecipesPage.name,
						recipes: filterRecipes(powerRecipesPage.categories.map(c => c.recipes).flat())
					},
				]
					.filter(category => category.recipes.length > 0)
			}];
			return pages;
		} else {
			return allDefaultPages;
		}
	})();

	const filteredPages: Page[] = $derived.by(() => {
		const query = searchQuery.trim().toLowerCase();
		if (query === "") {
			return allPages;
		}
		const pages: Page[] = [];
		for (const page of allPages) {
			const categories: Category[] = [];
			for (const category of page.categories) {
				if (category.name.includes(query)) {
					categories.push(category);
					continue;
				}
				let newCategory: Category|undefined;
				for (const recipe of category.recipes) {
					if (recipe.label.toLowerCase().includes(query)) {
						if (!newCategory) {
							newCategory = { name: category.name, recipes: [] };
							categories.push(newCategory);
						}
						newCategory.recipes.push(recipe);
					}
				}
			}
			if (categories.length > 0) {
				pages.push({ name: page.name, categories });
			}
		}
		if (pages.length === 0) {
			pages.push({
				name: "No results",
				categories: [{
					name: "No results",
					recipes: []
				}]
			});
		}
		return pages;
	})

	let selectedPageIndex = $state(0);
	const activePageIndex = $derived(Math.min(selectedPageIndex, filteredPages.length - 1));
	const activePage = $derived(filteredPages[activePageIndex]);
	let hoveredRecipe: RecipeEntry|null = $state(null);
	
	const maxPerCategoryCount = $derived(Math.max(...allPages[0].categories.map(c => c.recipes.length).flat()));

	const iconSize = 80;
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
	{#if filteredPages.length > 1}
		<div class="pages-list">
			{#each filteredPages as page, index (page.name)}
				<button
					class="page-button button"
					onclick={() => selectedPageIndex = index}
					class:selected={activePageIndex === index}
				>
					{page.name}
				</button>
			{/each}
		</div>
	{/if}
	<div class="search-bar">
		<input
			type="text"
			placeholder="Search recipes..."
			bind:value={searchQuery}
			bind:this={input}
		/>
	</div>
	<div class="recipe-list">
		{#each activePage.categories as category (category.name)}
			<div class="recipe-group">
				{#if category.name}
					<div class="recipe-group-title-wrapper">
						<div class="recipe-group-title">
							<div>{category.name}</div>
						</div>
					</div>
				{/if}
				<div class="recipe-grid">
					{#each category.recipes as recipe (recipe.key)}
						<button
							class="recipe-item button"
							onclick={() => onRecipeSelected(recipe.details)}
							onpointerenter={() => hoveredRecipe = recipe}
						>
							<div class="icon-wrapper">
								{#if "name" in recipe.icon}
									<SfIconView icon={recipe.icon.name} size={iconSize} />
								{:else if "component" in recipe.icon}
									{#if recipe.icon.component === "splitter"}
										<SplitterIcon size={iconSize} fill="var(--text)" />
									{:else if recipe.icon.component === "merger"}
										<MergerIcon size={iconSize} fill="var(--text)" />
									{/if}
								{/if}
								{#if recipe.iconSmall}
									<SfIconView icon={recipe.iconSmall} size={iconSize / 2} />
								{/if}
							</div>
							<div
								class="recipe-name"
								style="line-height: {labelHeight / 3}px; max-height: {labelHeight}px;"
							>
								<span>{recipe.label}</span>
							</div>
						</button>
					{/each}
				</div>
			</div>
		{/each}
	</div>
	<div class="hovered-recipe-preview">
		{#snippet previewComponent(iconName: string, name: string, rate: number|undefined)}
			<div class="preview-component">
				<SfIconView icon={iconName} size={30} />
				{#if rate !== undefined}
					<div class="component-rate-label">{floatToString(rate)}</div>
				{/if}
				<div class="component-label">{name}</div>
			</div>
		{/snippet}
		{#if hoveredRecipe && (hoveredRecipe.inputs.length > 0 || hoveredRecipe.outputs.length > 0)}
			{#each hoveredRecipe.inputs as input, i}
				{#if i > 0}
					<div>+</div>
				{/if}
				{@const part = satisfactoryDatabase.parts[input.itemClass]}
				{#if part}
					{@render previewComponent(part.icon, part.displayName, input.amountPerMinute)}
				{/if}
			{/each}
			<div>→</div>
			{#each hoveredRecipe.outputs as output, i}
				{#if i > 0}
					<div>+</div>
				{/if}
				{@const part = satisfactoryDatabase.parts[output.itemClass]}
				{#if part}
					{@render previewComponent(part.icon, part.displayName, output.amountPerMinute)}
				{/if}
			{/each}
		{/if}
	</div>
</div>

<style lang="scss">
	.button {
		background-color: var(--recipe-selector-tile-color);

		&:hover {
			background-color: var(--recipe-selector-tile-hover-color);
		}

		&:active, &.selected {
			background-color: var(--recipe-selector-tile-active-color);
		}
	}

	.recipe-selector {
		display: flex;
		flex-direction: column;
		background-color: var(--recipe-selector-background-color);
		border-radius: var(--rounded-border-radius);
		border: var(--rounded-border-width) solid var(--recipe-selector-border-color);
		max-height: var(--max-height);
	}

	.pages-list {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;

		.page-button {
			flex: 1;
			padding: 5px 10px;
			border-bottom: 1px solid var(--recipe-selector-border-color);

			& + .page-button {
				border-left: 1px solid var(--recipe-selector-border-color);
			}

			&:last-child {
				border-right: 1px solid var(--recipe-selector-border-color);
			}
		}
	}

	.search-bar {
		width: 100%;
		line-height: 40px;
		margin: 0 10px;

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
		margin: 0 10px 0px 10px;
	}

	.recipe-group {
		position: relative;
		display: flex;
		flex-direction: column;

		.recipe-group-title-wrapper {
			position: sticky;
			z-index: 1;
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
		border-radius: var(--rounded-border-radius);
		border: var(--rounded-border-width) solid var(--recipe-selector-tile-border-color);

		.recipe-name {
			flex: 1;
			display: flex;
			align-items: center;
			font-size: 13px;
			word-break: break-word;
			padding: 4px;
			overflow: hidden;
		}

		.icon-wrapper {
			position: relative;

			&:global(> :nth-child(2)) {
				position: absolute;
				bottom: 0;
				right: 0;
				filter: var(--recipe-selector-tile-secondary-img-shadow);
			}
		}
	}

	.hovered-recipe-preview {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 10px;
		min-height: 40px;
		overflow: hidden;
		background-color: var(--recipe-selector-background-color);
		border-top: 1px solid var(--recipe-selector-border-color);

		.preview-component {
			display: flex;
			align-items: center;
			position: relative;
			height: 30px;
			gap: 5px;

			.component-label {
				font-size: 10px;
				line-height: 12px;
				max-width: 80px;
			}

			.component-rate-label {
				position: absolute;
				bottom: 0;
				left: 0;
				width: 30px;
				font-size: 10px;
				text-align: right;
			}
		}
	}
</style>