<script lang="ts">
	import type { ConfirmationPromptEvent, EventStream } from "$lib/EventStream.svelte";
	import { onDestroy, onMount } from "svelte";

	interface Props {
		event: ConfirmationPromptEvent;
		dismissEventStream: EventStream;
		onclose: () => void;
	}
	const {
		event,
		dismissEventStream,
		onclose,
	}: Props = $props();

	function onDismiss() {
		event.onAnswer(null);
		onclose();
	}

	function answerWith(value: boolean) {
		event.onAnswer(value);
		onclose();
	}

	onMount(() => {
		dismissEventStream.addListener(onDismiss);
	});

	onDestroy(() => {
		dismissEventStream.removeListener(onDismiss);
	});
</script>

<div class="background"></div>
<div class="prompt">
	<div class="message">{event.message}</div>
	<div class="buttons">
		<button class="confirm" onclick={() => answerWith(true)}>{event.confirmLabel ?? "Confirm"}</button>
		<button class="cancel" onclick={() => answerWith(false)}>{event.cancelLabel ?? "Cancel"}</button>
	</div>
</div>


<style lang="scss">
	.background {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-color: var(--popup-block-area-background-color);
		pointer-events: none;
	}

	.prompt {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background-color: var(--popup-background-color);
		border: 1px solid var(--popup-border-color);
		padding: 20px;
		border-radius: 8px;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
		text-align: center;
	}

	.message {
		margin-bottom: 20px;
		white-space: pre-line;
	}

	.buttons {
		display: flex;
		justify-content: center;
		gap: 10px;
	}

	button {
		background-color: var(--popup-button-background-color);
		padding: 10px 15px;
		border-radius: 4px;

		&:hover {
			background-color: var(--popup-button-hover-background-color);
		}

		&:active {
			background-color: var(--popup-button-active-background-color);
		}
	}
</style>
