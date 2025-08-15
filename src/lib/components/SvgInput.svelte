<script lang="ts">
	interface Props {
		value: string;
		onChange?: (value: string) => void;
		onEnter?: (value: string) => void;
		isEditable?: boolean;
		width: number;
		height: number;
		x: number;
		y: number;
		textAlign?: "left" | "center" | "right";
		fontSize?: number;
	}
	let {
		value,
		onChange,
		onEnter,
		isEditable = false,
		width,
		height,
		x,
		y,
		textAlign = "left",
		fontSize = 14
	}: Props = $props();

	let inputElement: HTMLDivElement | null = $state(null);

	const justifyContentMapping : Record<string, string> = {
		left: "flex-start",
		center: "center",
		right: "flex-end"
	};
</script>

<foreignObject
	x={x}
	y={y}
	width={width}
	height={height}
>
	<div class="wrapper" style="width: {width}px; height: {height}px; --content-align: {justifyContentMapping[textAlign]};">
		{#if isEditable}
			<div
				class="svg-input"
				style="font-size: {fontSize}px; text-align: {textAlign}; line-height: {height}px;"
				oninput={(event) => {
					const value = (event.target as HTMLDivElement).textContent || "";
					onChange?.(value);
				}}
				onkeydown={(e) => {
					if (e.key === "Enter" || e.key === "Escape") {
						onEnter?.(value);
						window.getSelection()?.removeAllRanges();
						e.preventDefault();
					}
				}}
				onblur={() => {
					onEnter?.(value);
					window.getSelection()?.removeAllRanges();
				}}
				contenteditable="plaintext-only"
				bind:this={inputElement}
				bind:textContent={value}
			>
			</div>
		{:else}
			<div
				class="svg-input"
				style="font-size: {fontSize}px; pointer-events: none; text-align: {textAlign}; line-height: {height}px;"
			>
				{value}
			</div>
		{/if}
	</div>
</foreignObject>


<style lang="scss">
	.wrapper {
		display: flex;
		align-items: center;
		justify-content: var(--content-align);
	}

	.svg-input {
		cursor: text;
		display: block;
		height: 100%;
		color: var(--node-editable-text-color);
		padding: 0 3px;
		// box-shadow:
		// 	0 0 1px rgba(0, 0, 0, 1.0),
		// 	0 0 2px rgba(0, 0, 0, 1.0),
		// 	0 0 3px rgba(0, 0, 0, 1.0);
		// filter:
		// 	drop-shadow(0 0 1px rgba(0, 0, 0, 1.0))
		// 	drop-shadow(0 0 2px rgba(0, 0, 0, 0.5))
		// 	drop-shadow(0 0 3px rgba(0, 0, 0, 0.25));
		text-shadow: var(--text-shadow);
	}
</style>