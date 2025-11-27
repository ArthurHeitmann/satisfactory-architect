import { assertEquals } from "@std/assert";
import { CompressionService } from "./compression.ts";
import { CommandBuffer } from "./CommandBuffer.ts";
import type { Command, ObjectAddCommand, ObjectModifyCommand } from "./types_shared.ts";

Deno.test("CompressionService basic functionality", () => {
	const compression = new CompressionService();

	const testData = { message: "hello", count: 42 };
	const compressed = compression.compressJSON(testData);
	const decompressed = compression.decompressJSON(compressed);

	assertEquals(decompressed, testData);
});

Deno.test("CommandBuffer batching", () => {
	let flushedCommands: Command[] = [];

	const buffer = new CommandBuffer(
		{
			bufferTimeMs: 10,
			maxBatchSize: 2,
		},
		(commands) => {
			flushedCommands = commands;
		},
	);

	const command1: ObjectAddCommand = {
		commandId: "cmd-1",
		clientId: "u1",
		timestamp: Date.now(),
		type: "object.add",
		pageId: "page-1",
		objectId: "node-1",
		objectType: "node",
		data: { id: "node-1" },
	};

	const command2: ObjectModifyCommand = {
		commandId: "cmd-2",
		clientId: "u1",
		timestamp: Date.now() + 1,
		type: "object.modify",
		pageId: "page-1",
		objectId: "node-1",
		data: { position: { x: 10, y: 20 } },
	};

	buffer.addCommand(command1);
	assertEquals(buffer.getBufferSize(), 1);

	// Adding second command should trigger flush (maxBatchSize = 2)
	buffer.addCommand(command2);
	assertEquals(buffer.getBufferSize(), 0);
	assertEquals(flushedCommands.length, 2);
	assertEquals(flushedCommands[0].commandId, "cmd-1");
	assertEquals(flushedCommands[1].commandId, "cmd-2");

	buffer.dispose();
});
