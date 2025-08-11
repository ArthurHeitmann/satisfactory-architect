<script lang="ts">
    import type { GraphPage } from "$lib/datamodel/GraphPage.svelte";
    import type { Id } from "$lib/datamodel/IdGen";
    import type { EventStream } from "$lib/EventStream.svelte";
    import { getContext } from "svelte";
    import SfIconView from "../SFIconView.svelte";
    import { showConfirmationPrompt } from "$lib/utilties";

	interface Props {
		page: GraphPage;
		activePageId: Id;
		canBeRemoved: boolean;
		onSelect: () => void;
		onRemove: () => void;
	}

	const {
		page,
		activePageId,
		canBeRemoved,
		onSelect,
		onRemove,
		...listeners
	}: Props = $props();
	const eventStream = getContext("overlay-layer-event-stream") as EventStream;

	let isRenaming = $state(false);
	// svelte-ignore non_reactive_update
	let button: HTMLElement | null = null;
	// svelte-ignore non_reactive_update
	let nameElement: HTMLElement | null = null;
	let lastName = "";

	function onDoubleClick() {
		if (isRenaming)
			return;
		isRenaming = true;
		lastName = page.name;
		setTimeout(() => {
			if (nameElement) {
				nameElement.focus();
				const range = document.createRange();
				range.selectNodeContents(nameElement);
				const selection = window.getSelection();
				if (selection) {
					selection.removeAllRanges();
					selection.addRange(range);
				}
			}
		}, 0);
	}

	function onBlur() {
		isRenaming = false;
		if (page.name.trim() === "") {
			page.name = lastName;
		}
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === "Enter" || event.key === "Escape") {
			onBlur();
		}
	}

	function onInput() {
		if (/[\t\r\n]/.test(page.name)) {
			page.name = page.name.replace(/[\t\r\n]/g, "");
		}
	}

	function showContextMenu(event: MouseEvent) {
		event.preventDefault();
		const buttonRect = button!.getBoundingClientRect();
		eventStream.emit({
			type: "showContextMenu",
			x: buttonRect.left,
			y: buttonRect.top - 4,
			items: [
				{
					label: "Remove",
					icon: "delete",
					disabled: !canBeRemoved,
					onClick: async () => {
						const answer = await showConfirmationPrompt(eventStream, {
							message: `Are you sure you want to remove the page "${page.name}"?`,
							confirmLabel: "Remove",
							cancelLabel: "Cancel",
						});
						if (answer === true) {
							onRemove();
						}
					}
				},
				{
					label: "Rename",
					icon: "edit",
					onClick: onDoubleClick
				},
			]
		});
	}
</script>

<button
	class="page-button"
	class:selected={page.id === activePageId}
	onclick={onSelect}
	oncontextmenu={showContextMenu}
	bind:this={button}
	{...listeners}
>
	<SfIconView icon={page.icon} size={20} quality="min" />
	{#if isRenaming}
		<span class="name editing" onblur={onBlur} onkeydown={onKeyDown} oninput={onInput} contenteditable="plaintext-only" bind:textContent={page.name} bind:this={nameElement}></span>
	{:else}
		<span class="name" ondblclick={onDoubleClick}>{page.name}</span>
	{/if}
</button>

<style lang="scss">
	.page-button {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.875rem;
		padding: 8px 8px;
		transition: background-color 0.15s ease;

		&:hover {
			background-color: var(--pages-bar-button-hover-background-color);
		}

		&:active {
			background-color: var(--pages-bar-button-active-background-color);
		}

		&.selected {
			background-color: var(--pages-bar-button-selected-background-color);
			color: var(--pages-bar-button-selected-text-color);
		}
	}

	.name {
		&.editing {
			cursor: text;
		}
	}
</style>
