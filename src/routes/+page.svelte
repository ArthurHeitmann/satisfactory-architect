
<script lang="ts">
    import { browser } from "$app/environment";
    import OverlayLayer from "$lib/components/OverlayLayer/OverlayLayer.svelte";
    import PagesBar from "$lib/components/PagesBar/PagesBar.svelte";
    import PageView from "$lib/components/PageView/PageView.svelte";
	import { AppState } from "$lib/datamodel/AppState.svelte";
    import { StorageKeys } from "$lib/datamodel/constants";
    import { darkTheme, globals } from "$lib/datamodel/globals.svelte";
	import { GraphPage } from "$lib/datamodel/GraphPage.svelte";
    import { EventStream } from "$lib/EventStream.svelte";
	import { loadFormLocalStorage, localStorageState } from "$lib/localStorageState.svelte";
	import { onMount, setContext } from "svelte";

	onMount(() => {
		const applyTheme = (isDark: boolean) => {
			if (isDark) {
				document.documentElement.classList.add("dark-theme");
				document.documentElement.classList.remove("light-theme");
			} else {
				document.documentElement.classList.add("light-theme");
				document.documentElement.classList.remove("dark-theme");
			}
		};
		applyTheme($darkTheme);
		darkTheme.subscribe(applyTheme);
	});

	const app = (() => {
		const savedJson = loadFormLocalStorage(StorageKeys.appState, null);
		if (savedJson !== null) {
			return AppState.fromJSON(savedJson);
		} else {
			const app = AppState.newDefault();
			if (browser) {
				app.addPage(GraphPage.newDefault(app));
				app.pages[1].name = `Page ${app.pages.length}`;
				const page = app.pages[0];
				page.makeNewNode(
					{type: "recipe", recipeClassName: "Recipe_ModularFrameHeavy_C"},
					{x: 300, y: 300},
				);
				page.makeNewNode(
					{type: "recipe", recipeClassName: "Recipe_UnpackageAlumina_C"},
					{x: 600, y: 500},
				);
				page.makeNewNode(
					{type: "recipe", recipeClassName: "Recipe_PackagedAlumina_C"},
					{x: 900, y: 300},
				);
			}
			return app;
		}
	})();

	const eventStream = new EventStream();
	setContext("overlay-layer-event-stream", eventStream);

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
	
	const currentPageId = $derived(app.currentPage.id);
	setContext("app-state", app);


	function onBeforeUnload() {
		const json = app.toJSON();
		app.saveToLocalStorage(json);
	}
</script>

<svelte:head>
	<title>Satisfactory Architect</title>
	<meta name="description" content="A tool for planning, managing and visualizing Satisfactory factories." />
</svelte:head>

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
			{#key app.currentPage.id}
				<PageView page={app.currentPage} />
			{/key}
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
