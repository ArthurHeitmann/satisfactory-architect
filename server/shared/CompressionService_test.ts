/**
 * CompressionService unit tests
 */

import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { CompressionProvider, CompressionService } from "./CompressionService.ts";
import { ZstdCompressionProvider } from "../src/ZstdCompressionProvider.ts";

/** Simple mock compression provider that reverses bytes */
function createMockProvider(method: "zstd"): CompressionProvider {
	return {
		getMethod: () => method,
		compress: (data: Uint8Array) => Promise.resolve(data.slice().reverse()),
		decompress: (data: Uint8Array) => Promise.resolve(data.slice().reverse()),
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
		it("should compress and decompress small objects without compression", async () => {
			const service = new CompressionService();
			const obj = { hello: "world" };

			const compressed = await service.compressJSON(obj);
			assertEquals(compressed.method, "none");

			const decompressed = await service.decompressJSON(compressed);
			assertEquals(decompressed, obj);
		});

		it("should roundtrip complex objects", async () => {
			const service = new CompressionService();
			const obj = {
				pages: [{ id: "p1", name: "Page 1", nodes: [1, 2, 3] }],
				settings: { theme: "dark", scale: 1.5 },
			};

			const compressed = await service.compressJSON(obj);
			const decompressed = await service.decompressJSON(compressed);
			assertEquals(decompressed, obj);
		});
	});

	describe("custom providers", () => {
		it("should register and use custom provider", async () => {
			const service = new CompressionService(0); // threshold 0 to always compress
			const mockProvider = createMockProvider("zstd");

			service.registerProvider(mockProvider);
			service.setDefaultMethod("zstd");

			assertEquals(service.getDefaultMethod(), "zstd");
			assertEquals(service.getSupportedMethods().includes("zstd"), true);

			const obj = { test: "data" };
			const compressed = await service.compressJSON(obj);
			assertEquals(compressed.method, "zstd");

			const decompressed = await service.decompressJSON(compressed);
			assertEquals(decompressed, obj);
		});

		it("should throw when setting unregistered method as default", () => {
			const service = new CompressionService();

			assertThrows(
				() => service.setDefaultMethod("zstd"),
				Error,
				"unsupported method",
			);
		});
	});

	describe("compression threshold", () => {
		it("should skip compression for data below threshold", async () => {
			const service = new CompressionService(1000);
			service.registerProvider(createMockProvider("zstd"));
			service.setDefaultMethod("zstd");

			const smallObj = { a: 1 };
			const compressed = await service.compressJSON(smallObj);

			// Should use "none" because data is small
			assertEquals(compressed.method, "none");
		});

		it("should compress data above threshold", async () => {
			const service = new CompressionService(10); // Very low threshold
			service.registerProvider(createMockProvider("zstd"));
			service.setDefaultMethod("zstd");

			const largeObj = { data: "this is definitely more than 10 bytes" };
			const compressed = await service.compressJSON(largeObj);

			assertEquals(compressed.method, "zstd");
		});
	});

	describe("zstd provider", () => {
		it("should compress and decompress data correctly", async () => {
			const service = new CompressionService(0);
			const zstdProvider = new ZstdCompressionProvider();
			service.registerProvider(zstdProvider);
			service.setDefaultMethod("zstd");
			const obj = { sample: "data for zstd compression" };

			const compressed = await service.compressJSON(obj);
			assertEquals(compressed.method, "zstd");
			const decompressed = await service.decompressJSON(compressed);
			assertEquals(decompressed, obj);
		});
	});
});
