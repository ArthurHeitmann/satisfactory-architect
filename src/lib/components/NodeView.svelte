<script lang="ts">
	import type { GraphNode, GraphPage } from "$lib/datamodel.svelte";
    import { getContext } from "svelte";

	interface Props {
		node: GraphNode;
	}
	const { node }: Props = $props();

	const text = $derived(node.properties.get("text") ?? "Node");
</script>

<text
	class="node-view"
	x={node.position.x}
	y={node.position.y}
	dy="0.35em"
	text-anchor="middle"
>
	{text}
</text>
