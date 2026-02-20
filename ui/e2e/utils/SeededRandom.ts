/**
 * Seeded pseudo-random number generator using the xoshiro128** algorithm.
 * All test randomness flows through this so that runs are fully reproducible
 * given the same seed.
 */
export class SeededRandom {
	private s: Uint32Array;

	/** Create a PRNG seeded from a 32-bit integer. */
	constructor(seed: number) {
		// SplitMix32 to expand the single seed into 4 state words
		this.s = new Uint32Array(4);
		for (let i = 0; i < 4; i++) {
			seed += 0x9e3779b9;
			let t = seed;
			t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
			t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
			this.s[i] = (t ^ (t >>> 15)) >>> 0;
		}
	}

	/** Create a PRNG from raw 4-word state (used by `fork`). */
	private static fromState(s: Uint32Array): SeededRandom {
		const rng = Object.create(SeededRandom.prototype) as SeededRandom;
		rng.s = new Uint32Array(s);
		return rng;
	}

	/** Return a new independent PRNG stream derived from this one. */
	fork(): SeededRandom {
		// Advance state twice and use results as a child seed
		const a = this.nextUint32();
		const b = this.nextUint32();
		const c = this.nextUint32();
		const d = this.nextUint32();
		const childState = new Uint32Array([a, b, c, d]);
		return SeededRandom.fromState(childState);
	}

	/** Raw 32-bit unsigned integer. */
	nextUint32(): number {
		const s = this.s;
		const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
		const t = (s[1] << 9) >>> 0;

		s[2] = (s[2] ^ s[0]) >>> 0;
		s[3] = (s[3] ^ s[1]) >>> 0;
		s[1] = (s[1] ^ s[2]) >>> 0;
		s[0] = (s[0] ^ s[3]) >>> 0;
		s[2] = (s[2] ^ t) >>> 0;
		s[3] = rotl(s[3], 11);

		return result;
	}

	/** Uniform float in [0, 1). */
	next(): number {
		return this.nextUint32() / 0x100000000;
	}

	/** Uniform integer in [min, max] (inclusive). */
	nextInt(min: number, max: number): number {
		return min + Math.floor(this.next() * (max - min + 1));
	}

	/** Uniform float in [min, max). */
	nextFloat(min: number, max: number): number {
		return min + this.next() * (max - min);
	}

	/** Pick a random element from a non-empty array. */
	pick<T>(arr: readonly T[]): T {
		if (arr.length === 0) throw new Error("Cannot pick from empty array");
		return arr[this.nextInt(0, arr.length - 1)];
	}

	/** Shuffle an array in-place (Fisher-Yates). */
	shuffle<T>(arr: T[]): T[] {
		for (let i = arr.length - 1; i > 0; i--) {
			const j = this.nextInt(0, i);
			[arr[i], arr[j]] = [arr[j], arr[i]];
		}
		return arr;
	}

	/** Generate a random seed value (for creating a new run). */
	static randomSeed(): number {
		return (Math.random() * 0xffffffff) >>> 0;
	}
}

function rotl(x: number, k: number): number {
	return ((x << k) | (x >>> (32 - k))) >>> 0;
}
