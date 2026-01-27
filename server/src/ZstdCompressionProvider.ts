/**
 * JSON compression utilities for reducing WebSocket payload sizes
 */

import * as zstd from "@mongodb-js/zstd";
import { Buffer } from "node:buffer";
import { CompressionMethod, CompressionProvider } from "../shared/CompressionService.ts";


export class ZstdCompressionProvider implements CompressionProvider {
	getMethod(): CompressionMethod {
		return "zstd";
	}

	compress(data: Uint8Array): Promise<Uint8Array> {
		return zstd.compress(Buffer.from(data), 1);
	}

	decompress(compressed: Uint8Array): Promise<Uint8Array> {
		return zstd.decompress(Buffer.from(compressed));
	}
}
