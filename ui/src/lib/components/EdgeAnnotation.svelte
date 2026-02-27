<script lang="ts">
	import { untrack } from "svelte";

	interface Props {
		x: number;
		y: number;
		text: string;
		color: string;
		textColor?: string;
		align?: "left" | "center" | "right";
		fontSize?: number;
		fontWeight?: number;
		paddingX?: number;
		borderRadius?: number;
		onClick?: () => void;
	}

	const {
		x,
		y,
		text,
		color,
		textColor = "var(--edge-background-color-text)",
		align = "center",
		fontSize = 9,
		fontWeight = 500,
		paddingX = 4,
		borderRadius = 5,
		onClick,
	}: Props = $props();

	let textElement: SVGTextElement | undefined = $state();
	let bbox = $state({ width: 0, height: 0 });

	const textAnchor = $derived.by(() => {
		if (align === "left") return "start";
		if (align === "right") return "end";
		return "middle";
	});

	const fixedHeight = 13;

	const rectX = $derived.by(() => {
		if (align === "left") return x;
		if (align === "right") return x - bbox.width - paddingX * 2;
		return x - bbox.width / 2 - paddingX;
	});

	const textX = $derived.by(() => {
		if (align === "left") return x + paddingX;
		if (align === "right") return x - paddingX;
		return x;
	});

	const rectY = $derived(y - fixedHeight / 2);
	const rectWidth = $derived(bbox.width + paddingX * 2);
	const rectHeight = fixedHeight;

	$effect(() => {
		void text;
		void fontSize;
		void fontWeight;
		
		untrack(() => {
			if (textElement) {
				const box = textElement.getBBox();
				bbox = { width: box.width, height: box.height };
			}
		});
	});

	function handleClick(e: MouseEvent | TouchEvent) {
		if (onClick) {
			e.stopPropagation();
			if (e instanceof MouseEvent && e.button !== 0) return;
			onClick();
		}
	}
</script>

<g
	class="svg-label"
	class:clickable={Boolean(onClick)}
	onmousedown={onClick ? handleClick : undefined}
	ontouchstart={onClick ? handleClick : undefined}
>
	<rect
		x={rectX}
		y={rectY}
		width={rectWidth}
		height={rectHeight}
		rx={borderRadius}
		ry={borderRadius}
		fill={color}
	/>
	<text
		bind:this={textElement}
		x={textX}
		{y}
		text-anchor={textAnchor}
		dominant-baseline="central"
		fill={textColor}
		style="font-size: {fontSize}px; font-weight: {fontWeight};"
	>
		{text}
	</text>
</g>

<style lang="scss">
	.svg-label {
		pointer-events: none;

		&.clickable {
			pointer-events: all;
			cursor: pointer !important;

			&:hover rect {
				filter: brightness(1.1);
			}
		}

		text {
			user-select: none;
		}
	}
</style>
