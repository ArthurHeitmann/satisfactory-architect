<script lang="ts">
	import { browser } from "$app/environment";
	import OverlayLayer from "$lib/components/OverlayLayer/OverlayLayer.svelte";
	import PagesBar from "$lib/components/PagesBar/PagesBar.svelte";
	import PageView from "$lib/components/PageView/PageView.svelte";
	import { AppState } from "$lib/datamodel/AppState.svelte";
	import { changelog, latestAppVersion, StorageKeys } from "$lib/datamodel/constants";
	import { appVersion, darkTheme, globals } from "$lib/datamodel/globals.svelte";
	import { starterSaveJson } from "$lib/datamodel/starterSave";
	import { EventStream } from "$lib/EventStream.svelte";
	import { loadFormLocalStorage } from "$lib/localStorageState.svelte";
	import { onMount, setContext } from "svelte";

	function applyTheme(isDark: boolean) {
		if (isDark) {
			document.documentElement.classList.add("dark-theme");
			document.documentElement.classList.remove("light-theme");
		} else {
			document.documentElement.classList.add("light-theme");
			document.documentElement.classList.remove("dark-theme");
		}
	}
	
	onMount(() => {
		applyTheme(darkTheme.value);

		// Check for version update and show changelog
		if (appVersion.value < latestAppVersion) {
			eventStream.emit({
				type: "showChangelog",
				changelog: changelog,
				previousVersion: appVersion.value,
			});
			appVersion.value = latestAppVersion;
		}
	});

	$effect(() => {
		applyTheme(darkTheme.value);
	});

	const app = (() => {
		try {
			const savedJson = loadFormLocalStorage(StorageKeys.appState, null);
			if (savedJson !== null) {
				return AppState.fromJSON(savedJson);
			}
		} catch (e) {
			console.error("Failed to load app state from local storage:", e);
		}
		if (browser) {
			const starterSave = JSON.parse(starterSaveJson);
			return AppState.fromJSON(starterSave);
		} else {
			return AppState.newDefault();
		}
	})();

	const serverConnection = app.serverConnection;
	const commandQueue = serverConnection.dispatchCommandQueue;
	commandQueue.watchPageList(() => Array.from(app.pages.values()));
	commandQueue.watchPageOrder(() => Array.from(app.pages.values()));
	commandQueue.watchStateVar("currentPageId", () => app.currentPage?.id ?? null);
	commandQueue.watchStateVar("name", () => app.name);

	const eventStream = new EventStream();
	setContext("overlay-layer-event-stream", eventStream);

	serverConnection.onUserMessage = (message) => {
		eventStream.emit({
			type: "confirmationPrompt",
			message: message,
			confirmLabel: "OK",
			hideCancelButton: true,
			onAnswer: () => {},
		});
	};

	// Handle unexpected disconnects by showing a reconnection prompt
	serverConnection.onUnexpectedDisconnect = (error) => {
		const message = error ?? "The connection to the server was lost unexpectedly.";
		eventStream.emit({
			type: "confirmationPrompt",
			message: message + "\n\nWould you like to reconnect?",
			confirmLabel: "Reconnect",
			cancelLabel: "Dismiss",
			onAnswer: (answer) => {
				if (answer === true) {
					app.serverConnection.reconnect();
				}
			},
		});
	};

	function onMouseEvent(event: MouseEvent) {
		globals.mousePosition.x = event.clientX;
		globals.mousePosition.y = event.clientY;
	}
	function onTouchEvent(event: TouchEvent) {
		if (event.touches.length > 0) {
			globals.mousePosition.x = event.touches[0].clientX;
			globals.mousePosition.y = event.touches[0].clientY;
		}
	}
	
	setContext("app-state", app);


	function onBeforeUnload() {
		const json = app.toJSON({ forceToJson: true });
		app.saveToLocalStorage(json);
	}
</script>

<!-- maybe non passive touch handlers + prevent default -->
<svelte:window
	onbeforeunload={onBeforeUnload}
	onmousedown={onMouseEvent}
	onmousemove={onMouseEvent}
	ontouchstart={onTouchEvent}
	ontouchmove={onTouchEvent}
/>

<OverlayLayer eventStream={eventStream}>
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
</OverlayLayer>

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
