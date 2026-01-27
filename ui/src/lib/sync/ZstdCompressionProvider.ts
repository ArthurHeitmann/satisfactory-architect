/**
 * JSON compression utilities for reducing WebSocket payload sizes
 */

import { init, compress, decompress } from '@bokuweb/zstd-wasm';
import type { CompressionMethod, CompressionProvider } from "../../../../server/shared/CompressionService.ts";


let zstdInitialized: Promise<void> | null = null;

async function ensureZstdInitialized(): Promise<void> {
	if (!zstdInitialized) {
		zstdInitialized = init();
	}
	await zstdInitialized;
}

export class ZstdCompressionProvider implements CompressionProvider {
	getMethod(): CompressionMethod {
		return "zstd";
	}

	async compress(data: Uint8Array): Promise<Uint8Array> {
		await ensureZstdInitialized();
		return compress(data, 1);
	}

	async decompress(compressed: Uint8Array): Promise<Uint8Array> {
		await ensureZstdInitialized();
		return decompress(compressed);
	}
}
