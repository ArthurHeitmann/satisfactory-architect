<script lang="ts">
	import { browser } from "$app/environment";
	import AppStateInitializedView from "./AppStateInitializedView.svelte";
	import OverlayLayer from "$lib/components/OverlayLayer/OverlayLayer.svelte";
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

	const eventStream = new EventStream();
	setContext("overlay-layer-event-stream", eventStream);

	interface LoadFailure {
		errorMessage: string;
		parsedJson: any | null;
	}

	function tryLoadAppState(): { app: AppState | null; failure: LoadFailure | null } {
		const savedJson = loadFormLocalStorage(StorageKeys.appState, null);
		if (savedJson !== null) {
			try {
				return { app: AppState.fromJSON(savedJson), failure: null };
			} catch (e) {
				const error = e instanceof Error ? e : new Error(String(e));
				console.error("Failed to initialize app state from local storage:", error);
				return {
					app: null,
					failure: {
						errorMessage: `${error.message}\n\n${error.stack ?? ""}`,
						parsedJson: savedJson,
					},
				};
			}
		}

		// No saved data — load starter save
		if (browser) {
			return { app: loadStarterSave(), failure: null };
		}
		return { app: AppState.newDefault(), failure: null };
	}

	function loadStarterSave(): AppState {
		const starterSave = JSON.parse(starterSaveJson);
		return AppState.fromJSON(starterSave);
	}

	const loadResult = tryLoadAppState();
	let app: AppState | null = $state(loadResult.app);

	onMount(() => {
		applyTheme(darkTheme.value);

		if (loadResult.failure) {
			eventStream.emit({
				type: "showCorruptSaveOverlay",
				errorMessage: loadResult.failure.errorMessage,
				parsedJson: loadResult.failure.parsedJson,
				onStartNew: () => {
					app = loadStarterSave();
				},
			});
		}

		if (app && appVersion.value < latestAppVersion) {
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

</script>

<svelte:window
	onmousedown={onMouseEvent}
	onmousemove={onMouseEvent}
	ontouchstart={onTouchEvent}
	ontouchmove={onTouchEvent}
/>

<OverlayLayer eventStream={eventStream} app={app}>
	{#if app}
		<AppStateInitializedView app={app} {eventStream} />
	{/if}
</OverlayLayer>
