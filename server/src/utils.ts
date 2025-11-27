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
