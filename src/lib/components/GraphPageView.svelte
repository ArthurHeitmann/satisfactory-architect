<script lang="ts">
	import { setContext } from "svelte";
	import EdgeView from "./EdgeView/EdgeView.svelte";
	import NodeView from "./NodeView/NodeView.svelte";
	import UserEvents, { type CursorEvent } from "./UserEvents.svelte";
	import OverlayLayer from "./OverlayLayer/OverlayLayer.svelte";
	import { gridSize } from "../datamodel/constants";
	import { globals } from "../datamodel/globals.svelte";
	import type { NewNodeDetails } from "../datamodel/GraphNode.svelte";
	import type { GraphPage } from "../datamodel/GraphPage.svelte";
    import { EventStream, type ContextMenuItem } from "$lib/EventStream.svelte";
    import type { IVector2D } from "../datamodel/GraphView.svelte";
    import type { Id } from "../datamodel/IdGen";
    import { assertUnreachable, getClipboardText, pluralStr } from "$lib/utilties";
    import { isNodeSelectable } from "../datamodel/nodeTypeProperties.svelte";
    import { fade } from "svelte/transition";
    import { calculateThroughputs } from "../datamodel/throughputsCalculator";

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
	const enableUserEvents = $derived(!page.userEventsPriorityNodeId);

	let svg: SVGSVGElement;
	let svgTopGroup: SVGGElement;

	setContext("graph-page", page);

	const eventStream = new EventStream();

	interface BBox {
		x: number;
		y: number;
		width: number;
		height: number;
	}
	let dragType: "select" | "move" = $state("move");
	let selectionAreaRaw: BBox|null = $state(null);
	let selectionArea: BBox|null = $derived.by(() => {
		if (!selectionAreaRaw) {
			return null;
		}
		return {
			x: selectionAreaRaw.width < 0 ? selectionAreaRaw.x + selectionAreaRaw.width : selectionAreaRaw.x,
			y: selectionAreaRaw.height < 0 ? selectionAreaRaw.y + selectionAreaRaw.height : selectionAreaRaw.y,
			width: Math.abs(selectionAreaRaw.width),
			height: Math.abs(selectionAreaRaw.height)
		};
	});
	const initiallySelectedNodeIds = new Set<Id>();
	function onKeyDown(key: string, event: KeyboardEvent) {
		if (event.ctrlKey && key === "z") {
			page.history.undo();
		} else if (event.ctrlKey && key === "y") {
			page.history.redo();
		} else if (key === "Delete" || key === "Backspace") {
			page.removeSelectedNodesAndEdges();
		} else if (event.ctrlKey && key === "c") {
			page.copyOrCutSelection("copy");
		} else if (event.ctrlKey && key === "x") {
			page.copyOrCutSelection("cut");
		}
	}
	function onClick(event: CursorEvent) {
		if (!event.hasPrimaryButton) {
			return;
		}
		if (event.target !== svg) {
			return;
		}
		page.clearAllSelection();
	}

	function onContextMenu(event: MouseEvent) {
		if (event.target !== svg && event.target !== svgTopGroup) {
			return;
		}
		event.preventDefault();
		const items: ContextMenuItem[] = [];
		items.push({
			label: "Add Node",
			onClick: () => eventStream.emit({
				type: "showProductionSelector",
				x: event.clientX,
				y: event.clientY,
				onSelect: (details) => addNewProductionNode(details, event),
			})
		});
		if (page.selectedNodes.size > 0) {
			items.push({
				label: `Copy ${pluralStr("node", page.selectedNodes.size)}`,
				hint: "Ctrl+C",
				onClick: () => page.copyOrCutSelection("copy")
			});
			items.push({
				label: `Cut ${pluralStr("node", page.selectedNodes.size)}`,
				hint: "Ctrl+X",
				onClick: () => page.copyOrCutSelection("cut")
			});
		}
		if (window.navigator.clipboard && window.isSecureContext) {
			items.push({
				label: "Paste",
				hint: "Ctrl+V",
				onClick: () => paste()
			});
		}
		items.push({
			label: globals.debugConsoleLog ? "Disable Debug Log" : "Enable Debug Log",
			onClick: () => globals.debugConsoleLog = !globals.debugConsoleLog
		});
		items.push({
			label: globals.debugShowNodeIds ? "Hide Node IDs" : "Show Node IDs",
			onClick: () => globals.debugShowNodeIds = !globals.debugShowNodeIds
		});
		items.push({
			label: globals.debugShowEdgeIds ? "Hide Edge IDs" : "Show Edge IDs",
			onClick: () => globals.debugShowEdgeIds = !globals.debugShowEdgeIds
		});
		eventStream.emit({
			type: "showContextMenu",
			x: event.clientX,
			y: event.clientY,
			items
		});
	}

	function onDoubleClick(event: MouseEvent, isTouchEvent: boolean) {
		if (event.target !== svg && event.target !== svgTopGroup) {
			return;
		}
		eventStream.emit({
			type: "showProductionSelector",
			x: event.clientX,
			y: event.clientY,
			autofocus: !isTouchEvent,
			onSelect: (details) => addNewProductionNode(details, event),
		});
	}

	async function paste(clipboardData: string|null = null) {
		clipboardData ??= await getClipboardText();
		if (!clipboardData) {
			return;
		}
		const cursorPoint = page.screenToPageCoords(globals.mousePosition);
		page.insertJson(clipboardData, "external", cursorPoint);
	}

	function addNewProductionNode(productionDetails: NewNodeDetails, event: MouseEvent) {
		const point = page.screenToPageCoords({x: event.clientX, y: event.clientY});
		page.makeProductionNode(productionDetails, { x: point.x, y: point.y });
	}

	function updateSelectedNodes() {
		if (!selectionAreaRaw) {
			return;
		}
		const selectedNodeIds: Id[] = [];
		for (const [id, node] of page.nodes.entries()) {
			if (!isNodeSelectable(node) || node.parentNode !== null) {
				continue;
			}
			const nodePosition = node.position;
			const nodeSize = node.size;
			const nodeBBox: BBox = {
				x: nodePosition.x - nodeSize.x / 2,
				y: nodePosition.y - nodeSize.y / 2,
				width: nodeSize.x,
				height: nodeSize.y
			};
			const intersects = (
				selectionArea!.x < nodeBBox.x + nodeBBox.width &&
				selectionArea!.x + selectionArea!.width > nodeBBox.x &&
				selectionArea!.y < nodeBBox.y + nodeBBox.height &&
				selectionArea!.y + selectionArea!.height > nodeBBox.y
			);
			if (intersects) {
				selectedNodeIds.push(id);
			}
		}
		page.selectedNodes.clear();
		for (const id of [...initiallySelectedNodeIds, ...selectedNodeIds]) {
			page.selectedNodes.add(id);
		}
	}

	$effect(() => {
		if (globals.debugConsoleLog) {
			console.log($state.snapshot(page));
			for (const edge of page.edges.values()) {
				const startNode = page.nodes.get(edge.startNodeId);
				const endNode = page.nodes.get(edge.endNodeId);
				if (!startNode || !endNode) {
					console.warn("EdgeView: Edge references invalid node", $state.snapshot(edge));
				} else {
					for (const n of [startNode, endNode]) {
						if (!n.edges.has(edge.id)) {
							console.warn("EdgeView: missing double link in", $state.snapshot(edge), "to", $state.snapshot(n));
						}
					}
				}
			}
		}
	});

	$effect(() => {
		page.history.onDataChange();
	});

	$effect(() => {
		calculateThroughputs(page);
	});
