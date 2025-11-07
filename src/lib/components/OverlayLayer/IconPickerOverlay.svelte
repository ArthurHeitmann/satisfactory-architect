<script lang="ts">
	import type { ShowIconPickerEvent } from "$lib/EventStream.svelte";
	import SfIconView from "../SFIconView.svelte";
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
	import { fade } from "svelte/transition";
	import { onMount } from "svelte";

	interface Props {
		event: ShowIconPickerEvent;
		onclose: () => void;
	}

	const { event, onclose }: Props = $props();

	const allIcons = Object.keys(satisfactoryDatabase.icons);

	let searchQuery = $state("");

	const filteredIcons = $derived.by(() => {
		const query = searchQuery.trim().toLowerCase();
		if (query === "") {
			return allIcons;
		}
		return allIcons.filter(iconName => iconName.toLowerCase().includes(query));
	});

	function selectIcon(iconName: string) {
		event.onSelect(iconName);
		onclose();
	}

	function onBackgroundClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onclose();
		}
	}

	const popupWidth = 400;
	const popupMaxHeight = 300;
	const rightPadding = 10;
	const leftPos = Math.max(0, Math.min(event.x, window.innerWidth - popupWidth - rightPadding));
	const popupStyle = `left: ${leftPos}px; top: ${event.y - popupMaxHeight}px; width: ${popupWidth}px; max-height: ${popupMaxHeight}px;`;

	let iconListElement: HTMLDivElement;

	onMount(() => {
		const selectedButton = iconListElement?.querySelector('.icon-button.selected');
		if (selectedButton) {
			selectedButton.scrollIntoView({ behavior: "instant", block: "center" });
		}
	});
</script>

<div class="overlay-background" onclick={onBackgroundClick}>
	<div class="icon-picker-popup" style={popupStyle}>
		<div class="search-bar">
			<input
				type="text"
				placeholder="Search icons..."
				bind:value={searchQuery}
			/>
		</div>
		<div class="icon-list" bind:this={iconListElement}>
			{#each filteredIcons as iconName}
				<button
					class="icon-button"
					class:selected={iconName === event.currentIcon}
					onclick={() => selectIcon(iconName)}
					title={iconName}
				>
					<SfIconView icon={iconName} size={32} quality="min" />
				</button>
			{/each}
		</div>
	</div>
</div>

<style lang="scss">
	.overlay-background {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		z-index: 1000;
	}

	.icon-picker-popup {
		position: absolute;
		background: var(--icon-picker-background-color);
		border: 1px solid var(--icon-picker-border-color);
		border-radius: 8px;
		display: flex;
		flex-direction: column;
	}

	.search-bar {
		width: 100%;
		line-height: 40px;
		padding: 0 10px;

		input {
			width: 100%;
		}
	}

	.icon-list {
		display: grid;
		grid-template-columns: repeat(7, 48px);
		gap: 4px;
		padding: 8px;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--recipe-selector-scrollbar-color) transparent;
		&::-webkit-scrollbar {
			width: 8px;
			background-color: transparent;
		}
	}

	.icon-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		border: 1px solid var(--icon-picker-button-border-color);
		border-radius: 4px;
		background: var(--icon-picker-button-color);

		&:hover {
			background: var(--icon-picker-button-hover-color);
		}

		&.selected {
			background: var(--icon-picker-button-active-color);
			border-color: var(--primary);
			box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 30%, transparent);
		}

		&:active {
			transform: scale(0.95);
		}
	}
</style>
