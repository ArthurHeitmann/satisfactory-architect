<script lang="ts">
    import { GraphNode, type GraphNodeRecipeProperties, type GraphPage } from "$lib/components/datamodel/datamodel.svelte";
    import { setContext } from "svelte";
    import EdgeView from "./EdgeView/EdgeView.svelte";
    import NodeView from "./NodeView/NodeView.svelte";
    import DragEvents, { type ClickEvent } from "./UserEvents.svelte";
    import OverlayLayer from "./OverlayLayer/OverlayLayer.svelte";
    import type { ShowContextMenuEvent, ShowRecipeSelectorEvent } from "$lib/EventStream.svelte";
    import { gridSize } from "./datamodel/layoutConstants";

	interface Props {
		page: GraphPage;
	}
	const { page }: Props = $props();

	const sortedNodes = $derived.by(() => {
		return Array.from(page.nodes.entries()).sort((a, b) => {
			const aNode = a[1];
			const bNode = b[1];
			return aNode.priority - bNode.priority;
		});
	});

	let svg: SVGSVGElement;
	let svgTopGroup: SVGGElement;

	setContext("graph-page", page);

	function onKeyDown(key: string, event: KeyboardEvent) {
		if (event.ctrlKey && key === "z") {
			page.history.undo();
		} else if (event.ctrlKey && key === "y") {
			page.history.redo();
		} else if (key === "Delete" || key === "Backspace") {
			page.removeSelectedNodes();
		}
	}

	function onClick(event: ClickEvent) {
		if (!event.hasPrimaryButton) {
			return;
		}
		if (event.target !== svg) {
			return;
		}
		page.selectedNodes.clear();
	}

	function onContextMenu(event: MouseEvent) {
		if (event.target !== svg && event.target !== svgTopGroup) {
			return;
		}
		event.preventDefault();
		page.eventStream.emit(<ShowContextMenuEvent>{
			type: "showContextMenu",
			x: event.clientX,
			y: event.clientY,
			items: [
				{
					label: "Add Node",
					onClick: () => page.eventStream.emit(<ShowRecipeSelectorEvent>{
						type: "showRecipeSelector",
						x: event.clientX,
						y: event.clientY,
					})
				}
			]
		});
	}

	function onDoubleClick(event: MouseEvent, isTouchEvent: boolean) {
		if (event.target !== svg && event.target !== svgTopGroup) {
			return;
		}
		page.eventStream.emit(<ShowRecipeSelectorEvent>{
			type: "showRecipeSelector",
			x: event.clientX,
			y: event.clientY,
			autofocus: !isTouchEvent,
			onSelect: (recipe: string) => {
				const point = page.screenToGraphCoords({x: event.clientX, y: event.clientY});
				page.makeRecipeNode(recipe, { x: point.x, y: point.y });
			},
		});
	}

	// $effect(() => {
	// 	console.log($state.snapshot(page));
	// })
</script>

<OverlayLayer eventStream={page.eventStream}>
	<DragEvents
		onDrag={(e) => {
			if (isNaN(e.deltaX) || isNaN(e.deltaY)) {
				return;
			}
			page.view.offset.x += e.deltaX;
			page.view.offset.y += e.deltaY;
		}}
		onZoom={(deltaFactor, cursorX, cursorY) => {
			if (isNaN(deltaFactor) || isNaN(cursorX) || isNaN(cursorY) || deltaFactor === 0) {
				return;
			}
			const currentScale = page.view.scale;
			const newScale = currentScale * deltaFactor;
			if (newScale < 0.25 || newScale > 5) {
				return;
			}
			const svgRect = svg.getBoundingClientRect();
			const cursor = {
				x: cursorX - svgRect.left,
				y: cursorY - svgRect.top
			};
			const scaleDelta = currentScale - newScale;
			const point = page.screenToGraphCoords(cursor);
			page.view.offset.x += point.x * scaleDelta;
			page.view.offset.y += point.y * scaleDelta;
			page.view.scale = newScale;
		}}
		onClick={onClick}
		onContextMenu={onContextMenu}
		onDoubleClick={onDoubleClick}
		onKeyDown={onKeyDown}
		allowMiddleClickDrag={true}
		allowMultiTouchDrag={true}
	>
		{#snippet children({ listeners })}
			<svg
				class="graph-page-view"
				width="100%"
				height="100%"
				style={
					`--offset-x: ${page.view.offset.x - gridSize/2 * page.view.scale}px;\n` +
					`--offset-y: ${page.view.offset.y - gridSize/2 * page.view.scale}px;\n` + 
					`--square-size: ${page.view.scale * gridSize}px;`
				}
				bind:this={svg}
				{...listeners}
			>
				<g
					transform={
						`translate(${page.view.offset.x}, ${page.view.offset.y}) ` +
						`scale(${page.view.scale})`
					}
					bind:this={svgTopGroup}
				>
					{#each page.edges as [id, edge] (id)}
						<EdgeView {edge} />
					{/each}
					{#each sortedNodes as [id, node] (id)}
						<NodeView {node} />
					{/each}
				</g>
			</svg>
		{/snippet}
	</DragEvents>
</OverlayLayer>

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
