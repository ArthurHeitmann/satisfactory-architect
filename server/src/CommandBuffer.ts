/**
 * Command buffering and batching for collaborative operations
 */

import type { Command } from "./types_shared.ts";

export interface CommandBufferConfig {
	bufferTimeMs: number; // How long to buffer commands (50ms default)
	maxBatchSize: number; // Maximum commands per batch (100 default)
}

/**
 * Buffers commands for efficient batch processing
 */
export class CommandBuffer {
	private buffer: Command[] = [];
	private flushTimer: number | null = null;

	constructor(
		private config: CommandBufferConfig,
		private onFlush: (commands: Command[]) => void,
	) {}

	/**
	 * Add command to buffer
	 */
	public addCommand(command: Command): void {
		this.buffer.push(command);

		// Check if we should flush immediately
		if (this.buffer.length >= this.config.maxBatchSize) {
			this.flush();
		} else if (this.flushTimer === null) {
			this.scheduleFlush();
		}
	}

	/**
	 * Add multiple commands at once
	 */
	public addCommands(commands: Command[]): void {
		for (const command of commands) {
			this.addCommand(command);
		}
	}

	/**
	 * Force flush buffered commands immediately
	 */
	public flush(): void {
		if (this.buffer.length === 0) {
			return;
		}

		const commands = [...this.buffer];
		this.buffer.length = 0;
		this.clearFlushTimer();

		// Sort by timestamp for consistent ordering
		commands.sort((a, b) => a.timestamp - b.timestamp);

		this.onFlush(commands);
	}

	/**
	 * Get current buffer size
	 */
	public getBufferSize(): number {
		return this.buffer.length;
	}

	/**
	 * Clear all buffered commands without flushing
	 */
	public clear(): void {
		this.buffer.length = 0;
		this.clearFlushTimer();
	}

	/**
	 * Clean up resources
	 */
	public dispose(): void {
		this.clear();
	}

	/**
	 * Schedule flush after buffer time
	 */
	private scheduleFlush(): void {
		this.flushTimer = setTimeout(() => {
			this.flush();
		}, this.config.bufferTimeMs);
	}

	/**
	 * Clear flush timer
	 */
	private clearFlushTimer(): void {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
	}
}
