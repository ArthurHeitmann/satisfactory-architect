<script lang="ts">
    import type { GraphPage } from "$lib/datamodel.svelte";
    import { setContext } from "svelte";
    import EdgeView from "./EdgeView.svelte";
    import NodeView from "./NodeView.svelte";
    import DragEvents from "./DragEvents.svelte";

	interface Props {
		page: GraphPage;
	}
	const { page }: Props = $props();

	setContext("graph-page", page);
</script>

<DragEvents
	onDrag={(dx, dy) => {
		page.view.offset.x += dx;
		page.view.offset.y += dy;
	}}
	onZoom={(deltaFactor, cx, cy) => {
		const currentScale = page.view.scale;
		const newScale = currentScale * deltaFactor;
		const scaleDelta = currentScale - newScale;
		const px = (cx - page.view.offset.x) / currentScale;
		const py = (cy - page.view.offset.y) / currentScale;
		page.view.offset.x += px * scaleDelta;
		page.view.offset.y += py * scaleDelta;
		page.view.scale = newScale;
	}}
	allowMiddleClickDrag={true}
	allowMultiTouchDrag={true}
>
	<svg
		class="graph-page-view"
		width="100%"
		height="100%"
		style={
			`--offset-x: ${page.view.offset.x - 25 * page.view.scale}px;\n` +
			`--offset-y: ${page.view.offset.y - 25 * page.view.scale}px;\n` + 
			`--square-size: ${page.view.scale * 50}px;`
		}
	>
		<g transform={
			`translate(${page.view.offset.x}, ${page.view.offset.y}) ` +
			`scale(${page.view.scale})`
		}>
			{#each page.edges as [id, edge] (id)}
				<EdgeView {edge} />
			{/each}
			{#each page.nodes as [id, node] (id)}
				<NodeView {node} />
			{/each}
		</g>
	</svg>
</DragEvents>

<style lang="scss">
	.graph-page-view {
		background-position: var(--offset-x) var(--offset-y);
		background-size: var(--square-size) var(--square-size);
		background-repeat: repeat;
	}

	:global(.light-theme) .graph-page-view {
		background-image: url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+DQogIDxjaXJjbGUgY3g9IjI1IiBjeT0iMjUiIHI9IjIiIGZpbGw9IiNkNmQ2ZDYiLz4NCjwvc3ZnPg==");
	}

	:global(.dark-theme) .graph-page-view {
		background-image: url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+DQogIDxjaXJjbGUgY3g9IjI1IiBjeT0iMjUiIHI9IjIiIGZpbGw9IiMyNDI0MjQiLz4NCjwvc3ZnPg==");
	}

	svg {
		user-select: none;
	}
</style>
