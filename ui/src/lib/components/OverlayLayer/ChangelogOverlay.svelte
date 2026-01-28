<script lang="ts">
	import type { ShowChangelogEvent, EventStream } from "$lib/EventStream.svelte";
	import { onDestroy, onMount } from "svelte";

	interface Props {
		event: ShowChangelogEvent;
		dismissEventStream: EventStream;
		onclose: () => void;
	}
	const {
		event,
		dismissEventStream,
		onclose,
	}: Props = $props();

	function onDismiss() {
		onclose();
	}

	onMount(() => {
		dismissEventStream.addListener(onDismiss);
	});

	onDestroy(() => {
		dismissEventStream.removeListener(onDismiss);
	});

	const versions = $derived(Object.keys(event.changelog)
		.map(Number)
		.sort((a, b) => b - a)); // Show newest first
</script>

<div class="background"></div>
<div class="changelog-overlay">
	<div class="title">What's New</div>
	<div class="content">
		{#each versions as version}
			<div class="version-section">
				<div class="version-header">
					<span class="version-number">Version {version}</span>
					{#if version > event.previousVersion}
						<span class="new-badge">new</span>
					{/if}
				</div>
				<ul class="change-list">
					{#each event.changelog[version] as change}
						<li class="change-item">{change}</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>
	<div class="buttons">
		<button class="confirm" onclick={onclose}>Close</button>
	</div>
</div>

<style lang="scss">
	.background {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-color: var(--popup-block-area-background-color);
		pointer-events: none;
	}

	.changelog-overlay {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background-color: var(--popup-background-color);
		border: 1px solid var(--popup-border-color);
		padding: 24px;
		border-radius: var(--rounded-border-radius-big);
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
		width: max-content;
		min-width: min(400px, 95vw);
		max-width: min(95vw, 600px);
		max-height: 80vh;
		display: flex;
		flex-direction: column;
	}

	.title {
		font-size: 1.5rem;
		font-weight: bold;
		margin-bottom: 16px;
		text-align: center;
		color: var(--text);
	}

	.content {
		flex: 1;
		overflow-y: auto;
		margin-bottom: 20px;
		padding-right: 8px;

		&::-webkit-scrollbar {
			width: 6px;
		}
		&::-webkit-scrollbar-thumb {
			background-color: var(--popup-border-color);
			border-radius: 3px;
		}
	}

	.version-section {
		margin-bottom: 20px;
		&:last-child {
			margin-bottom: 0;
		}
	}

	.version-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}

	.version-number {
		font-weight: bold;
		font-size: 1.1rem;
		color: var(--text);
	}

	.new-badge {
		background-color: var(--primary);
		color: var(--background);
		font-size: 0.75rem;
		padding: 2px 6px;
		border-radius: 4px;
		text-transform: uppercase;
		font-weight: bold;
	}

	.change-list {
		margin: 0;
		padding-left: 20px;
		list-style-type: disc;
	}

	.change-item {
		margin-bottom: 4px;
		color: var(--text-muted);
		line-height: 1.4;
	}

	.buttons {
		display: flex;
		justify-content: center;
	}

	button {
		background-color: var(--popup-button-background-color);
		color: var(--text);
		padding: 10px 30px;
		border: none;
		border-radius: 6px;
		font-weight: bold;
		cursor: pointer;
		transition: background-color 0.2s;

		&:hover {
			background-color: var(--popup-button-hover-background-color);
		}

		&:active {
			background-color: var(--popup-button-active-background-color);
		}
	}
</style>
