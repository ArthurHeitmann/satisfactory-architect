<script lang="ts">
	import { ServerConnectionState } from "$lib/sync/ServerConnection.svelte";
	import type { ShowConnectionOverlayEvent, EventStream } from "$lib/EventStream.svelte";
	import { getContext, onMount } from "svelte";
	import type { AppState } from "$lib/datamodel/AppState.svelte";

	interface Props {
		event: ShowConnectionOverlayEvent;
		dismissEventStream: EventStream;
		onclose: () => void;
	}
	const {
		onclose,
	}: Props = $props();

	const appState = getContext("app-state") as AppState;
	const serverConnection = appState.serverConnection;

	let serverUrl = $state(serverConnection.serverUrl);
	$effect(() => {
		serverUrl = serverConnection.serverUrl;
	});
	let roomId = $state("");
	let uploadData = $state(false);

	function onUrlChange() {
		serverConnection.setServerUrl(serverUrl);
	}

	function onConnect() {
		serverConnection.connect();
	}

	function onDisconnect() {
		serverConnection.disconnect();
	}

	function onJoinRoom() {
		serverConnection.joinRoom(roomId, uploadData ? appState.toJSON() : undefined);
	}

	function onCreateRoom() {
		serverConnection.createRoom(appState.toJSON());
	}

	onMount(() => {
		if (serverConnection.state === ServerConnectionState.Disconnected && serverUrl) {
			serverConnection.connect();
		}
	});

	$effect(() => {
		if (serverConnection.roomId) {
			roomId = serverConnection.roomId;
		}
	});

	const stateLabel = $derived.by(() => {
		switch (serverConnection.state) {
			case ServerConnectionState.Disconnected: return "Disconnected";
			case ServerConnectionState.Connecting: return "Connecting...";
			case ServerConnectionState.Connected: return "Connected (No Room)";
			case ServerConnectionState.JoiningRoom: return "Joining Room...";
			case ServerConnectionState.UploadingState: return "Uploading State...";
			case ServerConnectionState.InRoom: return "In Room";
			default: return "Unknown";
		}
	});

	const canConnect = $derived(serverConnection.state === ServerConnectionState.Disconnected);
	const canDisconnect = $derived(serverConnection.state !== ServerConnectionState.Disconnected);
	const canJoinOrCreate = $derived(serverConnection.state === ServerConnectionState.Connected);
</script>

<div class="background" onclick={onclose}></div>
<div class="prompt">
	<h2>Server Connection</h2>
	
	<div class="field">
		<label for="server-url">Server URL</label>
		<input 
			id="server-url" 
			type="text" 
			bind:value={serverUrl} 
			onchange={onUrlChange}
			placeholder="ws://localhost:8080"
		/>
	</div>

	<div class="status">
		Status: <span class="state-label">{stateLabel}</span>
		{#if serverConnection.lastError}
			<div class="error">{serverConnection.lastError}</div>
		{/if}
	</div>

	<div class="actions">
		{#if canConnect}
			<button onclick={onConnect}>Connect</button>
		{/if}
		{#if canDisconnect}
			<button onclick={onDisconnect}>Disconnect</button>
		{/if}
	</div>

	<hr />

	<div class="field">
		<label for="room-id">Room ID</label>
		<input 
			id="room-id" 
			type="text" 
			bind:value={roomId} 
			disabled={!canJoinOrCreate}
			placeholder="Enter room ID"
		/>
	</div>

	<div class="field checkbox">
		<input 
			id="upload-data" 
			type="checkbox" 
			bind:checked={uploadData} 
			disabled={!canJoinOrCreate}
		/>
		<label for="upload-data">Upload current state</label>
	</div>

	<div class="actions">
		<button 
			onclick={onJoinRoom} 
			disabled={!canJoinOrCreate || !roomId}
		>
			Join Room
		</button>
		<button 
			onclick={onCreateRoom} 
			disabled={!canJoinOrCreate}
		>
			Create New Room
		</button>
	</div>

	<div class="footer">
		<button class="close-button" onclick={onclose}>Close</button>
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
	}

	.prompt {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background-color: var(--popup-background-color);
		border: 1px solid var(--popup-border-color);
		padding: 24px;
		border-radius: 8px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
		width: 400px;
		display: flex;
		flex-direction: column;
		gap: 16px;

		h2 {
			margin: 0;
			font-size: 1.5rem;
		}

		hr {
			width: 100%;
			border: 0;
			border-top: 1px solid var(--popup-border-color);
			margin: 8px 0;
		}
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;

		label {
			font-size: 0.9rem;
			font-weight: bold;
		}

		input[type="text"] {
			padding: 8px;
			border-radius: 4px;
			border: 1px solid var(--popup-border-color);
			background-color: var(--background);
			color: var(--text);
		}

		&.checkbox {
			flex-direction: row;
			align-items: center;
			gap: 8px;

			label {
				font-weight: normal;
			}
		}
	}

	.status {
		font-size: 0.9rem;
		.state-label {
			font-weight: bold;
			color: var(--primary);
		}
		.error {
			color: var(--underflow-color);
			margin-top: 4px;
			font-size: 0.8rem;
		}
	}

	.actions {
		display: flex;
		gap: 8px;

		button {
			flex: 1;
			padding: 8px;
			border-radius: 4px;
			background-color: var(--popup-button-background-color);
			color: var(--text);
			cursor: pointer;

			&:hover:not(:disabled) {
				background-color: var(--popup-button-hover-background-color);
			}

			&:active:not(:disabled) {
				background-color: var(--popup-button-active-background-color);
			}

			&:disabled {
				opacity: 0.5;
				cursor: not-allowed;
			}
		}
	}

	.footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 8px;

		.close-button {
			padding: 8px 16px;
			border-radius: 4px;
			background-color: var(--background-200);
			color: var(--text);
		}
	}
</style>
