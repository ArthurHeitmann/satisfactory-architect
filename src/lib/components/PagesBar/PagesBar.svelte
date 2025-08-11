<script lang="ts">
    import { browser } from "$app/environment";
    import type { AppState } from "$lib/datamodel/AppState.svelte";
    import { GraphPage } from "$lib/datamodel/GraphPage.svelte";
    import PresetSvg from "../icons/PresetSvg.svelte";
    import PageButton from "./PageButton.svelte";

	interface Props {
		appState: AppState;
	}
	const {
		appState,
	}: Props = $props();
</script>

<div class="pages-bar">
	{#if browser}
		{#each appState.pages as page (page.id)}
			<PageButton
				page={page}
				onSelect={() => appState.setCurrentPage(page)}
				onRemove={() => appState.removePage(page.id)}
				canBeRemoved={appState.pages.length > 1}
				activePageId={appState.currentPage.id}
			/>
		{/each}
		<button
			class="add-page-button"
			onclick={() => {
				const newPage = GraphPage.newDefault(appState, `Page ${appState.pages.length + 1}`);
				appState.addPage(newPage);
				appState.setCurrentPage(newPage);
			}}
		>
			<PresetSvg name="add" size={26} color="currentColor" />
		</button>
		<div class="spacer"></div>
		<a href="https://github.com/ArthurHeitmann/satisfactory-architect" target="_blank">
			<PresetSvg name="github" size={24} color="currentColor" />
		</a>
	{/if}
</div>

<style lang="scss">
	.pages-bar {
		display: flex;
		align-items: center;
		overflow-x: auto;
		scrollbar-width: none;
		&::-webkit-scrollbar {
			display: none;
		}
		border-top: 1px solid var(--pages-bar-border-color);
		padding-right: 8px;
	}

	.add-page-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 4px;
		margin-left: 4px;
		color: var(--text);

		&:hover {
			background-color: var(--pages-bar-button-hover-background-color);
		}

		&:active {
			background-color: var(--pages-bar-button-active-background-color);
		}
	}

	.spacer {
		flex-grow: 1;
	}

	a {
		width: 24px;
		height: 24px;
	}
</style>
