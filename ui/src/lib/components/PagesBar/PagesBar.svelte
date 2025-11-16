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

	let isDragging = $state(false);
	let currentDragPageIndex = $state(-1);
	let draggedButtonX = $state(0);
	let placeholderWidth = $state(0);
	let placeholderHeight = $state(0);
	let pagesBarElement: HTMLDivElement | null = $state(null);
	
	let dragStartX = 0;
	let dragStartPageIndex = -1;
	let pageButtonBoundaries: Array<{ left: number; right: number; center: number }> = [];
	let initialCursorOffset = 0;

	function calculateButtonBoundaries() {
		if (!pagesBarElement) return;
		
		const boundaries: Array<{ left: number; right: number; center: number }> = [];
		const buttons = pagesBarElement.querySelectorAll(".page-button");
		
		for (const button of buttons) {
			const rect = button.getBoundingClientRect();
			const containerRect = pagesBarElement!.getBoundingClientRect();
			const left = rect.left - containerRect.left;
			const right = rect.right - containerRect.left;
			boundaries.push({
				left,
				right,
				center: left + (right - left) / 2
			});
		}
		
		pageButtonBoundaries = boundaries;
	}

	function handleMouseDown(event: MouseEvent) {
		if (event.button !== 0) return;
		
		const target = event.target as HTMLElement;
		const pageButton = target.closest(".page-button");
		if (!pageButton) return;
		
		if (target.contentEditable === "plaintext-only" || target.classList.contains("editing")) return;
		if (event.detail === 2) return;
		
		const allButtons = Array.from(pagesBarElement?.querySelectorAll(".page-button") ?? []);
		const buttonIndex = allButtons.indexOf(pageButton);
		if (buttonIndex === -1) return;
		
		const buttonRect = pageButton.getBoundingClientRect();
		initialCursorOffset = event.clientX - buttonRect.left;
		placeholderWidth = buttonRect.width;
		placeholderHeight = buttonRect.height;
		
		isDragging = true;
		dragStartX = event.clientX;
		dragStartPageIndex = buttonIndex;
		currentDragPageIndex = buttonIndex;
		
		draggedButtonX = event.clientX - initialCursorOffset;
		
		calculateButtonBoundaries();
		
		event.preventDefault();
	}

	function handleMouseMove(event: MouseEvent) {
		if (!isDragging || !pagesBarElement) return;
		
		draggedButtonX = event.clientX - initialCursorOffset;
		
		const containerRect = pagesBarElement.getBoundingClientRect();
		const relativeX = event.clientX - containerRect.left;
		
		let newIndex = currentDragPageIndex;
		for (let i = 0; i < pageButtonBoundaries.length; i++) {
			if (i === currentDragPageIndex) continue;
			const boundary = pageButtonBoundaries[i];

			if (i < currentDragPageIndex && relativeX < boundary.center) {
				newIndex = i;
				break;
			} else if (i > currentDragPageIndex && relativeX > boundary.center) {
				newIndex = i;
				break;
			}
		}
		
		if (newIndex !== currentDragPageIndex && newIndex >= 0) {
			appState.swapPages(currentDragPageIndex, newIndex);
			currentDragPageIndex = newIndex;
			
			setTimeout(() => calculateButtonBoundaries(), 0);
		}
	}

	function handleMouseUp() {
		if (!isDragging) return;
		
		isDragging = false;
		draggedButtonX = 0;
		dragStartX = 0;
		dragStartPageIndex = -1;
		currentDragPageIndex = -1;
		pageButtonBoundaries = [];
		initialCursorOffset = 0;
		placeholderWidth = 0;
		placeholderHeight = 0;
	}
</script>

<svelte:window
	on:mousemove={handleMouseMove}
	on:mouseup={handleMouseUp}
/>

<div class="pages-bar" bind:this={pagesBarElement} onmousedown={handleMouseDown}>
	{#if browser}
		{#each appState.pages as page, index (page.id)}
			{#if isDragging && index === currentDragPageIndex}
				<div 
					class="page-button-placeholder"
					style:width={`${placeholderWidth}px`}
					style:height={`${placeholderHeight}px`}
				></div>
			{/if}
			<PageButton
				page={page}
				onSelect={() => appState.setCurrentPage(page)}
				onRemove={() => appState.removePage(page.id)}
				canBeRemoved={appState.pages.length > 1}
				activePageId={appState.currentPage.id}
				isDraggedButton={isDragging && index === currentDragPageIndex}
				absoluteX={isDragging && index === currentDragPageIndex ? draggedButtonX : 0}
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
		user-select: none;
	}

	.page-button-placeholder {
		flex-shrink: 0;
		background-color: transparent;
		border: 2px dashed rgba(255, 255, 255, 0.3);
		border-radius: 4px;
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
