
<script lang="ts">
    import { browser } from "$app/environment";
	import { AppState } from "$lib/components/datamodel/AppState.svelte";
    import { StorageKeys } from "$lib/components/datamodel/constants";
    import { globals } from "$lib/components/datamodel/globals.svelte";
	import { GraphPage } from "$lib/components/datamodel/GraphPage.svelte";
    import GraphPageView from "$lib/components/GraphPageView.svelte";
	import { loadFormLocalStorage, localStorageState } from "$lib/localStorageState.svelte";
	import { onMount, setContext } from "svelte";

	const darkTheme = localStorageState(StorageKeys.darkTheme, true);
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
				page.makeProductionNode(
					{type: "recipe", recipeClassName: "Recipe_ModularFrameHeavy_C"},
					{x: 300, y: 300},
				);
				page.makeProductionNode(
					{type: "recipe", recipeClassName: "Recipe_UnpackageAlumina_C"},
					{x: 600, y: 500},
				);
				page.makeProductionNode(
					{type: "recipe", recipeClassName: "Recipe_PackagedAlumina_C"},
					{x: 900, y: 300},
				);
			}
			return app;
		}
	})();

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

<svelte:window
	onbeforeunload={onBeforeUnload}
	onmousedown={onMouseEvent}
	onmousemove={onMouseEvent}
	ontouchstart={onTouchEvent}
	ontouchmove={onTouchEvent}
/>

<div class="home">
	<div class="page-view">
		{#key app.currentPage.id}
			<GraphPageView page={app.currentPage} />
		{/key}
	</div>
	<div class="bottom-bar">
		{#each app.pages as page (page.id)}
			<button
				class="page-button"
				onclick={() => app.setCurrentPage(page)}
				disabled={currentPageId === page.id}
			>
				{page.name}
			</button>
		{/each}
		<button
			class="page-button"
			onclick={() => app.addPage(GraphPage.newDefault(app, `Page ${app.pages.length + 1}`))}
		>
			➕ Add Page
		</button>
		<div class="spacer"></div>
		<button class=toggle-button onclick={() => app.currentPage.view.enableGridSnap = !app.currentPage.view.enableGridSnap} class:active={app.currentPage.view.enableGridSnap}>
			{app.currentPage.view.enableGridSnap ? "Disable Grid Snap" : "Enable Grid Snap"}
		</button>
		<button class=toggle-button onclick={() => $darkTheme = !$darkTheme}>
			{$darkTheme ? "☀️ Light Theme" : "🌙 Dark Theme"}
		</button>
	</div>
</div>

<style lang="scss">
	:global(:root) {
		overscroll-behavior: none;
	}

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

	.bottom-bar {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 10px;
		padding: 10px;
		border-top: 1px solid var(--background-300);
	}

	.page-button {
		padding: 5px 10px;
		background-color: var(--background-200);
		border: none;
		border-radius: 4px;

		&:not(:disabled) {
			&:hover {
				background-color: var(--background-300);
			}

			&:active {
				background-color: var(--background-400);
			}
		}

		&:disabled {
			background-color: var(--secondary);
		}
	}

	.spacer {
		flex-grow: 1;
	}

	.toggle-button {
		padding: 5px 10px;
		background-color: var(--background-200);
		border: none;
		border-radius: 4px;

		&:hover {
			background-color: var(--background-300);
		}

		&:active {
			background-color: var(--background-400);
		}

		&:global(.active) {
			background-color: var(--primary);
			color: white;
		}
	}
</style>
