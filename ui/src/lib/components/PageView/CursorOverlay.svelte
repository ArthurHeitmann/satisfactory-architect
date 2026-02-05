<script lang="ts">
	import type { GraphPage } from "$lib/datamodel/GraphPage.svelte";
	import { ServerConnectionState, type ServerConnection } from "$lib/sync/ServerConnection.svelte";
	import { getColorFromSeed } from "$lib/utilties";
	import { globals } from "$lib/datamodel/globals.svelte";
    import Cursor from "./Cursor.svelte";

	interface Props {
		page: GraphPage;
		serverConnection: ServerConnection;
	}
	const { page, serverConnection }: Props = $props();

	const isInRoom = $derived(serverConnection.state === ServerConnectionState.InRoom);
	
	// Filter other clients on the same page
	const visibleClients = $derived(
		serverConnection.otherClients.filter(client => client.currentPageId === page.id && client.userId !== serverConnection.ownUserId)
	);
</script>

{#if isInRoom && globals.showOtherCursors}
	<g class="cursor-overlay">
		{#each visibleClients as client (client.userId)}
			{@const color = getColorFromSeed(client.userId)}
			<Cursor x={client.cursor.x} y={client.cursor.y} color={color} />
		{/each}
	</g>
{/if}

<style>
	.cursor-overlay {
		pointer-events: none;
	}
</style>
