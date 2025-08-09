<script lang="ts">
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
	import { productionNodeIconSize } from "$lib/datamodel/constants";
	import { getContext } from "svelte";
	import SfIconView from "../SFIconView.svelte";
	import SvgInput from "../SvgInput.svelte";
	import { assertUnreachable, floatToString } from "$lib/utilties";
	import { globals } from "../../datamodel/globals.svelte";
	import { getNodeRadius, isNodeSelectable } from "../../datamodel/nodeTypeProperties.svelte";
	import type { Id } from "../../datamodel/IdGen";
	import type { GraphNode, GraphNodeSplitterMergerProperties, GraphNodeTextNoteProperties, LayoutOrientation } from "../../datamodel/GraphNode.svelte";
	import type { GraphPage } from "../../datamodel/GraphPage.svelte";
	import type { IVector2D } from "../../datamodel/GraphView.svelte";

	interface Props {
		node: GraphNode<GraphNodeTextNoteProperties>;
	}
	const {
		node,
	}: Props = $props();

	const page = $derived(node.context.page);

	const isSelected = $derived(page.selectedNodes.has(node.id));
	const isSelectable = $derived(isNodeSelectable(node));
	
	let div: HTMLDivElement|null = $state(null);

	function updateSize() {
		if (!div) return;
		if (node.properties.content.length < 0) return; // meaningless if, only exists to add dependency to the content
		const rect = div.getBoundingClientRect();
		const scale = page.view.scale;
		node.size.x = rect.width / scale;
		node.size.y = rect.height / scale;
	}

	$effect(updateSize)
</script>

<g
	class="text-note"
	class:selectable={isSelectable}
	class:selected={isSelected}
>
	<rect
		class="background"
		x={-node.size.x / 2}
		y={-node.size.y / 2}
		width={node.size.x}
		height={node.size.y}
	/>
	<foreignObject
		x={-node.size.x / 2}
		y={-node.size.y / 2}
	>
		<div class="content-wrapper" bind:this={div}>
			<div
				class="content"
				contenteditable="plaintext-only"
				bind:textContent={node.properties.content}
				oninput={() => setTimeout(updateSize, 0)}
			>
			</div>
		</div>
	</foreignObject>
	{#if globals.debugShowNodeIds}
		<text
			x="0"
			y={-node.size.y / 2}
			text-anchor="middle"
			style="pointer-events: none; font-size: 11px; font-family: monospace;"
		>
			n {node.id}
		</text>
	{/if}
</g>

<style lang="scss">
	.text-note {
		.background {
			fill: var(--node-background-color);
			stroke: var(--node-border-color);
			stroke-width: var(--rounded-border-width);
			rx: var(--rounded-border-radius-big);
			ry: var(--rounded-border-radius-big);
			transition: stroke 0.1s ease-in-out;
		}

		.content-wrapper {
			padding: 4px 8px;
			width: max-content;
			height: max-content;
			min-width: 50px;
			min-height: 50px;
		}
		
		.content {
			width: max-content;
			height: max-content;
			font-size: 12px;
		}

		&:hover:not(.selected) {
			.background {
				stroke: var(--node-border-hover-color);
			}
		}

		&.selected {
			.background {
				stroke: var(--node-border-selected-color);
			}
		}
	}
</style>
