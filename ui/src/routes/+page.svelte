<script lang="ts">
	import { browser } from "$app/environment";
    import AppStateView from "./AppStateView.svelte";

	const isBrowserSupported = (() => {
		if (!browser) {
			return true;
		}
		const set = new Set();
		const setValues = set.values();
		const supportsSetIterMap = typeof setValues?.map === "function";

		return supportsSetIterMap;
	})();

</script>

<svelte:head>
	<title>Satisfactory Architect</title>
	<meta name="description" content="A tool for planning, managing and visualizing Satisfactory factories." />
</svelte:head>

{#if isBrowserSupported}
	<AppStateView />
{:else}
	<div class="unsupported-browser">
		<p>
			This browser is not supported. Please update to a newer version.
		</p>
	</div>
{/if}

<style lang="scss">
	.unsupported-browser {
		width: 100%;
		height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2rem;
		font-weight: bold;
		text-align: center;
		background-color: black;
		color: rgb(224, 17, 17);
	}
</style>
