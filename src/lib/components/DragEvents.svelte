<script lang="ts">
	interface DragEventsProps {
		children: any;
		onDrag?: ((deltaX: number, deltaY: number) => void) | null;
		onZoom?: ((deltaFactor: number, cursorX: number, cursorY: number) => void) | null;
		allowMiddleClickDrag?: boolean;
		allowRightClickDrag?: boolean;
		allowMultiTouchDrag?: boolean;
	}

	let {
		children,
		onDrag = null,
		onZoom = null,
		allowMiddleClickDrag = false,
		allowRightClickDrag = false,
		allowMultiTouchDrag = false
	}: DragEventsProps = $props();

	let wrapper: HTMLElement;

	let isDragging: boolean = false;
	let startX: number = 0;
	let startY: number = 0;
	let lastX: number = 0;
	let lastY: number = 0;
	let lastPinchDistance: number = 0;

	function handleMouseDown(event: MouseEvent) {
		if (!onDrag)
			return;
		if (event.button === 1) {
			if (!allowMiddleClickDrag)
				return;
		}
		else if (event.button === 2) {
			if (!allowRightClickDrag)
				return;
		}
		else if (event.button !== 0) {
			return;
		}
		isDragging = true;
		startX = event.clientX;
		startY = event.clientY;
		lastX = event.clientX;
		lastY = event.clientY;
	}

	function handleMouseMove(event: MouseEvent) {
		if (!isDragging)
			return;
		const deltaX = event.clientX - lastX;
		const deltaY = event.clientY - lastY;
		onDrag?.(deltaX, deltaY);
		lastX = event.clientX;
		lastY = event.clientY;
	}

	function handleMouseUp() {
		if (!isDragging)
			return;
		isDragging = false;
	}

	function handleTouchStart(event: TouchEvent) {
		if (!onDrag && !onZoom)
			return;
		if (event.touches.length === 1) {
			isDragging = true;
			startX = event.touches[0].clientX;
			startY = event.touches[0].clientY;
			lastX = event.touches[0].clientX;
			lastY = event.touches[0].clientY;
		} else if (event.touches.length === 2) {
			lastPinchDistance = getPinchDistance(event.touches);
			const center = getTouchCenter(event.touches);
			startX = center.x;
			startY = center.y;
			lastX = center.x;
			lastY = center.y;
		}
	}

	function handleTouchMove(event: TouchEvent) {
		if (event.touches.length === 1 && isDragging) {
			const deltaX = event.touches[0].clientX - lastX;
			const deltaY = event.touches[0].clientY - lastY;
			onDrag?.(deltaX, deltaY);
			lastX = event.touches[0].clientX;
			lastY = event.touches[0].clientY;
			event.preventDefault();
		} else if (event.touches.length === 2 && lastPinchDistance > 0) {
			if (!onZoom)
				return;
			const currentPinchDistance = getPinchDistance(event.touches);
			const deltaFactor = currentPinchDistance / lastPinchDistance;
			lastPinchDistance = currentPinchDistance;
			const center = getTouchCenter(event.touches);
			handleZoom(deltaFactor, center.x, center.y);
			if (allowMultiTouchDrag) {
				const deltaX = center.x - lastX;
				const deltaY = center.y - lastY;
				onDrag?.(deltaX, deltaY);
			}
			lastX = center.x;
			lastY = center.y;
			event.preventDefault();
		}
	}

	function handleTouchEnd() {
		if (isDragging) {
			isDragging = false;
		}
		lastPinchDistance = 0;
	}

	function getPinchDistance(touches: TouchList): number {
		const dx = touches[0].clientX - touches[1].clientX;
		const dy = touches[0].clientY - touches[1].clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function getTouchCenter(touches: TouchList): { x: number; y: number } {
		const x = (touches[0].clientX + touches[1].clientX) / 2;
		const y = (touches[0].clientY + touches[1].clientY) / 2;
		return { x, y };
	}

	function handleWheel(event: WheelEvent) {
		if (!onZoom)
			return;
		event.preventDefault();
		if (event.ctrlKey || Math.abs(event.deltaY) >= 50) {
			let deltaFactor: number;
			if (event.ctrlKey) {
				deltaFactor = -event.deltaY / 100 + 1;
			}
			else {
				deltaFactor = -event.deltaY > 0 ? 1.1 : 0.9;
			}
			handleZoom(deltaFactor, event.clientX, event.clientY);
		}
		else {
			onDrag?.(-event.deltaX, -event.deltaY);
		}
	}
	
	function handleZoom(deltaFactor: number, cursorX: number, cursorY: number) {
		if (!onZoom)
			return;
		const rect = wrapper.getBoundingClientRect();
		const cx = cursorX - rect.left;
		const cy = cursorY - rect.top;
		onZoom?.(deltaFactor, cx, cy);
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape' && isDragging) {
			handleMouseUp();
			handleTouchEnd();
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={wrapper}
	onmousedown={handleMouseDown}
	ontouchstart={handleTouchStart}
	onwheel={handleWheel}
>
	{@render children()}
</div>

<svelte:window
	onmousemove="{handleMouseMove}"
	onmouseup="{handleMouseUp}"
	on:touchmove|nonpassive="{handleTouchMove}"
	ontouchend="{handleTouchEnd}"
	ontouchcancel="{handleTouchEnd}"
	onkeydown="{handleKeyDown}"
/>

<style>
	div {
		width: 100%;
		height: 100%;
		touch-action: none;
	}
</style>
