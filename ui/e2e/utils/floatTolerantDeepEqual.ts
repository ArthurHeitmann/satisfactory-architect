/**
 * Float-tolerant deep comparison of two values.
 *
 * Numbers within `epsilon` of each other are considered equal.
 * All other types (strings, booleans, null, objects, arrays) are compared exactly.
 *
 * On mismatch, returns a structured diff describing the first divergence found.
 */

export interface ComparisonDiff {
	/** JSON-path style location of the difference (e.g. ".pages[0].nodes.42.position.x"). */
	path: string;
	/** Value in the first operand. */
	a: unknown;
	/** Value in the second operand. */
	b: unknown;
	/** Human-readable description. */
	message: string;
}

export interface ComparisonResult {
	equal: boolean;
	diffs: ComparisonDiff[];
}

/**
 * Deeply compare two JSON-serializable values with float tolerance.
 *
 * @param a        First value
 * @param b        Second value
 * @param epsilon  Tolerance for floating-point comparison (default 1e-6)
 * @param maxDiffs Maximum number of diffs to collect before stopping (default 20)
 */
export function floatTolerantDeepEqual(
	a: unknown,
	b: unknown,
	epsilon: number = 1e-6,
	maxDiffs: number = 20,
): ComparisonResult {
	const diffs: ComparisonDiff[] = [];
	compare(a, b, "", diffs, epsilon, maxDiffs);
	return { equal: diffs.length === 0, diffs };
}

function compare(
	a: unknown,
	b: unknown,
	path: string,
	diffs: ComparisonDiff[],
	epsilon: number,
	maxDiffs: number,
): void {
	if (diffs.length >= maxDiffs) return;

	// Identical references or both nullish
	if (a === b) return;

	// Type check
	const typeA = typeOf(a);
	const typeB = typeOf(b);

	if (typeA !== typeB) {
		diffs.push({
			path,
			a,
			b,
			message: `Type mismatch: ${typeA} vs ${typeB}`,
		});
		return;
	}

	switch (typeA) {
		case "number": {
			const na = a as number;
			const nb = b as number;
			// Handle NaN
			if (Number.isNaN(na) && Number.isNaN(nb)) return;
			if (Math.abs(na - nb) > epsilon) {
				diffs.push({ path, a, b, message: `Number diff: ${na} vs ${nb} (delta: ${Math.abs(na - nb)})` });
			}
			return;
		}

		case "string":
		case "boolean":
			if (a !== b) {
				diffs.push({ path, a, b, message: `Value mismatch: ${JSON.stringify(a)} vs ${JSON.stringify(b)}` });
			}
			return;

		case "null":
			return; // both null, already handled by a === b above

		case "array": {
			const arrA = a as unknown[];
			const arrB = b as unknown[];
			if (arrA.length !== arrB.length) {
				diffs.push({ path, a: `length ${arrA.length}`, b: `length ${arrB.length}`, message: `Array length mismatch` });
			}
			const len = Math.min(arrA.length, arrB.length);
			for (let i = 0; i < len; i++) {
				if (diffs.length >= maxDiffs) return;
				compare(arrA[i], arrB[i], `${path}[${i}]`, diffs, epsilon, maxDiffs);
			}
			return;
		}

		case "object": {
			const objA = a as Record<string, unknown>;
			const objB = b as Record<string, unknown>;
			const keysA = Object.keys(objA).sort();
			const keysB = Object.keys(objB).sort();

			// Check for missing keys
			const setB = new Set(keysB);
			const setA = new Set(keysA);
			for (const key of keysA) {
				if (diffs.length >= maxDiffs) return;
				if (!setB.has(key)) {
					diffs.push({ path: `${path}.${key}`, a: objA[key], b: undefined, message: `Key missing in second object` });
				}
			}
			for (const key of keysB) {
				if (diffs.length >= maxDiffs) return;
				if (!setA.has(key)) {
					diffs.push({ path: `${path}.${key}`, a: undefined, b: objB[key], message: `Key missing in first object` });
				}
			}

			// Compare shared keys
			for (const key of keysA) {
				if (diffs.length >= maxDiffs) return;
				if (setB.has(key)) {
					compare(objA[key], objB[key], `${path}.${key}`, diffs, epsilon, maxDiffs);
				}
			}
			return;
		}

		default:
			diffs.push({ path, a, b, message: `Unsupported type: ${typeA}` });
	}
}

function typeOf(value: unknown): "null" | "array" | "object" | "number" | "string" | "boolean" | "undefined" | "other" {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (Array.isArray(value)) return "array";
	const t = typeof value;
	if (t === "object") return "object";
	if (t === "number") return "number";
	if (t === "string") return "string";
	if (t === "boolean") return "boolean";
	return "other";
}
