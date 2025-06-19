<script lang="ts">
	import type { GraphEdge, GraphPage } from "$lib/datamodel.svelte";
    import { getContext } from "svelte";

	interface Props {
		edge: GraphEdge;
	}
	const { edge }: Props = $props();

	const page = getContext("graph-page") as GraphPage;

	const startNode = $derived(page.nodes.get(edge.startNodeId)!);
	const endNode = $derived(page.nodes.get(edge.endNodeId)!);

	const startPos = $derived(startNode.position);
	const endPos = $derived(endNode.position);
</script>

<line
	class="edge-view"
	x1={startPos.x}
	x2={endPos.x}
	y1={startPos.y}
	y2={endPos.y}
	stroke="black"
	stroke-width="2"
	stroke-linecap="round"
/>
