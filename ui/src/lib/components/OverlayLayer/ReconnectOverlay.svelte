<script lang="ts">
	import { ServerConnectionState } from "$lib/sync/ServerConnection.svelte";
	import type { ShowReconnectOverlayEvent } from "$lib/EventStream.svelte";
	import { getContext } from "svelte";
	import type { AppState } from "$lib/datamodel/AppState.svelte";
	import { fade } from "svelte/transition";
    import PresetSvg from "../icons/PresetSvg.svelte";

	interface Props {
		event: ShowReconnectOverlayEvent;
		onclose: () => void;
	}
	const { event, onclose }: Props = $props();

	const appState = getContext<AppState>("app-state");
	const serverConnection = appState.serverConnection;

	let hasAttemptedReconnect = $state(false);

	type OverlayState = "idle" | "connecting" | "success" | "error";

	const overlayState: OverlayState = $derived.by(() => {
		const connState = serverConnection.state;
		switch (connState) {
			case ServerConnectionState.InRoom:
				return "success";
			case ServerConnectionState.Connecting:
			case ServerConnectionState.JoiningRoom:
			case ServerConnectionState.UploadingState:
				return "connecting";
			case ServerConnectionState.Connected:
				// Connected but not in room — room join must have failed
				return hasAttemptedReconnect ? "error" : "idle";
			case ServerConnectionState.Disconnected:
				return hasAttemptedReconnect ? "error" : "idle";
		}
	});

	const errorMessage: string | null = $derived.by(() => {
		if (overlayState === "error") {
			return serverConnection.lastError ?? "Connection failed. Please try again.";
		}
		if (overlayState === "idle") {
			return event.errorMessage;
		}
		return null;
	});

	$effect(() => {
		if (overlayState === "success") {
			setTimeout(() => {
				onclose();
			}, 500);
		}
	});

	function handleReconnect() {
		hasAttemptedReconnect = true;

		const started = serverConnection.reconnect();
		if (!started) {
			// Force error state by disconnecting if somehow still connected
			serverConnection.intentionalDisconnect();
		}
	}

	const wasHiddenOnMount = document.visibilityState === "hidden";

	function onVisibilityChange() {
		if (wasHiddenOnMount && document.visibilityState === "visible" && (overlayState === "idle" || overlayState === "error")) {
			handleReconnect();
		}
	}
</script>

<svelte:document onvisibilitychange={onVisibilityChange} />

<div class="overlay-background" onclick={onclose}></div>
<div class="overlay-container" transition:fade={{ duration: 100 }}>
	<div class="overlay-header">
		<h2>Connection Lost</h2>
		<button class="close-btn" onclick={onclose}>✕</button>
	</div>

	<div class="overlay-content centered">
		{#if overlayState === "idle" || overlayState === "error"}
			<PresetSvg name="warning" size={50} color={"var(--warning-color)"} />
			<h3>{overlayState === "idle" ? "Disconnected from server" : "Reconnection failed"}</h3>
			<p class="subtitle">
				{errorMessage ?? "The connection to the server was lost unexpectedly."}
			</p>
			<button class="btn primary" onclick={handleReconnect}>
				{overlayState === "idle" ? "Reconnect" : "Try Again"}
			</button>

		{:else if overlayState === "connecting"}
			<div class="spinner"></div>
			<h3>Reconnecting...</h3>
			<p class="subtitle">Attempting to rejoin the session.</p>

		{:else if overlayState === "success"}
			<PresetSvg name="check" size={50} color={"var(--success-color)"} />
			<h3>Reconnected!</h3>
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
		width: 380px;
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

		.close-btn {
			width: 28px;
			height: 28px;
			border-radius: var(--rounded-border-radius);
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 1rem;
			color: var(--background-500);

			&:hover {
				background-color: var(--popup-button-hover-background-color);
				color: var(--text);
			}
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

			.subtitle {
				color: var(--background-500);
				margin: 0;
				max-width: 300px;
			}
		}
	}

	.btn {
		padding: 10px 24px;
		border-radius: var(--rounded-border-radius);
		font-size: 0.95rem;
		font-weight: 500;
		transition: all 0.15s ease;
		margin-top: 4px;

		&:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}

		&.primary {
			background-color: var(--primary);
			color: var(--button-primary-text-color);

			&:hover:not(:disabled) {
				filter: brightness(1.1);
			}

			&:active:not(:disabled) {
				filter: brightness(0.95);
			}
		}
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid var(--popup-border-color);
		border-top-color: var(--primary);
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin-bottom: 4px;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
