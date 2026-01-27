/**
 * Tests for WebSocketMessageMiddleware
 */

import { assertEquals, assertRejects } from "@std/assert";
import { WebSocketMessageMiddleware } from "./WebSocketMessageMiddleware.ts";
import { CompressionMethod, CompressionProvider, CompressionService } from "./CompressionService.ts";

// Dummy provider for testing
class MockZstdProvider implements CompressionProvider {
	getMethod(): CompressionMethod { return "zstd"; }
	compress(data: Uint8Array): Promise<Uint8Array> { return Promise.resolve(data); }
	decompress(data: Uint8Array): Promise<Uint8Array> { return Promise.resolve(data); }
}

function createMiddleware(methods: CompressionMethod[] = ["zstd", "none"]) {
	const service = new CompressionService(0); // 0 threshold = always compress if not "none"
	if (methods.includes("zstd")) {
		service.registerProvider(new MockZstdProvider());
		service.setDefaultMethod("zstd");
	} else {
		service.setDefaultMethod("none");
	}
	return new WebSocketMessageMiddleware(service);
}

Deno.test("WebSocketMessageMiddleware - handshake and negotiation", async () => {
	const local = createMiddleware(["zstd", "none"]);
	const remote = createMiddleware(["zstd", "none"]);

	const localInit = local.sendInit();
	const remoteInit = remote.sendInit();

	assertEquals(localInit.startsWith("init:"), true);
	assertEquals(remoteInit.startsWith("init:"), true);

	const localResult = await local.processIncomingMessage(remoteInit);
	const remoteResult = await remote.processIncomingMessage(localInit);

	assertEquals(localResult, null);
	assertEquals(remoteResult, null);

	assertEquals(local.getNegotiatedMethod(), "zstd");
	assertEquals(local.isHandshakeComplete(), true);
});

Deno.test("WebSocketMessageMiddleware - fallback to none compression", async () => {
	const service = new CompressionService(0);
	service.registerProvider(new MockZstdProvider());
	service.setDefaultMethod("zstd");
	
	const local = new WebSocketMessageMiddleware(service);
	local.sendInit();
	
	const remoteInit = `init:${JSON.stringify({ supported_compression_methods: ["deflate"] })}`;
	await local.processIncomingMessage(remoteInit);
	assertEquals(local.getNegotiatedMethod(), "none");
});

Deno.test("WebSocketMessageMiddleware - allow pre-handshake JSON", async () => {
	const middleware = createMiddleware();
	const msg = { test: 1 };
	const processed = await middleware.processIncomingMessage(JSON.stringify(msg));
	assertEquals(processed, msg);
	
	const prepared = await middleware.prepareOutgoingMessage(msg);
	assertEquals(JSON.parse(prepared as string), msg);
});

Deno.test("WebSocketMessageMiddleware - message transformation", async () => {
	const local = createMiddleware(["zstd", "none"]);
	const remote = createMiddleware(["zstd", "none"]);
	await local.processIncomingMessage(remote.sendInit());
	await remote.processIncomingMessage(local.sendInit());

	const msg = { foo: "bar" };
	const transformed = await local.prepareOutgoingMessage(msg);

	// Should be binary due to "zstd" negotiation and 0 threshold
	assertEquals(transformed instanceof Uint8Array, true);
	const prefix = new TextDecoder().decode((transformed as Uint8Array).slice(0, 10));
	assertEquals(prefix, "comp:zstd:");

	const received = await remote.processIncomingMessage(transformed);
	assertEquals(received, msg);
});

Deno.test("WebSocketMessageMiddleware - allows raw JSON even if compressed is negotiated", async () => {
	const local = createMiddleware(["zstd", "none"]);
	const remote = createMiddleware(["zstd", "none"]);
	await local.processIncomingMessage(remote.sendInit());
	await remote.processIncomingMessage(local.sendInit());

	const msg = { raw: "json" };
	const received = await local.processIncomingMessage(JSON.stringify(msg));
	assertEquals(received, msg);
});

Deno.test("WebSocketMessageMiddleware - verifies method in comp prefix", async () => {
	const local = createMiddleware(["zstd", "none"]);
	const remote = createMiddleware(["zstd", "none"]);
	await local.processIncomingMessage(remote.sendInit());
	await remote.processIncomingMessage(local.sendInit());

	// Construct a message with WRONG method in prefix
	const prefix = new TextEncoder().encode("comp:none:");
	const msg = new Uint8Array([...prefix, ...new TextEncoder().encode("{}")]);

	await assertRejects(() => local.processIncomingMessage(msg), Error, "Method mismatch");
});

