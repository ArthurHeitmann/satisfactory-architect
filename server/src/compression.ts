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
	data: Uint8Array | number[];
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
 * Compression service interface for dependency injection
 */
export interface ICompressionService {
	registerProvider(provider: CompressionProvider): void;
	setDefaultMethod(method: CompressionMethod): void;
	getDefaultMethod(): CompressionMethod;
	getSupportedMethods(): CompressionMethod[];
	compressJSON(obj: unknown): CompressedData;
	decompressJSON(compressed: CompressedData): unknown;
}

/**
 * JSON compression service with support for multiple compression methods
 */
export class CompressionService implements ICompressionService {
	private providers: Map<CompressionMethod, CompressionProvider>;
	private defaultMethod: CompressionMethod;

	constructor(
		private compressionThreshold: number = 500,
	) {
		this.providers = new Map();
		
		// Always register the "none" provider for backward compatibility
		const noneProvider = new NoCompressionProvider();
		this.providers.set("none", noneProvider);
		this.defaultMethod = "none";
	}

	/**
	 * Register a compression provider for a specific method
	 * Allows adding support for new compression methods without breaking existing data
	 */
	public registerProvider(provider: CompressionProvider): void {
		const method = provider.getMethod();
		this.providers.set(method, provider);
	}

	/**
	 * Set the default compression method to use for new compressions
	 */
	public setDefaultMethod(method: CompressionMethod): void {
		if (!this.providers.has(method)) {
			throw new AppError(
				ErrorCode.INTERNAL_ERROR,
				{ method, availableMethods: Array.from(this.providers.keys()) },
				`Cannot set default compression method '${method}': provider not registered`,
			);
		}
		this.defaultMethod = method;
	}

	/**
	 * Get the current default compression method
	 */
	public getDefaultMethod(): CompressionMethod {
		return this.defaultMethod;
	}

	/**
	 * Get list of supported compression methods
	 */
	public getSupportedMethods(): CompressionMethod[] {
		return Array.from(this.providers.keys());
	}

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

		// Get the provider for the default method
		const provider = this.providers.get(this.defaultMethod);
		if (!provider) {
			throw new AppError(
				ErrorCode.INTERNAL_ERROR,
				{ method: this.defaultMethod },
				`Compression provider not found for method '${this.defaultMethod}'`,
			);
		}

		try {
			return {
				method: this.defaultMethod,
				data: provider.compress(bytes),
			};
		} catch (error) {
			// Wrap compression error with context
			throw AppError.wrap(
				error,
				ErrorCode.INTERNAL_ERROR,
				{
					operation: "compressJSON",
					method: this.defaultMethod,
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
			let data: Uint8Array;
			if (compressed.data instanceof Uint8Array) {
				data = compressed.data;
			} else {
				data = new Uint8Array(compressed.data);
			}

			// Handle uncompressed data
			if (compressed.method === "none") {
				const json = new TextDecoder().decode(data);
				return JSON.parse(json);
			}

			// Look up the provider for the compression method used
			const provider = this.providers.get(compressed.method);
			if (!provider) {
				throw new AppError(
					ErrorCode.INTERNAL_ERROR,
					{
						operation: "decompressJSON",
						requiredMethod: compressed.method,
						availableMethods: Array.from(this.providers.keys()),
					},
					`Cannot decompress data: no provider registered for compression method '${compressed.method}'`,
				);
			}

			const bytes = provider.decompress(data);
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
