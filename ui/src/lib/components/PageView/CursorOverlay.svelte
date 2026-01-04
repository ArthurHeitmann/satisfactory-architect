<script lang="ts">
	import type { GraphPage } from "$lib/datamodel/GraphPage.svelte";
	import { ServerConnectionState, type ServerConnection } from "$lib/sync/ServerConnection.svelte";
	import { getColorFromSeed } from "$lib/utilties";
    import PresetSvg from "../icons/PresetSvg.svelte";

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

{#if isInRoom}
	<g class="cursor-overlay">
		{#each visibleClients as client (client.userId)}
			{@const color = getColorFromSeed(client.userId)}
			<g
				class="cursor"
				style="--cursor-x: {client.cursor.x}px; --cursor-y: {client.cursor.y}px;"
			>
				<!-- Cursor pointer SVG -->
				<!-- <path
					d="M 0 0 L 0 12 L 3 9 L 8 9 Z"
					fill={color}
				/> -->
				<PresetSvg name="cursor" size={20} color={color} />
				<!-- User label -->
				<!-- <rect
					x="12"
					y="10"
					width={client.userId.length * 7 + 8}
					height="16"
					rx="3"
					fill={color}
				/>
				<text
					x="16"
					y="22"
					font-size="11"
					fill="white"
					font-family="sans-serif"
				>
					{client.userId}
				</text> -->
			</g>
		{/each}
	</g>
{/if}

<style>
	.cursor-overlay {
		pointer-events: none;
	}

	.cursor {
		transform: translate(var(--cursor-x), var(--cursor-y));
		transition: transform 40ms linear;
	}
</style>
