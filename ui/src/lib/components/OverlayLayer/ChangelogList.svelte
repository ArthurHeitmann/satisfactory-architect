<script lang="ts">
	import type { ChangelogEntry } from "$lib/datamodel/constants";
	import Self from "./ChangelogList.svelte";

	interface Props {
		items: ChangelogEntry[];
	}
	const { items }: Props = $props();
</script>

<ul class="change-list">
	{#each items as item}
		{#if typeof item === "string"}
			<li class="change-item">{item}</li>
		{:else}
			<li class="change-item">
				{item.text}
				{#if item.items?.length}
					<Self items={item.items} />
				{/if}
			</li>
		{/if}
	{/each}
</ul>

<style lang="scss">
	.change-list {
		margin: 0;
		padding-left: 20px;
		list-style-type: disc;
	}

	.change-item {
		margin-bottom: 4px;
		color: var(--text-muted);
		line-height: 1.4;
	}

	.change-item > :global(ul) {
		margin-top: 6px;
	}
</style>
