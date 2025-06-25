<script lang="ts">
    import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
    import { innerWidth } from "svelte/reactivity/window";
    import SfIconView from "./SFIconView.svelte";
    import { onMount } from "svelte";
    import type { SFRecipe } from "$lib/satisfactoryDatabaseTypes";

	interface Props {
		requiredInputsClassName?: string;
		requiredOutputsClassName?: string;
		onRecipeSelected: (recipeClassName: string) => void;
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
	

	const iconSize = 100;
	const iconTopPadding = 5;
	const labelHeight = 40;
	const itemSize = iconSize + iconTopPadding + labelHeight;
	const itemsPerRow = $derived(Math.max(2, Math.min(availableRecipes.length, 5,
		Math.floor(((innerWidth.current ?? 500) - 150) / itemSize))
	));
	$effect(() => {
		cssWidth = `calc(${itemsPerRow} * ${itemSize}px + (${itemsPerRow} - 1) * 10px + 50px)`;
	});

	let input: HTMLInputElement;
	onMount(() => {
		if (availableRecipes.length === 0) {
			onNoAvailableRecipes();
		}
		if (input && autofocusSearch) {
			input.focus();
		}
	});
</script>

<div
	class="recipe-selector"
	style="--items-per-row: {itemsPerRow}; --item-size: {itemSize}px;"
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
							style="width: {itemSize}px; height: {itemSize}px; padding-top: {iconTopPadding}px;"
							onclick={() => onRecipeSelected(recipe.className)}
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
		background-color: var(--background-300);
		border-radius: 8px;
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
			background: var(--background-300);
			padding-bottom: 5px;

			.recipe-group-title {
				background: var(--background-200);
				border-radius: 4px;
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
		background-color: var(--background-200);
		border-radius: 4px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

		&:hover {
			background-color: var(--background-100);
		}

		.recipe-name {
			flex: 1;
			display: flex;
			align-items: center;
			font-size: 14px;
			color: var(--text-primary);
			word-break: break-word;
			padding: 0 4px;
			overflow: hidden;
		}
	}
</style>