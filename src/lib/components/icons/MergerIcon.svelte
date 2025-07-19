<script lang="ts">
	interface Props {
		x?: number;
		y?: number;
		size: number;
		fill: string;
	}
	const {
		x,
		y,
		size,
		fill = "black"
	}: Props = $props();
</script>

<svg x={x} y={y} width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
	<path
		d="M 10 20 l 25 0 L 50 50 L 90 50 M 10 80 l 25 0 L 50 50 M 75 35 l 15 15 l -15 15"
		stroke={fill}
		stroke-width="6"
		fill="none"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>

</svg>