/**
 * Global utility functions
 */

/**
 * Generate a cryptographically secure random ID
 * @param byteLength Number of random bytes (default: 16 for 128-bit security)
 * @returns Hex string of random bytes
 */
export function generateSecureId(byteLength = 16): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Convert Uint8Array to Base64 string
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
	return bytes.toBase64();
}

/**
 * Convert Base64 string to Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
	return Uint8Array.fromBase64(base64);
}
