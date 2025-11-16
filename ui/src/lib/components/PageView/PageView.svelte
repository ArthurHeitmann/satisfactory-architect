<script lang="ts">
	import { gridSize } from "$lib/datamodel/constants";
	import { globals } from "$lib/datamodel/globals.svelte";
	import type { NewNodeDetails } from "$lib/datamodel/GraphNode.svelte";
	import type { GraphPage } from "$lib/datamodel/GraphPage.svelte";
	import type { Id } from "$lib/datamodel/IdGen";
	import { isNodeSelectable } from "$lib/datamodel/nodeTypeProperties.svelte";
	import { calculateThroughputs } from "$lib/datamodel/throughputsCalculator";
	import { EventStream, type ContextMenuItem } from "$lib/EventStream.svelte";
	import { pluralStr, getClipboardText, assertUnreachable, targetsInput } from "$lib/utilties";
	import { getContext } from "svelte";
	import { fade } from "svelte/transition";
	import EdgeView from "../EdgeView/EdgeView.svelte";
	import NodeView from "../NodeView/NodeView.svelte";
	import UserEvents, { type CursorEvent } from "../UserEvents.svelte";
	import Toolbar from "./ToolModeSelector.svelte";
	import PropertiesToolbar from "./PropertiesToolbar.svelte";

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

	const eventStream = getContext("overlay-layer-event-stream") as EventStream;

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
	const initiallySelectedIds = new Set<Id>();

	function onKeyDown(key: string, event: KeyboardEvent) {
		if (event.ctrlKey && key === "z") {
			page.history.undo();
			event.preventDefault();
		} else if (event.ctrlKey && key === "y") {
			page.history.redo();
			event.preventDefault();
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
		if (event.hasShiftKey) {
			return;
		}
		if (event.target !== svg) {
			return;
		}
		if (page.toolMode === "select-nodes" || page.toolMode === "select-edges") {
			page.clearAllSelection();
		} else if (page.toolMode === "add-note") {
			const point = page.screenToPageCoords({x: event.clientX, y: event.clientY});
			page.makeNewNode(
				{type: "text-note", content: "New Note"},
				point
			);
		} else {
			assertUnreachable(page.toolMode);
		}
	}

	function onContextMenu(event: MouseEvent) {
		if (event.target !== svg && event.target !== svgTopGroup) {
			return;
		}
		event.preventDefault();
		const items: ContextMenuItem[] = [];
		items.push({
			label: "Add Node",
			icon: "add",
			onClick: () => eventStream.emit({
				type: "showProductionSelector",
				page: page,
				x: event.clientX,
				y: event.clientY,
				onSelect: (details) => addNewProductionNode(details, event),
			})
		});
		if (page.selectedNodes.size > 0) {
			items.push({
				label: `Copy ${pluralStr("Node", page.selectedNodes.size)}`,
				icon: "copy",
				hint: "Ctrl+C",
				onClick: () => page.copyOrCutSelection("copy")
			});
			items.push({
				label: `Cut ${pluralStr("Node", page.selectedNodes.size)}`,
				icon: "cut",
				hint: "Ctrl+X",
				onClick: () => page.copyOrCutSelection("cut")
			});
		}
		if (window.navigator.clipboard && window.isSecureContext) {
			items.push({
				label: "Paste",
				icon: "paste",
				hint: "Ctrl+V",
				onClick: () => paste()
			});
		}
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
		if (page.toolMode !== "select-nodes" && page.toolMode !== "select-edges") {
			return;
		}
		eventStream.emit({
			type: "showProductionSelector",
			page: page,
			x: event.clientX,
			y: event.clientY,
			autofocus: !isTouchEvent,
			onSelect: (details) => addNewProductionNode(details, event),
		});
	}

	async function paste(clipboardData: string|null = null, e: Event|null = null) {
		if (e && targetsInput(e)) {
			return;
		}
		clipboardData ??= await getClipboardText();
		if (!clipboardData) {
			return;
		}
		const cursorPoint = page.screenToPageCoords(globals.mousePosition);
		let jsonData;
		try {
			jsonData = JSON.parse(clipboardData);
		} catch (error) {
			console.log("Clipboard data is not valid JSON", error);
			return;
		}
		page.insertJson(jsonData, "local", cursorPoint);
	}

	function addNewProductionNode(productionDetails: NewNodeDetails, event: MouseEvent) {
		const point = page.screenToPageCoords({x: event.clientX, y: event.clientY});
		page.makeNewNode(productionDetails, { x: point.x, y: point.y });
	}

	function updateSelectedNodesOrEdges() {
		if (!selectionAreaRaw) {
			return;
		}
		const selectedIds: Id[] = [];
		if (page.toolMode === "select-nodes") {
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
					selectedIds.push(id);
				}
			}
			page.selectedNodes.clear();
			for (const id of [...initiallySelectedIds, ...selectedIds]) {
				page.selectedNodes.add(id);
			}
		} else if (page.toolMode === "select-edges") {
			for (const [id, edge] of page.edges.entries()) {
				if (!edge.pathPoints) {
					continue;
				}
				for (const point of [edge.pathPoints.startPoint, edge.pathPoints.endPointWithoutArrow]) {
					if (!point) {
						continue;
					}
					if (
						selectionArea!.x < point.x &&
						selectionArea!.x + selectionArea!.width > point.x &&
						selectionArea!.y < point.y &&
						selectionArea!.y + selectionArea!.height > point.y
					) {
						selectedIds.push(id);
						break;
					}
				}
			}
			page.selectedEdges.clear();
			for (const id of [...initiallySelectedIds, ...selectedIds]) {
				page.selectedEdges.add(id);
			}
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
	onpaste={e => paste(e.clipboardData?.getData("text/plain"), e)}
/>

<div class="page">
	<PropertiesToolbar page={page} />

	<UserEvents
		id="Page {page.id}"
		canStartDrag={enableUserEvents ? (e) => {
			dragType = e.cursorEvent.isMiddleButton || e.cursorEvent.isTouchEvent ? "move" : "select";
			if (dragType !== "select") {
				return true;
			}
			return e.cursorEvent.target === svg;
		} : null}
		onDragStart={enableUserEvents ? (e) => {
			dragType = e.cursorEvent.isMiddleButton || e.cursorEvent.isTouchEvent ? "move" : "select";
			if (dragType === "select" && (page.toolMode === "select-nodes" || page.toolMode === "select-edges")) {
				const point = page.screenToPageCoords({ x: e.cursorEvent.clientX, y: e.cursorEvent.clientY });
				selectionAreaRaw = {
					x: point.x,
					y: point.y,
					width: 0,
					height: 0
				};
				initiallySelectedIds.clear();
				if (e.cursorEvent.hasShiftKey) {
					if (page.toolMode === "select-nodes") {
						for (const node of page.selectedNodes) {
							initiallySelectedIds.add(node);
						}
					} else if (page.toolMode === "select-edges") {
						for (const node of page.selectedEdges) {
							initiallySelectedIds.add(node);
						}
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
				if (page.toolMode === "select-nodes" || page.toolMode === "select-edges") {
					const scale = page.view.scale;
					selectionAreaRaw!.width += e.deltaX / scale;
					selectionAreaRaw!.height += e.deltaY / scale;
					updateSelectedNodesOrEdges();
				}
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
				bind:this={page.svgElement}
				{...listeners}
			>
				<defs>
					<marker
						id="arrow"
						viewBox="0 0 11 10"
						refX="0"
						refY="5"
						markerWidth="10.5"
						markerHeight="10"
						orient="auto-start-reverse"
						markerUnits="userSpaceOnUse"
					>
						<path
							d="M 0 0 l 11 5 l -11 5 z"
							fill="context-stroke"
						/>
					</marker>
					<marker
						id="arrow-wide"
						viewBox="0 0 11 15"
						refX="0"
						refY="7.5"
						markerWidth="10.5"
						markerHeight="15"
						orient="auto-start-reverse"
						markerUnits="userSpaceOnUse"
					>
						<path
							d="M 0 0 l 11 7.5 l -11 7.5 z"
							fill="context-stroke"
						/>
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

	<Toolbar bind:activeMode={page.toolMode} x={40} y={10} />
</div>

<style lang="scss">
	.page {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
	}

	.graph-page-view {
		flex: 1;
		background-image: var(--grid-background-image);
		background-color: var(--grid-background-color);
		background-position: var(--offset-x) var(--offset-y);
		background-size: var(--square-size) var(--square-size);
		background-repeat: repeat;
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
