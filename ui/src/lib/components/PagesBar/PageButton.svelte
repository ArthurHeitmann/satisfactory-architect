<script lang="ts">
	import type { GraphPage } from "$lib/datamodel/GraphPage.svelte";
	import type { Id } from "$lib/datamodel/IdGen.svelte";
	import type { EventStream } from "$lib/EventStream.svelte";
	import { getContext } from "svelte";
	import SfIconView from "../SFIconView.svelte";
	import { getColorFromSeed, showConfirmationPrompt } from "$lib/utilties";
    import type { AppState } from "$lib/datamodel/AppState.svelte";

	interface Props {
		page: GraphPage;
		activePageId: Id|undefined;
		canBeRemoved: boolean;
		onSelect: () => void;
		onRemove: () => void;
		isDraggedButton?: boolean;
		absoluteX?: number;
	}

	const {
		page,
		activePageId,
		canBeRemoved,
		onSelect,
		onRemove,
		isDraggedButton = false,
		absoluteX = 0,
		...listeners
	}: Props = $props();
	const eventStream = getContext<EventStream>("overlay-layer-event-stream");
	const appState = getContext<AppState>("app-state");

	const commandQueue = appState.serverConnection.dispatchCommandQueue;
	commandQueue.watchPageChange(() => page);
	commandQueue.watchPageView(() => page);

	const serverConnection = appState.serverConnection;
	const MAX_INDICATORS = 5;

	// Get other users (excluding self) that are on this page, limited to MAX_INDICATORS
	const usersOnPage = $derived(
		serverConnection.otherClients
			.filter(client => client.currentPageId === page.id && client.userId !== serverConnection.ownUserId)
			.slice(0, MAX_INDICATORS)
	);

	let isRenaming = $state(false);
	let button: HTMLElement | null = $state(null);
	let nameElement: HTMLElement | null = $state(null);
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
					label: "Duplicate",
					icon: "copy",
					onClick: () => appState.duplicatePage(page.id)
				},
				{
					label: "Change Icon",
					icon: "image-edit",
					onClick: () => {
						eventStream.emit({
							type: "showIconPicker",
							onSelect: (iconName: string) => {
								page.icon = iconName;
							},
							currentIcon: page.icon,
							x: Math.max(buttonRect.left, 10),
							y: buttonRect.top - 10,
						});
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
	class:dragging={isDraggedButton}
	style:position={isDraggedButton ? "absolute" : "relative"}
	style:left={isDraggedButton ? `${absoluteX}px` : "auto"}
	onclick={onSelect}
	oncontextmenu={showContextMenu}
	bind:this={button}
	{...listeners}
>
	{#if usersOnPage.length > 0}
		<div class="user-indicators">
			{#each usersOnPage as user, index}
				<div
					class="user-dot"
					style:background-color={getColorFromSeed(user.userId)}
					style:right="{index * 13}px"
				></div>
			{/each}
		</div>
	{/if}
	<SfIconView icon={page.icon} size={20} quality="min" />
	{#if isRenaming}
		<span
			class="name editing"
			onblur={onBlur}
			onkeydown={onKeyDown}
			oninput={onInput}
			contenteditable="plaintext-only"
			bind:textContent={page.name}
			bind:this={nameElement}
		></span>
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

		&.dragging {
			z-index: 10;
			opacity: 0.8;
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		}
	}

	.user-indicators {
		position: absolute;
		top: 2px;
		right: 2px;
		height: 0;
		pointer-events: none;
	}

	.user-dot {
		position: absolute;
		top: 0;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		filter: drop-shadow(0 0 2px var(--background));
	}

	.name {
		white-space: nowrap;

		&.editing {
			cursor: text;
		}
	}
</style>
