/**
 * WebSocket message middleware for handling compression negotiation and message encoding/decoding
 * 
 * Protocol:
 * - "init:{...}" - Handshake message with supported compression methods
 * - "comp:XXXX:<binary>" - Compressed message (XXXX = 4-char method)
 * - "none" method is special - just sends/receives raw JSON strings
 * - String messages as uncompressed JSON
 */

import type { CompressionMethod, ICompressionService } from "./CompressionService.ts";


interface InitMessage {
	supported_compression_methods: CompressionMethod[];
}

export class WebSocketMessageMiddleware {
	private initSent = false;
	private initReceived = false;
	private negotiatedMethod: CompressionMethod | null = null;
	private remoteSupported: CompressionMethod[] = [];

	constructor(
		private compression: ICompressionService,
	) {}

	sendInit(): string {
		this.initSent = true;
		if (this.initReceived)
			this.negotiate();
		const initData: InitMessage = {
			supported_compression_methods: this.compression.getSupportedMethods(),
		};
		return `init:${JSON.stringify(initData)}`;
	}

	async processIncomingMessage(data: string | Uint8Array): Promise<unknown | null> {
		const isString = typeof data === "string";

		if (isString) {
			if (data.startsWith("init:")) {
				if (this.initReceived)
					throw new Error("Duplicate init");
				const initData = JSON.parse(data.slice(5)) as InitMessage;
				this.remoteSupported = initData.supported_compression_methods;
				this.initReceived = true;
				if (this.initSent)
					this.negotiate();
				return null;
			}
			return JSON.parse(data);
		}
		else {
			const prefix = new TextDecoder().decode(data.slice(0, 10));
			if (prefix.startsWith("comp:")) {
				const method = prefix.slice(5, 9).trim() as CompressionMethod;
				if (method !== this.negotiatedMethod) throw new Error("Method mismatch");
	
				return await this.compression.decompressJSON({
					method,
					data: data.slice(10),
				});
			}
			
			const messageStr = new TextDecoder().decode(data);
			return JSON.parse(messageStr);
		}
	}

	async prepareOutgoingMessage(message: unknown): Promise<string | Uint8Array> {
		if (!this.isHandshakeComplete()) {
			return JSON.stringify(message);
		}

		if (this.negotiatedMethod === "none") {
			return JSON.stringify(message);
		}

		const result = await this.compression.compressJSON(message, this.negotiatedMethod!);
		if (result.method === "none") {
			return result.data;
		}

		const prefix = new TextEncoder().encode(`comp:${result.method.padEnd(4, " ").slice(0, 4)}:`);
		const combined = new Uint8Array(prefix.length + result.data.length);
		combined.set(prefix);
		combined.set(result.data, prefix.length);
		return combined;
	}

	getNegotiatedMethod(): CompressionMethod | null {
		return this.negotiatedMethod;
	}

	isHandshakeComplete(): boolean {
		return this.initSent && this.initReceived && this.negotiatedMethod !== null;
	}

	reset(): void {
		this.initSent = false;
		this.initReceived = false;
		this.negotiatedMethod = null;
		this.remoteSupported = [];
	}

	private negotiate(): void {
		const common = this.compression.getSupportedMethods()
			.filter(m =>m !== "none" && this.remoteSupported.includes(m));
		if (common.length === 0)
			this.negotiatedMethod = "none";
		else
			this.negotiatedMethod = common[0];
	}
}
