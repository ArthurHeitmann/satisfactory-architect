<script lang="ts">
	import { ServerConnectionState } from "$lib/sync/ServerConnection.svelte";
	import type { ShowConnectionOverlayEvent, EventStream } from "$lib/EventStream.svelte";
	import { getContext, onMount, untrack } from "svelte";
	import type { AppState } from "$lib/datamodel/AppState.svelte";
	import { LocalStorageState } from "$lib/localStorageState.svelte";
	import { assertUnreachable, copyText } from "$lib/utilties";
	import { fade } from "svelte/transition";
	import { globals } from "$lib/datamodel/globals.svelte";
	import PresetSvg from "$lib/components/icons/PresetSvg.svelte";

	interface Props {
		event: ShowConnectionOverlayEvent;
		dismissEventStream: EventStream;
		onclose: () => void;
	}
	const { event, onclose }: Props = $props();

	const appState = getContext<AppState>("app-state");
	const serverConnection = appState.serverConnection;

	// Local UI state (only for things not driven by server state)
	let activeTab: "join" | "create" = $state("join");
	let showServerSettings = $state(false);
	let roomToDelete: string | null = $state(null);

	// Recent rooms (stored in localStorage)
	interface RecentRoom {
		roomId: string;
		serverUrl: string;
		name?: string;
		lastJoined: number;
	}

	// Persistent state via localStorage stores
	const lastServerUrlStore = new LocalStorageState("lastServerUrl", serverConnection.serverUrl);
	const recentRoomsStore = new LocalStorageState<RecentRoom[]>("recentRooms", []);
	const recentRoomsSorted = $derived([...recentRoomsStore.value].sort((a, b) => b.lastJoined - a.lastJoined));

	// Form state
	let roomIdInput = $state("");
	let newRoomName = $state("");
	let serverUrlInput = $state(lastServerUrlStore.value);

	function resetTempState() {
		roomToDelete = null;
	}

	// Save recent rooms to localStorage (only called on successful join)
	function saveRecentRoom(roomId: string, serverUrl: string, name?: string) {
		const rooms = [...recentRoomsStore.value];
		const existing = rooms.findIndex(f => f.roomId === roomId && f.serverUrl === serverUrl);
		if (existing >= 0) {
			rooms[existing].lastJoined = Date.now();
			if (name) rooms[existing].name = name;
		} else {
			rooms.unshift({ roomId, serverUrl, name, lastJoined: Date.now() });
		}
		recentRoomsStore.value = rooms;
	}

	function deleteRecentRoom(room: RecentRoom) {
		const rooms = [...recentRoomsStore.value];
		const index = rooms.findIndex(r => r.roomId === room.roomId && r.serverUrl === room.serverUrl);
		if (index >= 0) {
			rooms.splice(index, 1);
			recentRoomsStore.value = rooms;
		}
		roomToDelete = null;
	}

	function handleDeleteClick(room: RecentRoom, event: MouseEvent) {
		event.stopPropagation();
		if (roomToDelete === room.roomId) {
			deleteRecentRoom(room);
			roomToDelete = null;
		} else {
			roomToDelete = room.roomId;
		}
	}

	// update current room name in local storage
	$effect(() => {
		if (serverConnection.state !== ServerConnectionState.InRoom) {
			return;
		}
		const name = appState.name;
		const rooms = untrack(() => [...recentRoomsStore.value]);
		const existing = rooms.findIndex(f => f.roomId === serverConnection.roomId && f.serverUrl === serverConnection.serverUrl);
		if (existing >= 0) {
			rooms[existing].name = name;
			recentRoomsStore.value = rooms;
		}
	});

	function waitForConnected(): Promise<boolean> {
		function isConnected(state: ServerConnectionState) {
			return state !== ServerConnectionState.Disconnected && state !== ServerConnectionState.Connecting;
		}
		return new Promise((resolve) => {
			if (isConnected(serverConnection.state)) {
				resolve(true);
				return;
			}
			const unwatch = $effect.root(() => {
				$effect(() => {
					if (isConnected(serverConnection.state)) {
						unwatch();
						resolve(true);
					} else if (serverConnection.state === ServerConnectionState.Disconnected) {
						unwatch();
						resolve(false);
					}
				});
			});
		});
	}

	// View is primarily driven by server state
	type CurrentView = "choose-room" | "current-session" | "loading" | "joining" | "connection-error" | "server-settings";
	const currentView: CurrentView = $derived.by(() => {
		switch (serverConnection.state) {
			case ServerConnectionState.Disconnected:
				if (showServerSettings) {
					return "server-settings";
				} else if (serverConnection.lastError) {
					return "connection-error";
				} else {
					return "server-settings";
				}
			case ServerConnectionState.Connecting:
				return "loading";
			case ServerConnectionState.Connected:
				if (showServerSettings) {
					return "server-settings";
				} else {
					return "choose-room";
				}
			case ServerConnectionState.JoiningRoom:
			case ServerConnectionState.UploadingState:
				return "joining";
			case ServerConnectionState.InRoom:
				return "current-session";
			default:
				assertUnreachable(serverConnection.state);
		}
	});

	async function joinRoom(roomId: string, serverUrl?: string) {
		resetTempState();
		if (serverUrl) {
			serverConnection.setServerUrl(serverUrl);
		}
		await waitForConnected();
		if (serverConnection.state === ServerConnectionState.Connected) {
			await serverConnection.joinRoom(roomId);
		}
		else {
			// TODO: handle error
		}
	}

	// Actions
	function handleJoinRoom() {
		let roomId: string;
		let customServerUrl: string | undefined = undefined;
		const roomIdStr = roomIdInput.trim();
		// if (roomIdStr.startsWith("ws://") || roomIdStr.startsWith("wss://")) {
		// 	roomId = roomIdStr.split("/").pop() || "";
		// 	if (!roomId) {
		// 		// TODO
		// 		return;
		// 	}
		// 	customServerUrl = roomIdStr.substring(0, roomIdStr.length - roomId.length - 1);
		// }
		// else {
			roomId = roomIdStr.trim();
		// }
		
		joinRoom(roomId, customServerUrl);
	}

	function handleJoinRecentRoom(room: RecentRoom) {
		joinRoom(room.roomId, room.serverUrl);
	}

	async function handleCreateRoom() {
		if (serverConnection.state === ServerConnectionState.Disconnected) {
			serverConnection.connect();
			if (!await waitForConnected()) return; // TODO
		}
		
		if (serverConnection.state === ServerConnectionState.Connected) {
			if (newRoomName) {
				appState.name = newRoomName;
			}
			await serverConnection.createRoom(appState.toJSON());
		}
	}

	async function handleLeaveRoom() {
		serverConnection.intentionalDisconnect();
		activeTab = "join";
		// await waitForDisconnected();
		serverConnection.connect();
	}

	function handleTryAgain() {
		serverConnection.connect();
	}

	function handleCancelReconnect() {
		serverConnection.intentionalDisconnect();
	}

	function handleServerSettingsSave() {
		lastServerUrlStore.value = serverUrlInput;
		serverConnection.setServerUrl(serverUrlInput);
		showServerSettings = false;
	}

	function handleCopyRoomId() {
		if (serverConnection.roomId) {
			copyText(serverConnection.roomId);
		}
	}

	function openServerSettings() {
		serverUrlInput = serverConnection.serverUrl || lastServerUrlStore.value;
		showServerSettings = true;
		resetTempState();
	}

	function closeServerSettings() {
		if (serverConnection.state === ServerConnectionState.Disconnected) {
			onclose();
		}
		else {
			showServerSettings = false;
		}
	}

	// Initialize - load server URL from storage and auto-connect
	onMount(() => {
		const savedUrl = lastServerUrlStore.value;
		if (serverConnection.state === ServerConnectionState.Disconnected) {
			if (savedUrl && serverConnection.serverUrl !== savedUrl) {
				serverConnection.setServerUrl(savedUrl);
			} else if (serverConnection.serverUrl) {
				serverConnection.connect();
			}
		}
	});

	// Save room to recent only when successfully joined
	$effect(() => {
		if (serverConnection.state === ServerConnectionState.InRoom && serverConnection.roomId) {
			untrack(() => {
				saveRecentRoom(serverConnection.roomId!, serverConnection.serverUrl, appState.name);
			});
		}
	});

	const isInRoomSelection = $derived(currentView === "choose-room" || currentView === "joining" || currentView === "loading");
