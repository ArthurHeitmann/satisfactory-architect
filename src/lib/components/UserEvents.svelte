<script lang="ts">
	import { roundToNearest, targetsInput } from "$lib/utilties";
	import type { Snippet } from "svelte";

	export interface DragEvent {
		deltaX: number;
		deltaY: number;
		totalDeltaX: number;
		totalDeltaY: number;
		cursorEvent: CursorEvent;
	}
	export interface CursorEvent {
		clientX: number;
		clientY: number;
		hasShiftKey: boolean;
		hasCtrlKey: boolean;
		hasMetaKey: boolean;
		hasAltKey: boolean;
		hasPrimaryButton: boolean;
		isSecondaryButton: boolean;
		isMiddleButton: boolean;
		isTouchEvent: boolean;
		target: EventTarget|null;
	}

	interface Props {
		children: Snippet<[{ listeners: Record<string, any>, isDragging: boolean }]>;
		id?: string;
		canStartDrag?: ((event: DragEvent) => boolean) | null;
		onDrag?: ((event: DragEvent) => void) | null;
		onDragStart?: ((event: DragEvent) => void) | null;
		onDragEnd?: ((event: DragEvent) => void) | null;
		onCursorDown?: ((event: CursorEvent) => void) | null;
		onWindowCursorUp?: ((event: CursorEvent) => void) | null;
		onCursorMove?: ((event: CursorEvent) => void) | null;
		onZoom?: ((deltaFactor: number, cursorX: number, cursorY: number) => void) | null;
		onClick?: ((event: CursorEvent) => void) | null;
		onWindowClick?: ((event: CursorEvent) => void) | null;
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
		id = undefined,
		canStartDrag = null,
		onDrag = null,
		onDragStart = null,
		onDragEnd = null,
		onCursorDown = null,
		onWindowCursorUp = null,
		onCursorMove = null,
		onZoom = null,
		onClick = null,
		onWindowClick = null,
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
	let dragStartButton: number = 0;

	function handleDragStart(clientX: number, clientY: number, event: MouseEvent | TouchEvent) {
		if (canStartDrag) {
			if (!canStartDrag({
				deltaX: 0,
				deltaY: 0,
				totalDeltaX: 0,
				totalDeltaY: 0,
				cursorEvent: eventToCursorEvent(event),
			})) {
				return;
			}
		}
		hasDragStarted = true;
		if (dragStartThreshold !== 0) {
			hasDragStarted = false;
		}
		isDragging = true;
		lastX = clientX;
		lastY = clientY;
		startX = clientX;
		startY = clientY;
		dragStartButton = event instanceof MouseEvent ? event.button : 0;
		if (hasDragStarted) {
			event.stopPropagation();
			onDragStart?.({
				deltaX: 0,
				deltaY: 0,
				totalDeltaX: 0,
				totalDeltaY: 0,
				cursorEvent: eventToCursorEvent(event),
			});
			onClick?.(eventToCursorEvent(event));
		}
	}

	function handleDrag(clientX: number, clientY: number, event: MouseEvent | TouchEvent) {
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
			onDragStart?.({
				deltaX: 0,
				deltaY: 0,
				totalDeltaX: 0,
				totalDeltaY: 0,
				cursorEvent: eventToCursorEvent(event, dragStartButton),
			});
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
				cursorEvent: eventToCursorEvent(event, dragStartButton),
			});
		}
	}

	function handleDragEnd(event: UIEvent) {
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
			cursorEvent: eventToCursorEvent(event, dragStartButton),
		});
	}
	
	function handleZoom(deltaFactor: number, cursorX: number, cursorY: number) {
		if (!onZoom)
			return;
		onZoom?.(deltaFactor, cursorX, cursorY);
	}

	function handleCursorMove(event: MouseEvent | TouchEvent) {
		if (!onCursorMove)
			return;
		event.stopPropagation();
		onCursorMove(eventToCursorEvent(event));
	}


	function handleMouseDown(event: MouseEvent) {
		if (!onDrag && !onCursorDown)
			return;
		if (targetsInput(event) && event.button !== 1)
			return;
		if (event.button === 1) {
			if (!allowMiddleClickDrag)
				return;
		}
		else if (event.button === 2) {
			if (!allowRightClickDrag)
				return;
			event.preventDefault();
		}
		else if (event.button !== 0) {
			return;
		}
		event.stopPropagation();
		if (onCursorDown) {
			onCursorDown(eventToCursorEvent(event, event.button));
		}
		if (onDrag) {
			handleDragStart(event.clientX, event.clientY, event);
		}
	}

	function handleMouseMove(event: MouseEvent) {
		handleCursorMove(event);
		if (!isDragging)
			return;
		handleDrag(event.clientX, event.clientY, event);
	}

	function handleMouseUp(event: UIEvent) {
		if (onWindowCursorUp) {
			onWindowCursorUp(eventToCursorEvent(event));
		}
		if (!isDragging)
			return;
		handleDragEnd(event);
	}

	function handleTouchStart(event: TouchEvent) {
		if (targetsInput(event))
			return;
		lastTouchAt = Date.now();
		if (!onDrag && !onZoom && !onCursorDown)
			return;
		event.stopPropagation();
		event.preventDefault();
		if (event.touches.length === 1) {
			if (onCursorDown) {
				onCursorDown(eventToCursorEvent(event));
			}
			if (onDrag) {
				handleDragStart(event.touches[0].clientX, event.touches[0].clientY, event);
			}
		} else if (event.touches.length >= 2) {
			lastPinchDistance = getPinchDistance(event.touches);
			const center = getTouchCenter(event.touches);
			lastX = center.x;
			lastY = center.y;
		}
	}

	function handleTouchMove(event: TouchEvent) {
		if (onCursorMove && event.touches.length === 1) {
			handleCursorMove(event);
		}
		if (!isDragging)
			return;
		if (event.touches.length === 1 && isDragging) {
			event.stopPropagation();
			event.preventDefault();
			lastTouchAt = Date.now();
			handleDrag(event.touches[0].clientX, event.touches[0].clientY, event);
		} else if (event.touches.length >= 2 && lastPinchDistance > 0) {
			if (!onZoom)
				return;
			event.stopPropagation();;
			event.preventDefault();
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
					cursorEvent: eventToCursorEvent(event),
				});
			}
			lastX = center.x;
			lastY = center.y;
		}
	}

	function handleTouchEnd(event: UIEvent|TouchEvent) {
		if (onWindowCursorUp) {
			onWindowCursorUp(eventToCursorEvent(event));
		}
		if (!isDragging)
			return;
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
				cursorEvent: eventToCursorEvent(event),
			});
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (targetsInput(event))
			return;
		onKeyDown?.(event.key, event);
		if (event.key === "Escape" && isDragging) {
			event.stopPropagation();
			handleMouseUp(event);
			handleTouchEnd(event);
		}
	}

	function handleClick(event: MouseEvent) {
		if (!onClick)
			return;
		if (targetsInput(event))
			return;
		event.stopPropagation();
		if (Math.abs(Date.now() - lastDragAt) < 20) {
			return;
		}
		onClick(eventToCursorEvent(event));
		handleWindowClick(event);
	}

	function handleWindowClick(event: MouseEvent) {
		if (!onWindowClick)
			return;
		event.stopPropagation();
		onWindowClick(eventToCursorEvent(event));
	}

	function handleDoubleClick(event: MouseEvent) {
		if (!onDoubleClick)
			return;
		if (targetsInput(event))
			return;
		onDoubleClick(event, isTouchEvent());
	}

	function getPinchDistance(touches: TouchList): number {
		const dx = touches[0].clientX - touches[1].clientX;
		const dy = touches[0].clientY - touches[1].clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function getTouchCenter(touches: TouchList): { x: number; y: number } {
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

	function eventToCursorEvent(event: MouseEvent | TouchEvent | UIEvent, button?: number): CursorEvent {
		if (!(event instanceof MouseEvent) && !(event instanceof TouchEvent)) {
			return {
				clientX: lastX,
				clientY: lastY,
				hasShiftKey: false,
				hasCtrlKey: false,
				hasMetaKey: false,
				hasAltKey: false,
				hasPrimaryButton: event instanceof MouseEvent && (button ?? event.button) === 0,
				isSecondaryButton: event instanceof MouseEvent && (button ?? event.button) === 2,
				isMiddleButton: event instanceof MouseEvent && (button ?? event.button) === 1,
				isTouchEvent: false,
				target: event.target,
			};
		}
		return {
			clientX: event instanceof MouseEvent ? event.clientX : event.touches[0]?.clientX ?? lastX,
			clientY: event instanceof MouseEvent ? event.clientY : event.touches[0]?.clientY ?? lastY,
			hasShiftKey: event.shiftKey,
			hasCtrlKey: event.ctrlKey,
			hasMetaKey: event.metaKey,
			hasAltKey: event.altKey,
			hasPrimaryButton: event instanceof MouseEvent && (button ?? event.button) === 0,
			isSecondaryButton: event instanceof MouseEvent && (button ?? event.button) === 2,
			isMiddleButton: event instanceof MouseEvent && (button ?? event.button) === 1,
			isTouchEvent: isTouchEvent(),
			target: event.target,
		};
	}

	const listeners = $derived({
		onmousedown: onDrag || onCursorDown ? handleMouseDown : undefined,
		ontouchstart: onDrag || onCursorDown ? handleTouchStart : undefined,
		onwheel: onZoom ? handleWheel : undefined,
		onclick: onClick ? handleClick : undefined,
		oncontextmenu: onContextMenu,
		ondblclick: onDoubleClick ? handleDoubleClick : undefined,
	});
</script>

{@render children({ listeners, isDragging })}

<svelte:window
	onmousemove={onDrag || onCursorMove ? handleMouseMove : undefined}
	onmouseup={onDrag || onWindowCursorUp ? handleMouseUp : undefined}
	on:touchmove|nonpassive={onDrag || onZoom || onCursorMove ? handleTouchMove : undefined}
	ontouchend={onDrag || onWindowCursorUp ? handleTouchEnd : undefined}
	ontouchcancel={onDrag || onWindowCursorUp ? handleTouchEnd : undefined}
	onkeydown={onDrag || onKeyDown ? handleKeyDown : undefined}
	onclick={onWindowClick ? handleWindowClick : undefined}
/>
