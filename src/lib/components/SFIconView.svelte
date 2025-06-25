<script lang="ts">
	import { base } from '$app/paths'
    import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";

	interface Props {
		icon: string;
		quality?: "max"|"min";
		size?: number;
		x?: number;
		y?: number;
	}
	const {
		icon,
		quality = "max",
		size,
		x = undefined,
		y = undefined,
	}: Props = $props();

	const iconData = $derived(satisfactoryDatabase.icons[icon]);
	const resolution = $derived(quality === "max" ? iconData?.resolutions.at(0) : iconData?.resolutions.at(-1));
	const isInSvg = $derived(x !== undefined && y !== undefined);
</script>

{#if isInSvg}
	<image
		class="sf-icon-view"
		href={`${base}/img/FactoryGame/${iconData?.name}_${resolution}.webp`}
		x={x}
		y={y}
		width={size}
		height={size}
	/>
{:else}
	<img
		class="sf-icon-view"
		src={`${base}/img/FactoryGame/${iconData?.name}_${resolution}.webp`}
		width={size}
		height={size}
		alt={iconData?.name}
		loading="lazy"
	/>
{/if}
