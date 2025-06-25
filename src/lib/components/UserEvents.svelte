<script lang="ts">
    import { floorToNearest, roundToNearest } from "$lib/utilties";
    import type { Snippet } from "svelte";

	export interface DragEvent {
		deltaX: number;
		deltaY: number;
		totalDeltaX: number;
		totalDeltaY: number;
		clientX: number;
		clientY: number;
		isTouchEvent: boolean;
	}
	export interface ClickEvent {
		clientX: number;
		clientY: number;
		hasShiftKey: boolean;
		hasCtrlKey: boolean;
		hasMetaKey: boolean;
		hasAltKey: boolean;
		hasPrimaryButton: boolean;
		isSecondaryButton: boolean;
		isMiddleButton: boolean;
		target: EventTarget | null;
	}

	interface Props {
		children: Snippet<[{ listeners: Record<string, any>, isDragging: boolean }]>;
		onDrag?: ((event: DragEvent) => void) | null;
		onDragStart?: ((event: DragEvent) => void) | null;
		onDragEnd?: ((event: DragEvent) => void) | null;
		onZoom?: ((deltaFactor: number, cursorX: number, cursorY: number) => void) | null;
		onClick?: ((event: ClickEvent) => void) | null;
		onContextMenu?: ((event: MouseEvent) => void) | null;
		onDoubleClick?: ((event: MouseEvent, isTouchEvent: boolean) => void) | null;
		onKeyDown?: ((key: string, event: KeyboardEvent) => void) | null;
		allowMiddleClickDrag?: boolean;
		allowRightClickDrag?: boolean;
		allowMultiTouchDrag?: boolean;
		dragStartThreshold?: number;
		dragThreshold?: number;
		dragStep?: number;
	}

	let {
		children,
		onDrag = null,
		onDragStart = null,
		onDragEnd = null,
		onZoom = null,
		onClick = null,
		onContextMenu = null,
		onDoubleClick = null,
		onKeyDown = null,
		allowMiddleClickDrag = false,
		allowRightClickDrag = false,
		allowMultiTouchDrag = false,
		dragStartThreshold = 0,
		dragThreshold = 0,
		dragStep = 0,
	}: Props = $props();

	let isDragging: boolean = $state(false);
	let hasDragStarted: boolean = false;
	let startX: number = 0;
	let startY: number = 0;
	let lastX: number = 0;
	let lastY: number = 0;
	let lastPinchDistance: number = 0;
	let lastTouchAt: number = 0;
	let lastDragAt: number = 0;
	const id = Math.random().toString(36).substring(2, 15);

	function handleDragStart(clientX: number, clientY: number, event: MouseEvent | TouchEvent) {
		hasDragStarted = dragStartThreshold > 0;
		isDragging = true;
		lastX = clientX;
		lastY = clientY;
		startX = clientX;
		startY = clientY;
		onDragStart?.({
			deltaX: 0,
			deltaY: 0,
			totalDeltaX: 0,
			totalDeltaY: 0,
			clientX,
			clientY,
			isTouchEvent: isTouchEvent(),
		});
		onClick?.(eventToClickEvent(event));
	}

	function handleDrag(clientX: number, clientY: number, event: Event) {
		if (!isDragging)
			return;
		event.stopPropagation();
		const deltaX = clientX - lastX;
		const deltaY = clientY - lastY;
		const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
		if (!hasDragStarted) {
			if (distance < dragStartThreshold)
				return;
			hasDragStarted = true;
		}
		if (distance < dragThreshold)
			return;
		const deltaXStep = roundToNearest(deltaX, dragStep);
		const deltaYStep = roundToNearest(deltaY, dragStep);
		lastX += deltaXStep;
		lastY += deltaYStep;
		lastDragAt = Date.now();
		if (deltaXStep !== 0 || deltaYStep !== 0) {
			onDrag?.({
				deltaX: deltaXStep,
				deltaY: deltaYStep,
				totalDeltaX: lastX - startX,
				totalDeltaY: lastY - startY,
				clientX: lastX,
				clientY: lastY,
				isTouchEvent: isTouchEvent(),
			});
		}
	}

	function handleDragEnd(event: Event) {
		if (!isDragging)
			return;
		event.stopPropagation();
		isDragging = false;
		lastDragAt = Date.now();
		if (!hasDragStarted)
			return;
		onDragEnd?.({
			deltaX: lastX - startX,
			deltaY: lastY - startY,
			totalDeltaX: lastX - startX,
			totalDeltaY: lastY - startY,
			clientX: lastX,
			clientY: lastY,
			isTouchEvent: isTouchEvent(),
		});
	}
	
	function handleZoom(deltaFactor: number, cursorX: number, cursorY: number) {
		if (!onZoom)
			return;
		onZoom?.(deltaFactor, cursorX, cursorY);
	}



	function handleMouseDown(event: MouseEvent) {
		if (!onDrag)
			return;
		event.stopPropagation();
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
		handleDragStart(event.clientX, event.clientY, event);
	}

	function handleMouseMove(event: MouseEvent) {
		handleDrag(event.clientX, event.clientY, event);
	}

	function handleMouseUp(event: Event) {
		handleDragEnd(event);
	}

	function handleTouchStart(event: TouchEvent) {
		lastTouchAt = Date.now();
		if (!onDrag && !onZoom)
			return;
		event.stopPropagation();
		if (event.touches.length === 1) {
			handleDragStart(event.touches[0].clientX, event.touches[0].clientY, event);
		} else if (event.touches.length >= 2) {
			lastPinchDistance = getPinchDistance(event.touches);
			const center = getTouchCenter(event.touches);
			lastX = center.x;
			lastY = center.y;
		}
	}

	function handleTouchMove(event: TouchEvent) {
		if (event.touches.length === 1 && isDragging) {
			event.stopPropagation();
			event.preventDefault();
			lastTouchAt = Date.now();
			handleDrag(event.touches[0].clientX, event.touches[0].clientY, event);
		} else if (event.touches.length >= 2 && lastPinchDistance > 0) {
			if (!onZoom)
				return;
			event.stopPropagation();
			const currentPinchDistance = getPinchDistance(event.touches);
			const deltaFactor = currentPinchDistance / lastPinchDistance;
			lastPinchDistance = currentPinchDistance;
			const center = getTouchCenter(event.touches);
			handleZoom(deltaFactor, center.x, center.y);
			if (allowMultiTouchDrag) {
				const deltaX = center.x - lastX;
				const deltaY = center.y - lastY;
				onDrag?.({
					deltaX,
					deltaY,
					totalDeltaX: deltaX,
					totalDeltaY: deltaY,
					clientX: center.x,
					clientY: center.y,
					isTouchEvent: isTouchEvent(),
				});
			}
			lastX = center.x;
			lastY = center.y;
			event.preventDefault();
		}
	}

	function handleTouchEnd(event: Event|TouchEvent) {
		if ("touches" in event && event.touches.length > 0) {
			if (isDragging) {
				const center = getTouchCenter(event.touches);
				lastX = center.x;
				lastY = center.y;
			}
			return;
		}
		if (isDragging) {
			handleDragEnd(event);
		}
		lastPinchDistance = 0;
	}

	function handleWheel(event: WheelEvent) {
		if (!onZoom)
			return;
		event.stopPropagation();
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
			onDrag?.({
				deltaX: -event.deltaX,
				deltaY: -event.deltaY,
				totalDeltaX: -event.deltaX,
				totalDeltaY: -event.deltaY,
				clientX: event.clientX,
				clientY: event.clientY,
				isTouchEvent: isTouchEvent(),
			});
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		onKeyDown?.(event.key, event);
		if (event.key === 'Escape' && isDragging) {
			event.stopPropagation();
			handleMouseUp(event);
			handleTouchEnd(event);
		}
	}

	function handleClick(event: MouseEvent) {
		if (!onClick)
			return;
		event.stopPropagation();
		if (Date.now() - lastDragAt === 0) {
			return;
		}
		onClick(eventToClickEvent(event));
	}

	function handleDoubleClick(event: MouseEvent) {
		if (!onDoubleClick)
			return;
		onDoubleClick(event, isTouchEvent());
	}

	function getPinchDistance(touches: TouchList): number {
		const dx = touches[0].clientX - touches[1].clientX;
		const dy = touches[0].clientY - touches[1].clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function getTouchCenter(touches: TouchList): { x: number; y: number } {
		// const x = (touches[0].clientX + touches[1].clientX) / 2;
		// const y = (touches[0].clientY + touches[1].clientY) / 2;
		let x = 0;
		let y = 0;
		for (let i = 0; i < touches.length; i++) {
			x += touches[i].clientX;
			y += touches[i].clientY;
		}
		return { x: x / touches.length, y: y / touches.length };
	}

	function isTouchEvent(): boolean {
		return Date.now() - lastTouchAt < 500;
	};

	function eventToClickEvent(event: MouseEvent | TouchEvent): ClickEvent {
		return {
			clientX: event instanceof MouseEvent ? event.clientX : event.touches[0].clientX,
			clientY: event instanceof MouseEvent ? event.clientY : event.touches[0].clientY,
			hasShiftKey: event.shiftKey,
			hasCtrlKey: event.ctrlKey,
			hasMetaKey: event.metaKey,
			hasAltKey: event.altKey,
			hasPrimaryButton: event instanceof MouseEvent && event.button === 0,
			isSecondaryButton: event instanceof MouseEvent && event.button === 2,
			isMiddleButton: event instanceof MouseEvent && event.button === 1,
			target: event.target,
		};
	}

	const listeners = {
		onmousedown: onDrag ? handleMouseDown : undefined,
		ontouchstart: onDrag ? handleTouchStart : undefined,
		onwheel: onZoom ? handleWheel : undefined,
		onclick: onClick ? handleClick : undefined,
		oncontextmenu: onContextMenu,
		ondblclick: onDoubleClick ? handleDoubleClick : undefined,
	};
</script>

{@render children({ listeners, isDragging })}

<svelte:window
	onmousemove={onDrag ? handleMouseMove : undefined}
	onmouseup={onDrag ? handleMouseUp : undefined}
	on:touchmove|nonpassive={onDrag || onZoom ? handleTouchMove : undefined}
	ontouchend={onDrag ? handleTouchEnd : undefined}
	ontouchcancel={onDrag ? handleTouchEnd : undefined}
	onkeydown={onDrag || onKeyDown ? handleKeyDown : undefined}
/>
