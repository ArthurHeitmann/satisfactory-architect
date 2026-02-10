<script lang="ts">
	import type { AppState } from "$lib/datamodel/AppState.svelte";
	import type { EventStream } from "$lib/EventStream.svelte";
	import { StorageKeys } from "$lib/datamodel/constants";
	import { trackStateChanges } from "$lib/datamodel/globals.svelte";
	import { writeToLocalStorage } from "$lib/localStorageState.svelte";
	import { Debouncer } from "$lib/utilties";
	import { setContext } from "svelte";
	import PageView from "$lib/components/PageView/PageView.svelte";
	import PagesBar from "$lib/components/PagesBar/PagesBar.svelte";

	interface Props {
		app: AppState;
		eventStream: EventStream;
	}
	const { app, eventStream }: Props = $props();

	setContext("app-state", app);

	const serverConnection = app.serverConnection;
	const commandQueue = serverConnection.dispatchCommandQueue;
	commandQueue.watchPageList(() => Array.from(app.pages.values()));
	commandQueue.watchPageOrder(() => Array.from(app.pages.values()));
	commandQueue.watchStateVar("currentPageId", () => app.currentPage?.id ?? null);
	commandQueue.watchStateVar("name", () => app.name);

	serverConnection.onUserMessage = (message) => {
		eventStream.emit({
			type: "confirmationPrompt",
			message: message,
			confirmLabel: "OK",
			hideCancelButton: true,
			onAnswer: () => {},
		});
	};

	serverConnection.onUnexpectedDisconnect = (error) => {
		eventStream.emit({
			type: "showReconnectOverlay",
			errorMessage: error,
		});
	};

	serverConnection.watchHeartbeatDataChanges();

	const debouncedSave = new Debouncer((json: any) => {
		if (trackStateChanges()) {
			writeToLocalStorage(StorageKeys.appState, json);
		}
	}, 1500);

	$effect(() => {
		const json = app.toJSON();
		debouncedSave.call(json);
	});

	function onBeforeUnload() {
		const json = app.toJSON({ forceToJson: true });
		app.saveToLocalStorage(json);
	}
 </script>

<svelte:window onbeforeunload={onBeforeUnload} />

<div class="home">
	<div class="page-view">
		{#if app.currentPage}
			{#key app.currentPage?.id}
				<PageView page={app.currentPage} />
			{/key}
		{:else}
			<div class="no-page">
				No page found. Please create a new page.
			</div>
		{/if}
	</div>
	<PagesBar appState={app} />
</div>

<style lang="scss">
	.home {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100dvh;
	}

	.page-view {
		flex: 1;
		display: flex;
		justify-content: center;
		align-items: center;
	}
</style>
