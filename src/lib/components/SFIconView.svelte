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
		const preview = iconPreviews[icon];
		if (preview) {
			return preview;
		}
		return "";
	});
	const showOriginal = $derived.by(() => {
		return quality === "max" || !imagePreviewSrc;
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
	{#if showOriginal}
		<image
			href={imageSrc}
			x={x}
			y={y}
			width={size}
			height={size}
			onload={onImageLoad}
		/>
	{/if}
{:else}
	<div class="wrapper" style="width: {size}px; height: {size}px;">
		{#if showPreview}
			<img
				class="preview"
				src={imagePreviewSrc}
				width={size}
				height={size}
				loading="lazy"
			/>
		{/if}
		{#if showOriginal}
			<img
				src={imageSrc}
				width={size}
				height={size}
				loading="lazy"
				onload={onImageLoad}
			/>
		{/if}
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
