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
		d="M 10 50
L 40 50
L 60 30
L 90 30

M 40 50
L 60 70
L 90 70

M 75 15 m 0 0 l 15 15 l -15 15
M 75 55 m 0 0 l 15 15 l -15 15"
		stroke={fill}
		stroke-width="6"
		fill="none"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>

</svg>