</script>

<svelte:window
	onpaste={e => paste(e.clipboardData?.getData("text/plain"))}
/>

<OverlayLayer eventStream={eventStream}>
	<UserEvents
		id="Page {page.id}"
		onDragStart={enableUserEvents ? (e) => {
			dragType = e.cursorEvent.isMiddleButton || e.cursorEvent.isTouchEvent ? "move" : "select";
			if (dragType === "select") {
				const svgRect = svg.getBoundingClientRect();
				const cursor = {
					x: e.cursorEvent.clientX - svgRect.left,
					y: e.cursorEvent.clientY - svgRect.top
				};
				const point = page.screenToPageCoords(cursor);
				selectionAreaRaw = {
					x: point.x,
					y: point.y,
					width: 0,
					height: 0
				};
				initiallySelectedNodeIds.clear();
				if (e.cursorEvent.hasShiftKey) {
					for (const node of page.selectedNodes) {
						initiallySelectedNodeIds.add(node);
					}
				} else {
					page.clearAllSelection();
				}
			}
		} : null}
		onDrag={enableUserEvents ? (e) => {
			if (isNaN(e.deltaX) || isNaN(e.deltaY)) {
				return;
			}
			if (dragType === "move") {
				page.view.offset.x += e.deltaX;
				page.view.offset.y += e.deltaY;
			} else if (dragType === "select") {
				const scale = page.view.scale;
				selectionAreaRaw!.width += e.deltaX / scale;
				selectionAreaRaw!.height += e.deltaY / scale;
				updateSelectedNodes();
			} else {
				assertUnreachable(dragType);
			}
		} : null}
		onDragEnd={enableUserEvents ? () => {
			selectionAreaRaw = null;
			dragType = "move";
		} : null}
		onZoom={enableUserEvents ? (deltaFactor, cursorX, cursorY) => {
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
			const point = page.screenToPageCoords(cursor);
			page.view.offset.x += point.x * scaleDelta;
			page.view.offset.y += point.y * scaleDelta;
			page.view.scale = newScale;
		} : null}
		onClick={enableUserEvents ? onClick : null}
		onContextMenu={enableUserEvents ? onContextMenu : null}
		onDoubleClick={enableUserEvents ? onDoubleClick : null}
		onKeyDown={enableUserEvents ? onKeyDown : null}
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
				<defs>
					<!-- A marker to be used as an arrowhead -->
					<marker
						id="arrow"
						viewBox="0 0 10 10"
						refX="1"
						refY="5"
						markerWidth="6"
						markerHeight="6"
						orient="auto-start-reverse"
						fill="var(--edge-stroke-color)"
					>
						<path d="M 0 0 L 10 5 L 0 10 z" />
					</marker>
				</defs>
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

					{#if selectionAreaRaw}
						<rect
							class="selection-area"
							x={selectionArea!.x}
							y={selectionArea!.y}
							width={selectionArea!.width}
							height={selectionArea!.height}
							transition:fade={{ duration: 100 }}
						/>
					{/if}
				</g>
			</svg>
		{/snippet}
	</UserEvents>
</OverlayLayer>

<style lang="scss">
	.graph-page-view {
		background-color: var(--grid-background-color);
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

	.selection-area {
		fill: var(--selection-area-background-color);
		stroke: var(--selection-area-border-color);
		stroke-width: 1;
		pointer-events: none;
	}
</style>
