/**
 * Generic diff application for serialized JSON state.
 * Used by both the server (RoomState) and the UI (CommandProcessor) to apply
 * ObjectDiffOperation arrays produced by the diff engine.
 *
 * This module is intentionally dependency-free: no UI framework, no Svelte,
 * no data-model classes. It operates entirely on plain JSON objects.
 */

import type { ObjectDiffOperation } from "./messages.ts";

/**
 * Applies an array of diff operations to a plain JSON object, mutating it
 * in place. Unknown paths are silently skipped (the object simply doesn't
 * change for those ops).
 */
export function applyDiffToJson(
	json: Record<string, unknown>,
	ops: ObjectDiffOperation[],
): void {
	for (const op of ops) {
		const parts = op.path.split(".");
		let parent: Record<string, unknown> = json;
		for (let i = 0; i < parts.length - 1; i++) {
			const next = parent[parts[i]];
			if (next == null || typeof next !== "object" || Array.isArray(next)) {
				parent = null as unknown as Record<string, unknown>;
				break;
			}
			parent = next as Record<string, unknown>;
		}
		if (parent == null) continue;

		const leaf = parts[parts.length - 1];
		switch (op.op) {
			case "set":
				parent[leaf] = op.value;
				break;
			case "set_add": {
				if (!Array.isArray(parent[leaf])) parent[leaf] = [];
				const arr = parent[leaf] as string[];
				if (!arr.includes(op.value)) arr.push(op.value);
				break;
			}
			case "set_remove":
				if (Array.isArray(parent[leaf])) {
					parent[leaf] = (parent[leaf] as string[]).filter((v) => v !== op.value);
				}
				break;
			case "map_put": {
				if (typeof parent[leaf] !== "object" || parent[leaf] == null) {
					parent[leaf] = {};
				}
				(parent[leaf] as Record<string, unknown>)[op.key] = op.value;
				break;
			}
			case "map_delete":
				if (typeof parent[leaf] === "object" && parent[leaf] != null) {
					delete (parent[leaf] as Record<string, unknown>)[op.key];
				}
				break;
		}
	}
}
