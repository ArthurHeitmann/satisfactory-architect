<script lang="ts">
	import type { ShowCorruptSaveOverlayEvent } from "$lib/EventStream.svelte";
	import { fade } from "svelte/transition";
	import PresetSvg from "../icons/PresetSvg.svelte";
	import { saveFileToDisk } from "$lib/utilties";

	interface Props {
		event: ShowCorruptSaveOverlayEvent;
		onclose: () => void;
	}
	const { event, onclose }: Props = $props();

	let repairError = $state<string | null>(null);

	function downloadCorruptedSave() {
		if (!event.parsedJson) {
			return;
		}
		const content = JSON.stringify(event.parsedJson);
		saveFileToDisk("corrupted-save.json", content);
	}

	function handleStartNew() {
		event.onStartNew();
		onclose();
	}

	async function handleRepair() {
		repairError = null;
		if (!event.onRepair) {
			return;
		}
		const result = await event.onRepair();
		if (result) {
			onclose();
			return;
		}
		repairError = "Repair failed. Please download the corrupted save and start a new save.";
	}
</script>

<div class="overlay-background"></div>
<div class="overlay-container" transition:fade={{ duration: 100 }}>
	<div class="overlay-header">
		<h2>Save Data Error</h2>
	</div>

	<div class="overlay-content centered">
		<PresetSvg name="warning" size={50} color={"var(--danger-color)"} />
		<h3>Failed to load saved data</h3>

		<pre class="error-details scrollbar-thin">{event.errorMessage}</pre>

		<div class="button-group">
			{#if event.parsedJson}
				<button class="btn secondary" onclick={downloadCorruptedSave}>
					Download corrupted save
				</button>
			{/if}

			{#if event.onRepair}
				<button class="btn secondary" onclick={handleRepair}>
					Try repair
				</button>
			{/if}

			<button class="btn primary" onclick={handleStartNew}>
				Start new save
			</button>
		</div>

		{#if repairError}
			<p class="repair-error">{repairError}</p>
		{/if}
	</div>
</div>

<style lang="scss">
	.overlay-background {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-color: var(--popup-block-area-background-color);
		z-index: 1000;
	}

	.overlay-container {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background-color: var(--popup-background-color);
		border: 1px solid var(--popup-border-color);
		border-radius: var(--rounded-border-radius-big);
		box-shadow: var(--popup-shadow);
		width: 450px;
		max-width: 90vw;
		display: flex;
		flex-direction: column;
		z-index: 1001;
		overflow: hidden;
	}

	.overlay-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 16px 20px;
		border-bottom: 1px solid var(--popup-border-color);

		h2 {
			font-size: 1.25rem;
			font-weight: 600;
			margin: 0;
		}
	}

	.overlay-content {
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;

		&.centered {
			align-items: center;
			text-align: center;
			padding: 32px 20px;

			h3 {
				margin: 0;
				font-size: 1.1rem;
				font-weight: 600;
			}
		}
	}

	.error-details {
		width: 100%;
		max-height: 150px;
		overflow: auto;
		background-color: var(--background-100);
		border: 1px solid var(--popup-border-color);
		border-radius: var(--rounded-border-radius);
		padding: 12px;
		font-size: 0.8rem;
		font-family: monospace;
		text-align: left;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--danger-color);
	}

	.repair-error {
		color: var(--danger-color);
		margin: 0;
		font-size: 0.9rem;
		text-align: center;
	}

	.button-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
		margin-top: 4px;
	}

	.btn {
		padding: 10px 24px;
		border-radius: var(--rounded-border-radius);
		font-size: 0.95rem;
		font-weight: 500;
		transition: all 0.15s ease;

		&.primary {
			background-color: var(--primary);
			color: var(--button-primary-text-color);

			&:hover {
				filter: brightness(1.1);
			}

			&:active {
				filter: brightness(0.95);
			}
		}

		&.secondary {
			background-color: var(--popup-button-background-color);

			&:hover {
				background-color: var(--popup-button-hover-background-color);
			}

			&:active {
				background-color: var(--popup-button-active-background-color);
			}
		}
	}
</style>
