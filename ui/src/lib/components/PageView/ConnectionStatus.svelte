<script lang="ts">
	import type { ServerConnection } from "$lib/sync/ServerConnection.svelte";

	interface Props {
		serverConnection: ServerConnection;
	}

	const { serverConnection }: Props = $props();

	const isConnected = $derived(serverConnection.state === "InRoom");
	const userCount = $derived(serverConnection.otherClients.length);
</script>

{#if isConnected}
	<div class="connection-status">
		<span class="status-dot"></span>
		<span>{userCount} {userCount === 1 ? 'User' : 'Users'}</span>
	</div>
{/if}

<style lang="scss">
	.connection-status {
		position: absolute;
		bottom: 10px;
		right: 10px;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 6px;
		background-color: var(--toolbar-background-color);
		border: 2px solid var(--toolbar-border-color);
		border-radius: var(--rounded-border-radius);
		font-size: 12px;
		user-select: none;
		pointer-events: none;
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background-color: var(--connection-status-color);
	}
</style>
