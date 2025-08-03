<script lang="ts">
	import { base } from '$app/paths'
    import { iconPreviews } from '$lib/iconPreviews';
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
    import { onMount } from 'svelte';

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

	let showPreview = $state(false);
	const iconData = $derived(satisfactoryDatabase.icons[icon]);
	const resolution = $derived(quality === "max" ? iconData?.resolutions.at(0) : iconData?.resolutions.at(-1));
	const isInSvg = $derived(x !== undefined && y !== undefined);
	const imageSrc = $derived.by(() => {
		if (!iconData) {
			return "";
		}
		return `${base}/img/FactoryGame/${iconData?.name}_${resolution}.webp`;
	});
	const imagePreviewSrc = $derived.by(() => {
		if (!iconData) {
			return "";
		}
		if (quality === "max") {
			const preview = iconPreviews[icon];
			if (preview) {
				return preview;
			}
		}
		return "";
	});

	onMount(() => {
		if (imagePreviewSrc) {
			showPreview = true;
		}
	});

	function onImageLoad() {
		if (imagePreviewSrc) {
			showPreview = false;
		}
	}

</script>

{#if isInSvg}
	{#if showPreview}
		<image
			href={imagePreviewSrc}
			x={x}
			y={y}
			width={size}
			height={size}
		/>
	{/if}
	<image
		href={imageSrc}
		x={x}
		y={y}
		width={size}
		height={size}
		onload={onImageLoad}
	/>
{:else}
	<div class="wrapper">
		{#if showPreview}
			<img
				class="preview"
				src={imagePreviewSrc}
				width={size}
				height={size}
				loading="lazy"
			/>
		{/if}
		<img
			src={imageSrc}
			width={size}
			height={size}
			loading="lazy"
			onload={onImageLoad}
		/>
	</div>
{/if}

<style lang="scss">
	.wrapper {
		position: relative;

		.preview {
			position: absolute;
		}
	}
</style>
