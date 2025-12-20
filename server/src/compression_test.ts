/**
 * CompressionService unit tests
 */

import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
	CompressionService,
	type CompressionProvider,
} from "./compression.ts";

/** Simple mock compression provider that reverses bytes */
function createMockProvider(method: "lz4" | "zstd"): CompressionProvider {
	return {
		getMethod: () => method,
		compress: (data: Uint8Array) => data.slice().reverse(),
		decompress: (data: Uint8Array) => data.slice().reverse(),
	};
}

describe("CompressionService", () => {
	describe("initialization", () => {
		it("should start with 'none' as default method", () => {
			const service = new CompressionService();
			assertEquals(service.getDefaultMethod(), "none");
		});

		it("should have 'none' in supported methods", () => {
			const service = new CompressionService();
			assertEquals(service.getSupportedMethods(), ["none"]);
		});
	});

	describe("compressJSON / decompressJSON", () => {
		it("should compress and decompress small objects without compression", () => {
			const service = new CompressionService();
			const obj = { hello: "world" };

			const compressed = service.compressJSON(obj);
			assertEquals(compressed.method, "none");

			const decompressed = service.decompressJSON(compressed);
			assertEquals(decompressed, obj);
		});

		it("should roundtrip complex objects", () => {
			const service = new CompressionService();
			const obj = {
				pages: [{ id: "p1", name: "Page 1", nodes: [1, 2, 3] }],
				settings: { theme: "dark", scale: 1.5 },
			};

			const compressed = service.compressJSON(obj);
			const decompressed = service.decompressJSON(compressed);
			assertEquals(decompressed, obj);
		});
	});

	describe("custom providers", () => {
		it("should register and use custom provider", () => {
			const service = new CompressionService(0); // threshold 0 to always compress
			const mockProvider = createMockProvider("lz4");

			service.registerProvider(mockProvider);
			service.setDefaultMethod("lz4");

			assertEquals(service.getDefaultMethod(), "lz4");
			assertEquals(service.getSupportedMethods().includes("lz4"), true);

			const obj = { test: "data" };
			const compressed = service.compressJSON(obj);
			assertEquals(compressed.method, "lz4");

			const decompressed = service.decompressJSON(compressed);
			assertEquals(decompressed, obj);
		});

		it("should throw when setting unregistered method as default", () => {
			const service = new CompressionService();

			assertThrows(
				() => service.setDefaultMethod("lz4"),
				Error,
				"provider not registered",
			);
		});
	});

	describe("compression threshold", () => {
		it("should skip compression for data below threshold", () => {
			const service = new CompressionService(1000);
			service.registerProvider(createMockProvider("lz4"));
			service.setDefaultMethod("lz4");

			const smallObj = { a: 1 };
			const compressed = service.compressJSON(smallObj);

			// Should use "none" because data is small
			assertEquals(compressed.method, "none");
		});

		it("should compress data above threshold", () => {
			const service = new CompressionService(10); // Very low threshold
			service.registerProvider(createMockProvider("lz4"));
			service.setDefaultMethod("lz4");

			const largeObj = { data: "this is definitely more than 10 bytes" };
			const compressed = service.compressJSON(largeObj);

			assertEquals(compressed.method, "lz4");
		});
	});
});
