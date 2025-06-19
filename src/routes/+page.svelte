
<script lang="ts">
    import GraphPageView from "$lib/components/GraphPageView.svelte";
    import { AppState, GraphNode, GraphPage, GraphEdge } from "$lib/datamodel.svelte";
    import { localStorageState } from "$lib/localStorageState.svelte";
    import { onMount, setContext } from "svelte";

	const darkTheme = localStorageState("dark-theme", false);
	onMount(() => {
		if ($darkTheme) {
			document.documentElement.classList.add("dark-theme");
		} else {
			document.documentElement.classList.add("light-theme");
		}
		darkTheme.subscribe((value) => {
			if (value) {
				document.documentElement.classList.add("dark-theme");
				document.documentElement.classList.remove("light-theme");
			} else {
				document.documentElement.classList.add("light-theme");
				document.documentElement.classList.remove("dark-theme");
			}
		});
	})


	const app = AppState.newDefault();
	setContext("app-state", app);
	const currentPageId = $derived(app.currentPage.id);
	app.addPage(GraphPage.newDefault(app.nextId()));
	app.pages[1].name = "Second Page";
	const page = app.pages[0];
	const node1 = new GraphNode(
		app.nextId(),
		"none",
		[100, 100],
		[],
		{text: "Node 1"},
	);
	const node2 = new GraphNode(
		app.nextId(),
		"none",
		[300, 100],
		[],
		{text: "Node 2"},
	);
	const node3 = new GraphNode(
		app.nextId(),
		"none",
		[200, 250],
		[],
		{text: "Node 3"},
	);
	page.addNode(node1);
	page.addNode(node2);
	page.addNode(node3);

	const edge1 = new GraphEdge(
		app.nextId(),
		"straight",
		node1.id,
		node2.id,
		[],
	);
	const edge2 = new GraphEdge(
		app.nextId(),
		"straight",
		node2.id,
		node3.id,
		[],
	);
	const edge3 = new GraphEdge(
		app.nextId(),
		"straight",
		node3.id,
		node1.id,
		[],
	);
	page.addEdgeBetweenNodes(edge1, node1, node2);
	page.addEdgeBetweenNodes(edge2, node2, node3);
	page.addEdgeBetweenNodes(edge3, node3, node1);
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
			onclick={() => app.addPage(GraphPage.newDefault(app.nextId(), `Page ${app.pages.length + 1}`))}
		>
			➕ Add Page
		</button>
		<div class="spacer"></div>
		<button class=theme-button onclick={() => $darkTheme = !$darkTheme}>
			{$darkTheme ? "☀️ Light Theme" : "🌙 Dark Theme"}
		</button>
	</div>
</div>

<style lang="scss">
	.home {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100vh;
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
		padding: 10px;
		border-top: 1px solid var(--background-300);
	}

	.page-button {
		margin: 0 5px;
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

	.theme-button {
		margin-left: auto;
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
	}
</style>
