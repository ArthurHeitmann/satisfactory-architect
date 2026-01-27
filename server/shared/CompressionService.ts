
export type CompressionMethod = "none" | "zstd";

// Compression interface for pluggable implementations
export interface CompressionProvider {
	getMethod(): CompressionMethod;
	compress(data: Uint8Array): Promise<Uint8Array>;
	decompress(compressed: Uint8Array): Promise<Uint8Array>;
}

/**
 * Compression service interface for dependency injection
 */
export interface ICompressionService {
	registerProvider(provider: CompressionProvider): void;
	setDefaultMethod(method: CompressionMethod): void;
	getDefaultMethod(): CompressionMethod;
	getSupportedMethods(): CompressionMethod[];
	compressJSON(obj: unknown, method?: CompressionMethod): Promise<CompressedData>;
	decompressJSON(compressed: CompressedData): Promise<unknown>;
}

export interface CompressedData {
	method: CompressionMethod;
	data: Uint8Array;
}

// Simple fallback compression (identity - no compression)
export class NoCompressionProvider implements CompressionProvider {
	getMethod(): CompressionMethod {
		return "none";
	}

	compress(data: Uint8Array): Promise<Uint8Array> {
		return Promise.resolve(data);
	}

	decompress(compressed: Uint8Array): Promise<Uint8Array> {
		return Promise.resolve(compressed);
	}
}

/**
 * JSON compression service with support for multiple compression methods
 */
export class CompressionService implements ICompressionService {
	private providers: Map<CompressionMethod, CompressionProvider>;
	private defaultMethod: CompressionMethod;

	constructor(
		private compressionThreshold: number = 200,
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
			throw Error(`Cannot set default compression method to unsupported method '${method}'`);
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
	 * Check if a compression method is supported
	 */
	public isMethodSupported(method: CompressionMethod): boolean {
		return this.providers.has(method);
	}

	/**
	 * Compress object to JSON bytes with method wrapper
	 */
	public async compressJSON(obj: unknown, method?: CompressionMethod): Promise<CompressedData> {
		const json = JSON.stringify(obj);
		const bytes = new TextEncoder().encode(json);
		method ??= this.defaultMethod;

		if (bytes.length < this.compressionThreshold) {
			return {
				method: "none",
				data: bytes,
			};
		}

		const provider = this.providers.get(method);
		if (!provider) {
			throw Error(`Compression provider not found for method '${method}'`);
		}

		const compressed = await provider.compress(bytes);
		return {
			method,
			data: compressed,
		};
	}

	/**
	 * Decompress wrapped data to object
	 */
	public async decompressJSON(compressed: CompressedData): Promise<unknown> {
		let data: Uint8Array;
		if (compressed.data instanceof Uint8Array) {
			data = compressed.data;
		} else {
			data = new Uint8Array(compressed.data);
		}

		if (compressed.method === "none") {
			const json = new TextDecoder().decode(data);
			return JSON.parse(json);
		}

		const provider = this.providers.get(compressed.method);
		if (!provider) {
			throw new Error(`No provider for compression method '${compressed.method}'`);
		}

		const bytes = await provider.decompress(data);
		const json = new TextDecoder().decode(bytes);
		return JSON.parse(json);
	}
}