</script>

<div class="overlay-background" onclick={onclose}></div>
<div class="overlay-container">
	{#if isInRoomSelection}
		{@const isLoading = currentView === "joining" || currentView === "loading"}
		<!-- Join/Create Room Views -->
		<div class="overlay-header">
			<h2>New Collaboration Session</h2>
			<button class="close-btn" onclick={onclose}>✕</button>
		</div>

		{#if isLoading}
			<div class="blocking-overlay" transition:fade={{ duration: 50 }}>
				<div class="spinner"></div>
			</div>
		{/if}

		<div class="tabs">
			<button 
				class="tab" 
				class:active={activeTab === "join"}
				onclick={() => activeTab = "join"}
			>
				Join Room
			</button>
			<button 
				class="tab" 
				class:active={activeTab === "create"}
				onclick={() => activeTab = "create"}
			>
				Create New Room
			</button>
		</div>

		{#if activeTab === "join"}
			<!-- Join Room Tab -->
			<div class="overlay-content">
				<div class="field">
					<input 
						type="text" 
						bind:value={roomIdInput}
						placeholder="Paste Session ID..."
						disabled={isLoading}
					/>
				</div>
				<button 
					class="btn primary" 
					onclick={handleJoinRoom}
					disabled={!roomIdInput.trim() || isLoading}
				>
					{#if currentView === "joining"}
						Joining...
					{:else}
						Join Session
					{/if}
				</button>
				<p class="warning-text">
					Warning: Joining a room will overwrite any unsaved local changes.
					<br>
					Old inactive rooms might be deleted by the server after some time.
				</p>
				{#if serverConnection.lastError}
					<p class="error-text">{serverConnection.lastError}</p>
				{/if}

				{#if recentRoomsSorted.length > 0}
					<div class="divider"></div>
					<div class="recent-rooms">
						<div class="recent-header">
							<h3>Recent Sessions</h3>
						</div>
						<div class="room-list scrollbar-thin">
							{#each recentRoomsSorted as room}
								{@const isDeleting = roomToDelete === room.roomId}
								<div class="room-item-container">
									<button 
										class="room-item"
										onclick={() => handleJoinRecentRoom(room)}
										disabled={isLoading}
									>
										<span class="room-name">{room.name || "Unnamed Room"}</span>
										<span class="room-id">{room.roomId}</span>
									</button>
									<button 
										class="delete-btn"
										class:confirm={isDeleting}
										onclick={(e) => handleDeleteClick(room, e)}
										disabled={isLoading}
										title={isDeleting ? "Confirm delete" : "Delete"}
									>
									<PresetSvg name={isDeleting ? "check" : "delete"} size={14} color="currentColor" />
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<!-- Create Room Tab -->
			<div class="overlay-content">
				<div class="field">
					<label for="new-room-name">Room Name (Optional)</label>
					<input 
						id="new-room-name"
						type="text" 
						bind:value={newRoomName}
						disabled={isLoading}
					/>
				</div>
				<button 
					class="btn primary" 
					onclick={handleCreateRoom}
					disabled={isLoading}
				>
					{#if isLoading}
						Creating...
					{:else}
						Create
					{/if}
				</button>
			</div>
		{/if}

		<div class="overlay-footer">
			<button class="link-btn" onclick={openServerSettings}>
				Advanced: Server Settings
			</button>
		</div>

	{:else if currentView === "current-session"}
		<!-- Current Session View -->
		<div class="overlay-header">
			<h2>Active Session</h2>
			<button class="close-btn" onclick={onclose}>✕</button>
		</div>

		<div class="overlay-content">
			<div class="field">
				<label for="room-name">Room Name</label>
				<input 
					id="room-name"
					type="text" 
					bind:value={appState.name}
					placeholder="Unnamed Room"
				/>
			</div>

			<div class="field">
				<label for="session-id">Shareable Session ID</label>
				<div class="copy-field">
					<input 
						id="session-id"
						type="text" 
						readonly
						value={serverConnection.roomId ?? ""}
					/>
					<button class="btn secondary" onclick={handleCopyRoomId}>
						Copy
					</button>
				</div>
			</div>

			<div class="checkbox-field">
				<label>
					<input 
						type="checkbox" 
						bind:checked={globals.showOtherCursors}
					/>
					Show users cursors
				</label>
			</div>

			<div class="divider"></div>

			<button class="btn danger" onclick={handleLeaveRoom}>
				Leave Session
			</button>
		</div>

	{:else if currentView === "connection-error"}
		<!-- Connection Error View -->
		<div class="overlay-header">
			<h2>Connection Issue</h2>
			<button class="close-btn" onclick={onclose}>✕</button>
		</div>

		<div class="overlay-content centered">
			<PresetSvg name="warning" size={50} color={"var(--warning-color)"} />
			<h3>Could not connect to server.</h3>
			<p class="subtitle">
				{serverConnection.lastError || "Please check your internet connection."}
			</p>
			<div class="button-stack">
				<button class="btn primary" onclick={handleTryAgain}>
					Try Again
				</button>
				<button class="btn secondary" onclick={openServerSettings}>
					Change Server Settings
				</button>
			</div>
		</div>

	{:else if currentView === "server-settings"}
		<!-- Server Settings View -->
		<div class="overlay-header">
			<h2>Server Settings</h2>
			<button class="close-btn" onclick={onclose}>✕</button>
		</div>

		<div class="overlay-content">
			<div class="field">
				<label for="server-url">Server URL</label>
				<input 
					id="server-url"
					type="text" 
					bind:value={serverUrlInput}
					placeholder="ws://..."
				/>
			</div>

			<div class="status-row">
				<span>Status:</span>
				<span class="status-text">
					{serverConnection.state === ServerConnectionState.Disconnected ? "Disconnected" : "Connected"}
				</span>
			</div>

			<div class="button-row">
				<button
					class="btn primary" onclick={handleServerSettingsSave}
					disabled={serverConnection.state !== ServerConnectionState.Disconnected && serverConnection.serverUrl === serverUrlInput}
				>
					Connect
				</button>
				<button class="btn secondary" onclick={closeServerSettings}>
					Cancel
				</button>
			</div>
		</div>
	{:else}
		{untrack(() => { throw new Error(`Unhandled view: ${currentView}`); })}
	{/if}
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
		width: 420px;
		max-width: 90vw;
		max-height: 80vh;
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

	.tabs {
		display: flex;
		border-bottom: 1px solid var(--popup-border-color);

		.tab {
			flex: 1;
			padding: 12px 16px;
			font-size: 0.9rem;
			font-weight: 500;
			color: var(--background-500);
			border-bottom: 2px solid transparent;
			transition: all 0.15s ease;

			&:hover {
				color: var(--text);
				background-color: var(--popup-button-hover-background-color);
			}

			&.active {
				color: var(--primary);
				border-bottom-color: var(--primary);
			}
		}
	}

	.overlay-content {
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		overflow-y: auto;

		&.centered {
			align-items: center;
			text-align: center;
			padding: 40px 20px;

			h3 {
				margin: 0;
				font-size: 1.1rem;
				font-weight: 600;
			}

			.subtitle {
				color: var(--background-500);
				margin: 0;
			}
		}
	}

	.overlay-footer {
		padding: 12px 20px;
		border-top: 1px solid var(--popup-border-color);
		display: flex;
		justify-content: center;
	}

	.blocking-overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-color: var(--blocking-overlay-background-color);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;

		label {
			font-size: 0.85rem;
			font-weight: 500;
			color: var(--background-600);
		}

		input[type="text"] {
			padding: 10px 12px;
			border-radius: var(--rounded-border-radius);
			border: 1px solid var(--popup-border-color);
			background-color: var(--background);
			font-size: 0.95rem;

			&:focus {
				border-color: var(--primary);
				outline: none;
			}

			&:disabled {
				opacity: 0.6;
				cursor: not-allowed;
			}

			&::placeholder {
				color: var(--background-400);
			}
		}
	}

	.checkbox-field {
		display: flex;
		align-items: center;

		label {
			display: flex;
			align-items: center;
			gap: 8px;
			font-size: 0.9rem;
			cursor: pointer;
			color: var(--text);
		}

		input[type="checkbox"] {
			width: 16px;
			height: 16px;
			cursor: pointer;
			accent-color: var(--primary);
		}
	}

	.copy-field {
		display: flex;
		gap: 8px;

		input {
			flex: 1;
		}

		.btn {
			flex-shrink: 0;
		}
	}

	.btn {
		padding: 10px 16px;
		border-radius: var(--rounded-border-radius);
		font-size: 0.95rem;
		font-weight: 500;
		transition: all 0.15s ease;

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

		&.secondary {
			background-color: var(--popup-button-background-color);

			&:hover:not(:disabled) {
				background-color: var(--popup-button-hover-background-color);
			}

			&:active:not(:disabled) {
				background-color: var(--popup-button-active-background-color);
			}
		}

		&.danger {
			background-color: var(--danger-color);
			color: var(--button-primary-text-color);

			&:hover:not(:disabled) {
				background-color: var(--danger-hover-color);
			}
		}
	}

	.link-btn {
		font-size: 0.85rem;
		color: var(--background-500);
		text-decoration: none;
		
		&:hover {
			color: var(--primary);
			text-decoration: underline;
		}
	}

	.divider {
		height: 1px;
		background-color: var(--popup-border-color);
		margin: 4px 0;
	}

	.warning-text {
		color: var(--warning-color);
		font-size: 0.85rem;
		margin: 0;
	}

	.error-text {
		color: var(--danger-color);
		font-size: 0.85rem;
		margin: 0;
	}

	.recent-rooms {
		.recent-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 8px;

			h3 {
				font-size: 0.9rem;
				font-weight: 600;
				margin: 0;
				color: var(--background-600);
			}
		}

		.room-list {
			display: flex;
			flex-direction: column;
			gap: 4px;
			max-height: 132px;
			overflow-y: auto;
		}

		.room-item-container {
			display: flex;
			gap: 4px;
			align-items: stretch;
		}

		.room-item {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			padding: 10px 12px;
			border-radius: var(--rounded-border-radius);
			text-align: left;
			transition: background-color 0.15s ease;
			flex: 1;
			min-width: 0;

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

			.room-name {
				font-weight: 500;
			}

			.room-id {
				font-size: 0.8rem;
				color: var(--background-500);
				font-family: monospace;
			}
		}

		.delete-btn {
			width: 28px;
			padding: 0;
			border-radius: var(--rounded-border-radius);
			color: var(--background-500);
			transition: all 0.15s ease;
			flex-shrink: 0;

			&:hover:not(:disabled) {
				background-color: var(--popup-button-hover-background-color);
				color: var(--danger-color);
			}

			&:active:not(:disabled) {
				background-color: var(--popup-button-active-background-color);
			}

			&:disabled {
				opacity: 0.5;
				cursor: not-allowed;
			}

			&.confirm {
				color: var(--success-color);

				&:hover:not(:disabled) {
					color: var(--success-color);
					filter: brightness(1.2);
				}
			}
		}
	}

	.status-row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.95rem;

		.status-text {
			font-weight: 500;
		}
	}

	.button-row {
		display: flex;
		gap: 8px;

		.btn {
			flex: 1;
		}
	}

	.button-stack {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
		max-width: 250px;
		margin-top: 8px;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid var(--popup-border-color);
		border-top-color: var(--primary);
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin-bottom: 16px;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
