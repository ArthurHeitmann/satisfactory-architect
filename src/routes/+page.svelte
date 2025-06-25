
<script lang="ts">
    import GraphPageView from "$lib/components/GraphPageView.svelte";
    import { AppState, GraphNode, GraphPage, GraphEdge, type GraphNodeResourceJointProperties } from "$lib/components/datamodel/datamodel.svelte";
    import { localStorageState } from "$lib/localStorageState.svelte";
    import { onMount, setContext } from "svelte";

	const darkTheme = localStorageState("dark-theme", true);
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
	})


	const app = AppState.newDefault();
	setContext("app-state", app);
	const currentPageId = $derived(app.currentPage.id);
	app.addPage(GraphPage.newDefault(app.idGen));
	app.pages[1].name = `Page ${app.pages.length}`;
	const page = app.pages[0];
	const {parent: parent1, children: children1} = GraphNode.makeRecipeNode(
		app.idGen,
		{x: 300, y: 300},
		[],
		"Recipe_ModularFrameHeavy_C",
	);
	page.addNodes(parent1, ...children1);
	page.addChildrenToNode(parent1, ...children1);
	const {parent: parent2, children: children2} = GraphNode.makeRecipeNode(
		app.idGen,
		{x: 600, y: 500},
		[],
		"Recipe_UnpackageAlumina_C",
	);
	page.addNodes(parent2, ...children2);
	page.addChildrenToNode(parent2, ...children2);
	const {parent: parent3, children: children3} = GraphNode.makeRecipeNode(
		app.idGen,
		{x: 900, y: 300},
		[],
		"Recipe_PackagedAlumina_C",
	);
	page.addNodes(parent3, ...children3);
	page.addChildrenToNode(parent3, ...children3);
</script>

<div class="home">
	<div class="page-view">
		<GraphPageView page={app.currentPage} />
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
			onclick={() => app.addPage(GraphPage.newDefault(app.idGen, `Page ${app.pages.length + 1}`))}
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
