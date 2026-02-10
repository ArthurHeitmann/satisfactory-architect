<script lang="ts">
	import { browser } from "$app/environment";
	import type { AppState } from "$lib/datamodel/AppState.svelte";
	import { GraphPage } from "$lib/datamodel/GraphPage.svelte";
    import type { Id } from "$lib/datamodel/IdGen.svelte";
	import PresetSvg from "../icons/PresetSvg.svelte";
	import PageButton from "./PageButton.svelte";

	interface Props {
		appState: AppState;
	}
	const {
		appState,
	}: Props = $props();

	let isStartingDrag = $state(false);
	let startCursorX = 0;

	let isDragging = $state(false);
	let currentDragPageId: Id|null = $state(null);
	let previousCursorX = 0;
	let placeholderWidth = $state(0);
	let placeholderHeight = $state(0);
	let draggedButtonAbsoluteOffset = $state(0);
	let initialCursorRelativeOffset = $state(0);
	let pagesBarElement: HTMLDivElement | null = $state(null);
	
	interface Boundary {
		left: number;
		right: number;
		center: number;
		width: number;
	}
	const pageButtonBoundaries = $derived.by(() => {
		const boundaries = new Map<Id, Boundary>();
		if (!pagesBarElement) return boundaries;
		
		const _ = appState.pages;	// dependency
		const buttons = pagesBarElement.querySelectorAll(".page-button:not(.dragging), .page-button-placeholder");
		if (buttons.length !== appState.pages.length) {
			console.warn("Button count does not match page count. Cannot calculate boundaries.");
			return boundaries;
		}
		for (let i = 0; i < buttons.length; i++) {
			const button = buttons[i] as HTMLElement;
			const page = appState.pages[i];
			const rect = button.getBoundingClientRect();
			const containerRect = pagesBarElement.getBoundingClientRect();
			const left = rect.left - containerRect.left;
			const right = rect.right - containerRect.left;
			const width = right - left;
			const center = left + width / 2;
			boundaries.set(page.id, { left, right, center, width });
		}
		return boundaries;
	});

	function getEventXOffset(event: MouseEvent | TouchEvent): number {
		if (event instanceof MouseEvent) {
			return event.clientX;
		} else if (event.touches.length > 0) {
			return event.touches[0].clientX;
		}
		return 0;
	}

	function attemptStartDrag(event: MouseEvent | TouchEvent) {
		const target = event.target as HTMLElement;
		const pageButton = target.closest(".page-button");
		if (!pageButton) return;
		
		if (target.contentEditable === "plaintext-only" || target.classList.contains("editing")) return;
		if (event.detail === 2) return;
		
		const allButtons = Array.from(pagesBarElement?.querySelectorAll(".page-button") ?? []);
		const buttonIndex = allButtons.indexOf(pageButton);
		if (buttonIndex === -1) return;
		
		const buttonRect = pageButton.getBoundingClientRect();
		startCursorX = getEventXOffset(event);
		previousCursorX = startCursorX;
		initialCursorRelativeOffset = startCursorX - buttonRect.left;
		draggedButtonAbsoluteOffset = startCursorX - initialCursorRelativeOffset;
		placeholderWidth = buttonRect.width;
		placeholderHeight = buttonRect.height;
		
		isStartingDrag = true;
		currentDragPageId = appState.pages[buttonIndex].id;
		
		event.preventDefault();
	}

	function onCursorMove(event: MouseEvent | TouchEvent) {
		const currentX = getEventXOffset(event);
		if (isStartingDrag) {
			if (Math.abs(currentX - startCursorX) > 4) {
				isDragging = true;
				isStartingDrag = false;
			}
		}
		if (isDragging) {
			onDragUpdate(currentX);
		}
	}

	function onDragUpdate(currentX: number) {
		if (!pagesBarElement || !currentDragPageId) return;
		if (currentX === previousCursorX) return;

		draggedButtonAbsoluteOffset = currentX - initialCursorRelativeOffset;
		
		let index = appState.pages.findIndex(page => page.id === currentDragPageId);
		if (index === -1) return;

		const direction = currentX > previousCursorX ? 1 : -1;

		while (index + direction >= 0 && index + direction < appState.pages.length) {
			const nextPageId = appState.pages[index + direction].id;
			const nextPageBoundary = pageButtonBoundaries.get(nextPageId);
			if (!nextPageBoundary) continue;
			if (direction === 1 && currentX < nextPageBoundary.center) break;
			if (direction === -1 && currentX > nextPageBoundary.center) break;
			const ownBoundary = pageButtonBoundaries.get(currentDragPageId);
			if (!ownBoundary) continue;
			
			let leftId: Id;
			let rightId: Id;
			let leftBounds: Boundary;
			let rightBounds: Boundary;
			if (direction === 1) {
				leftId = currentDragPageId;
				rightId = nextPageId;
				leftBounds = ownBoundary;
				rightBounds = nextPageBoundary;
			} else {
				leftId = nextPageId;
				rightId = currentDragPageId;
				leftBounds = nextPageBoundary;
				rightBounds = ownBoundary;
			}
			rightBounds.left = leftBounds.left;
			rightBounds.right = rightBounds.left + rightBounds.width;
			rightBounds.center = rightBounds.left + rightBounds.width / 2;
			leftBounds.left = rightBounds.right;
			leftBounds.right = leftBounds.left + leftBounds.width;
			leftBounds.center = leftBounds.left + leftBounds.width / 2;

			pageButtonBoundaries.set(leftId, leftBounds);
			pageButtonBoundaries.set(rightId, rightBounds);
			appState.swapPages(currentDragPageId, nextPageId);
			index += direction;
		}

		previousCursorX = currentX;
	}

	function onDragEnd() {
		if (!isStartingDrag && !isDragging) return;
		isStartingDrag = false;
		isDragging = false;
		currentDragPageId = null;
		draggedButtonAbsoluteOffset = 0;
		placeholderWidth = 0;
		placeholderHeight = 0;
		initialCursorRelativeOffset = 0;
	}

	function handleMouseDown(event: MouseEvent) {
		if (event.button !== 0) return;
		attemptStartDrag(event);
	}

	function handleTouchStart(event: TouchEvent) {
		if (event.touches.length !== 1) return;
		attemptStartDrag(event);
	}

	function handleMouseMove(event: MouseEvent) {
		onCursorMove(event);
	}

	function handleTouchMove(event: TouchEvent) {
		onCursorMove(event);
	}

	function handleMouseUp(event: MouseEvent) {
		if (event.button !== 0) return;
		onDragEnd();
	}

	function handleTouchEnd(event: TouchEvent) {
		if (event.touches.length > 0) return;
		onDragEnd();
	}
