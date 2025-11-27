/**
 * JSON compression utilities for reducing WebSocket payload sizes
 */

import type { CompressionMethod } from "./EnvironmentConfig.ts";
import { ErrorCode } from "./types_shared.ts";
import { AppError } from "./errors/AppError.ts";

/**
 * Wrapper for compressed data with method indicator
 */
export interface CompressedData {
	method: CompressionMethod;
	data: Uint8Array;
}

// Compression interface for pluggable implementations
export interface CompressionProvider {
	getMethod(): CompressionMethod;
	compress(data: Uint8Array): Uint8Array;
	decompress(compressed: Uint8Array): Uint8Array;
}

// Simple fallback compression (identity - no compression)
export class NoCompressionProvider implements CompressionProvider {
	getMethod(): CompressionMethod {
		return "none";
	}

	compress(data: Uint8Array): Uint8Array {
		return data;
	}

	decompress(compressed: Uint8Array): Uint8Array {
		return compressed;
	}
}

/**
 * JSON compression service
 */
export class CompressionService {
	constructor(
		private provider: CompressionProvider = new NoCompressionProvider(),
		private compressionThreshold: number = 500,
	) {}

	/**
	 * Compress object to JSON bytes with method wrapper
	 */
	public compressJSON(obj: unknown): CompressedData {
		const json = JSON.stringify(obj);
		const bytes = new TextEncoder().encode(json);

		// Skip compression for small payloads
		if (bytes.length < this.compressionThreshold) {
			return {
				method: "none",
				data: bytes,
			};
		}

		try {
			return {
				method: this.provider.getMethod(),
				data: this.provider.compress(bytes),
			};
		} catch (error) {
			// Wrap compression error with context
			throw AppError.wrap(
				error,
				ErrorCode.INTERNAL_ERROR,
				{
					operation: "compressJSON",
					method: this.provider.getMethod(),
					dataSize: bytes.length,
				},
				"Failed to compress JSON data",
			);
		}
	}

	/**
	 * Decompress wrapped data to object
	 */
	public decompressJSON(compressed: CompressedData): unknown {
		try {
			// Check if method matches provider (warn if mismatch for "none")
			if (compressed.method === "none") {
				// No decompression needed
				const json = new TextDecoder().decode(compressed.data);
				return JSON.parse(json);
			}

			// Verify provider can handle this compression method
			if (compressed.method !== this.provider.getMethod()) {
				throw new AppError(
					ErrorCode.INTERNAL_ERROR,
					{
						operation: "decompressJSON",
						expectedMethod: this.provider.getMethod(),
						actualMethod: compressed.method,
					},
					`Cannot decompress data: compression method '${compressed.method}' does not match provider '${this.provider.getMethod()}'`,
				);
			}

			const bytes = this.provider.decompress(compressed.data);
			const json = new TextDecoder().decode(bytes);
			return JSON.parse(json);
		} catch (error) {
			// If it's already an AppError, just rethrow
			if (error instanceof AppError) {
				throw error;
			}
			// Wrap other errors (JSON parse, decode errors, etc.)
			throw AppError.wrap(
				error,
				ErrorCode.INTERNAL_ERROR,
				{ operation: "decompressJSON", method: compressed.method },
				"Failed to decompress JSON data",
			);
		}
	}

	/**
	 * Get compression statistics
	 */
	public getCompressionRatio(
		original: unknown,
		compressed: CompressedData,
	): number {
		const originalBytes = new TextEncoder().encode(
			JSON.stringify(original),
		);
		return compressed.data.length / originalBytes.length;
	}
}

// TODO: Implement LZ4CompressionProvider when LZ4 library is available
// export class LZ4CompressionProvider implements CompressionProvider {
//     compress(data: Uint8Array): Uint8Array {
//         return LZ4.compress(data);
//     }
//
//     decompress(compressed: Uint8Array): Uint8Array {
//         return LZ4.decompress(compressed);
//     }
// }
