import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { CommandBuffer } from "./CommandBuffer.ts";
import type { Command, ObjectAddCommand, ObjectModifyCommand, PageAddCommand } from "../../shared/types_shared.ts";

// Command presets for reuse across tests
const createObjectAddCommand = (id: string, timestamp: number): ObjectAddCommand => ({
	commandId: id,
	userId: "u1",
	timestamp,
	type: "object.add",
	pageId: "page-1",
	objectId: `node-${id}`,
	objectType: "node",
	data: { id: `node-${id}` },
});

const createObjectModifyCommand = (id: string, timestamp: number, data: Record<string, unknown>): ObjectModifyCommand => ({
	commandId: id,
	userId: "u1",
	timestamp,
	type: "object.modify",
	pageId: "page-1",
	objectType: "node",
	objectId: "node-1",
	data,
});

const createPageAddCommand = (id: string, timestamp: number): PageAddCommand => ({
	commandId: id,
	userId: "u1",
	timestamp,
	type: "page.add",
	pageId: "page-1",
	data: {
		version: 1,
		type: "graph-page",
		id: "page-1",
		name: "New Page",
		nodes: {},
		edges: {},
	},
});

describe("CommandBuffer", () => {
	let flushedCommands: Command[];
	let flushCount: number;
	let buffer: CommandBuffer;

	beforeEach(() => {
		flushedCommands = [];
		flushCount = 0;
	});

	afterEach(() => {
		if (buffer) {
			buffer.dispose();
		}
	});

	describe("basic buffering", () => {
		beforeEach(() => {
			buffer = new CommandBuffer(
				{ bufferTimeMs: 50, maxBatchSize: 5 },
				(commands) => {
					flushedCommands = commands;
					flushCount++;
				},
			);
		});

		it("starts with empty buffer", () => {
			assertEquals(buffer.getBufferSize(), 0);
		});

		it("buffers single command", () => {
			const command = createObjectAddCommand("cmd-1", 1000);

			buffer.addCommands([command]);
			assertEquals(buffer.getBufferSize(), 1);
			assertEquals(flushCount, 0);
		});

		it("buffers multiple commands", () => {
			const commands = [
				createObjectAddCommand("cmd-1", 1000),
				createObjectModifyCommand("cmd-2", 1001, { name: "Updated" }),
			];

			buffer.addCommands(commands);
			assertEquals(buffer.getBufferSize(), 2);
			assertEquals(flushCount, 0);
		});
	});

	describe("batch size flushing", () => {
		beforeEach(() => {
			buffer = new CommandBuffer(
				{ bufferTimeMs: 1000, maxBatchSize: 3 },
				(commands) => {
					flushedCommands = commands;
					flushCount++;
				},
			);
		});

		it("does not flush below batch size", () => {
			const commands = [
				createObjectAddCommand("cmd-1", 1000),
				createObjectAddCommand("cmd-2", 1001),
			];

			buffer.addCommands(commands);
			assertEquals(buffer.getBufferSize(), 2);
			assertEquals(flushCount, 0);
		});

		it("flushes when batch size is reached", () => {
			const commands = [
				createObjectAddCommand("cmd-1", 1000),
				createObjectAddCommand("cmd-2", 1001),
				createObjectAddCommand("cmd-3", 1002),
			];

			buffer.addCommands(commands);
			assertEquals(buffer.getBufferSize(), 0);
			assertEquals(flushCount, 1);
			assertEquals(flushedCommands.length, 3);
		});

		it("flushes when batch size is exceeded", () => {
			const commands = Array.from({ length: 5 }, (_, i) => 
				createObjectAddCommand(`cmd-${i}`, 1000 + i)
			);

			buffer.addCommands(commands);
			assertEquals(buffer.getBufferSize(), 0);
			assertEquals(flushCount, 1);
			assertEquals(flushedCommands.length, 5);
		});

		it("handles multiple batch flushes", () => {
			const firstBatch = [
				createObjectAddCommand("cmd-1", 1000),
				createObjectAddCommand("cmd-2", 1001),
				createObjectAddCommand("cmd-3", 1002),
			];

			buffer.addCommands(firstBatch);
			assertEquals(flushCount, 1);
			assertEquals(flushedCommands.length, 3);

			const secondBatch = [
				createObjectAddCommand("cmd-4", 1003),
				createObjectAddCommand("cmd-5", 1004),
				createObjectAddCommand("cmd-6", 1005),
			];

			buffer.addCommands(secondBatch);
			assertEquals(flushCount, 2);
			assertEquals(flushedCommands.length, 3);
			assertEquals(flushedCommands[0].commandId, "cmd-4");
		});
	});

	describe("time-based flushing", () => {
		beforeEach(() => {
			buffer = new CommandBuffer(
				{ bufferTimeMs: 50, maxBatchSize: 100 },
				(commands) => {
					flushedCommands = commands;
					flushCount++;
				},
			);
		});

		it("not flushed before buffer time elapses", () => {
			using time = new FakeTime();

			buffer.addCommands([createObjectAddCommand("cmd-1", 1000)]);
			assertEquals(buffer.getBufferSize(), 1);
			assertEquals(flushCount, 0);

			// Advance time but not enough to trigger flush
			time.tick(49);
			assertEquals(buffer.getBufferSize(), 1);
			assertEquals(flushCount, 0);
		});

		it("flushes after buffer time elapses", () => {
			using time = new FakeTime();

			buffer.addCommands([createObjectAddCommand("cmd-1", 1000)]);
			assertEquals(buffer.getBufferSize(), 1);
			assertEquals(flushCount, 0);

			// Advance time to trigger flush
			time.tick(50);
			assertEquals(buffer.getBufferSize(), 0);
			assertEquals(flushCount, 1);
			assertEquals(flushedCommands.length, 1);
		});

		it("flushes all commands after initial timer expires", () => {
			using time = new FakeTime();

			buffer.addCommands([createObjectAddCommand("cmd-1", 1000)]);
			time.tick(30);
			assertEquals(flushCount, 0);
			assertEquals(buffer.getBufferSize(), 1);

			// Add second command before timer expires
			buffer.addCommands([createObjectAddCommand("cmd-2", 1001)]);
			assertEquals(buffer.getBufferSize(), 2);

			// Complete the initial 50ms - should flush both commands
			time.tick(20);
			assertEquals(buffer.getBufferSize(), 0);
			assertEquals(flushCount, 1);
			assertEquals(flushedCommands.length, 2);

			// Verify no additional flushes occur
			time.tick(100);
			assertEquals(flushCount, 1);
		});
	});

	describe("command ordering", () => {
		beforeEach(() => {
			buffer = new CommandBuffer(
				{ bufferTimeMs: 1000, maxBatchSize: 10 },
				(commands) => {
					flushedCommands = commands;
					flushCount++;
				},
			);
		});

		it("sorts commands by timestamp on flush", () => {
			const commands = [
				createObjectAddCommand("cmd-3", 3000),
				createObjectAddCommand("cmd-1", 1000),
				createObjectAddCommand("cmd-2", 2000),
			];

			buffer.addCommands(commands);
			buffer.flush();

			assertEquals(flushedCommands.length, 3);
			assertEquals(flushedCommands[0].commandId, "cmd-1");
			assertEquals(flushedCommands[0].timestamp, 1000);
			assertEquals(flushedCommands[1].commandId, "cmd-2");
			assertEquals(flushedCommands[1].timestamp, 2000);
			assertEquals(flushedCommands[2].commandId, "cmd-3");
			assertEquals(flushedCommands[2].timestamp, 3000);
		});
	});

	describe("manual flushing", () => {
		beforeEach(() => {
			buffer = new CommandBuffer(
				{ bufferTimeMs: 1000, maxBatchSize: 100 },
				(commands) => {
					flushedCommands = commands;
					flushCount++;
				},
			);
		});

		it("manual flush empties buffer", () => {
			const commands = [
				createObjectAddCommand("cmd-1", 1000),
				createObjectAddCommand("cmd-2", 1001),
			];

			buffer.addCommands(commands);
			assertEquals(buffer.getBufferSize(), 2);

			buffer.flush();
			assertEquals(buffer.getBufferSize(), 0);
			assertEquals(flushCount, 1);
			assertEquals(flushedCommands.length, 2);
		});

		it("flush on empty buffer does nothing", () => {
			buffer.flush();
			assertEquals(flushCount, 0);
			assertEquals(flushedCommands.length, 0);
		});

		it("multiple manual flushes work correctly", () => {
			buffer.addCommands([createObjectAddCommand("cmd-1", 1000)]);
			buffer.flush();
			assertEquals(flushCount, 1);
			assertEquals(flushedCommands[0].commandId, "cmd-1");

			buffer.addCommands([createObjectAddCommand("cmd-2", 1001)]);
			buffer.flush();
			assertEquals(flushCount, 2);
			assertEquals(flushedCommands[0].commandId, "cmd-2");
		});
	});

	describe("clear and dispose", () => {
		beforeEach(() => {
			buffer = new CommandBuffer(
				{ bufferTimeMs: 1000, maxBatchSize: 100 },
				(commands) => {
					flushedCommands = commands;
					flushCount++;
				},
			);
		});

		it("clear empties buffer without flushing", () => {
			using time = new FakeTime();

			const commands = [
				createObjectAddCommand("cmd-1", 1000),
				createObjectAddCommand("cmd-2", 1001),
			];

			buffer.addCommands(commands);
			assertEquals(buffer.getBufferSize(), 2);

			buffer.clear();
			assertEquals(buffer.getBufferSize(), 0);
			assertEquals(flushCount, 0);

			// Advance time to ensure no flush occurs
			time.tick(1100);
			assertEquals(flushCount, 0);
		});

		it("dispose clears buffer and cancels timer", () => {
			using time = new FakeTime();

			buffer.addCommands([createObjectAddCommand("cmd-1", 1000)]);
			assertEquals(buffer.getBufferSize(), 1);

			buffer.dispose();
			assertEquals(buffer.getBufferSize(), 0);

			// Advance time to ensure timer doesn't fire
			time.tick(1100);
			assertEquals(flushCount, 0);
		});
	});

	describe("mixed command types", () => {
		beforeEach(() => {
			buffer = new CommandBuffer(
				{ bufferTimeMs: 1000, maxBatchSize: 10 },
				(commands) => {
					flushedCommands = commands;
					flushCount++;
				},
			);
		});

		it("handles different command types correctly", () => {
			const commands: Command[] = [
				createPageAddCommand("cmd-1", 1000),
				createObjectAddCommand("cmd-2", 1001),
				createObjectModifyCommand("cmd-3", 1002, { name: "Updated Node" }),
			];

			buffer.addCommands(commands);
			buffer.flush();

			assertEquals(flushedCommands.length, 3);
			assertEquals(flushedCommands[0].type, "page.add");
			assertEquals(flushedCommands[1].type, "object.add");
			assertEquals(flushedCommands[2].type, "object.modify");
		});
	});
});