</script>

<svelte:window
	onmousemove={isStartingDrag || isDragging ? handleMouseMove : undefined}
	onmouseup={isStartingDrag || isDragging ? handleMouseUp : undefined}
	on:touchmove|nonpassive={isStartingDrag || isDragging ? handleTouchMove : undefined}
	ontouchend={isStartingDrag || isDragging ? handleTouchEnd : undefined}
/>

<div
	class="pages-bar scrollbar-hidden"
	bind:this={pagesBarElement}
	onmousedown={!isStartingDrag && !isDragging ? handleMouseDown : undefined}
	ontouchstart={!isStartingDrag && !isDragging ? handleTouchStart : undefined}
>
	{#if browser}
		{#each appState.pages as page (page.id)}
			{@const isDragged = isDragging && page.id === currentDragPageId}
			{#if isDragged}
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
				activePageId={appState.currentPage?.id}
				isDraggedButton={isDragged}
				absoluteX={isDragged ? draggedButtonAbsoluteOffset : 0}
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
		border-top: 1px solid var(--pages-bar-border-color);
		padding-right: 8px;
		user-select: none;
	}

	.page-button-placeholder {
		flex-shrink: 0;
		background-color: transparent;
		border: 2px dashed var(--drop-target-border-color);
		border-radius: var(--rounded-border-radius);
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
