/**
 * Schema-driven diff computation and application for GraphNode and GraphEdge JSON.
 *
 * One schema per object type declares which fields need non-default merge
 * strategies. Everything not listed falls back to "set" (full replacement).
 *
 * Strategies:
 *   set          – scalar, vector, or object replaced wholesale (default)
 *   set_members  – unordered string id collections (set_add / set_remove ops)
 *   array        – ordered array replaced in full (semantically a "set", explicit intent)
 *   map          – Record<string, string> with map_put / map_delete ops
 */

import type { ObjectDiffOperation } from "../../../../server/shared/messages";
import type { GraphNodeJson, GraphEdgeJson } from "../../../../server/shared/types_serialization";
export { applyDiffToJson } from "../../../../server/shared/objectDiff";

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

type DiffStrategy = "set" | "set_members" | "array" | "map";

interface ObjectSchema {
	kind: "object";
	fields: Record<string, DiffStrategy | ObjectSchema | VariantSchema>;
}

interface VariantSchema {
	kind: "variant";
	/** The key whose value selects the active branch at runtime */
	discriminant: string;
	branches: Record<string, ObjectSchema>;
}

function object(fields: ObjectSchema["fields"]): ObjectSchema {
	return { kind: "object", fields };
}

function variant(discriminant: string, branches: Record<string, ObjectSchema>): VariantSchema {
	return { kind: "variant", discriminant, branches };
}

// ---------------------------------------------------------------------------
// Schemas  (only non-default strategies need an entry)
// ---------------------------------------------------------------------------

const nodeSchema: ObjectSchema = object({
	edges:    "set_members",
	children: "set_members",
	properties: variant("type", {
		production: object({
			resourceJoints: "array",
			details: variant("type", {
				"factory-reference": object({
					jointsToExternalNodes: "map",
				}),
			}),
		}),
	}),
});

const edgeSchema: ObjectSchema = object({
	properties: object({
		straightLineOffsets: "array",
	}),
});

// ---------------------------------------------------------------------------
// Deep equality
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null || b == null) return a === b;
	if (typeof a !== "object" || typeof b !== "object") return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a)) {
		const bArr = b as unknown[];
		if (a.length !== bArr.length) return false;
		return a.every((v, i) => deepEqual(v, bArr[i]));
	}
	const aObj = a as Record<string, unknown>;
	const bObj = b as Record<string, unknown>;
	const aKeys = Object.keys(aObj);
	const bKeys = Object.keys(bObj);
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every((k) => k in bObj && deepEqual(aObj[k], bObj[k]));
}

// ---------------------------------------------------------------------------
// Generic diff computation
// ---------------------------------------------------------------------------

type FieldSchema = DiffStrategy | ObjectSchema | VariantSchema;

function diffField(
	prev: any,
	next: any,
	schema: FieldSchema,
	path: string,
	ops: ObjectDiffOperation[],
): void {
	if (schema === "set" || schema === "array") {
		if (!deepEqual(prev, next)) ops.push({ op: "set", path, value: next });
		return;
	}
	if (schema === "set_members") {
		const prevSet = new Set<string>(prev ?? []);
		const nextSet = new Set<string>(next ?? []);
		for (const v of prevSet) { if (!nextSet.has(v)) ops.push({ op: "set_remove", path, value: v }); }
		for (const v of nextSet) { if (!prevSet.has(v)) ops.push({ op: "set_add",    path, value: v }); }
		return;
	}
	if (schema === "map") {
		const p: Record<string, string> = prev ?? {};
		const n: Record<string, string> = next ?? {};
		for (const key of Object.keys(p)) { if (!(key in n)) ops.push({ op: "map_delete", path, key }); }
		for (const [key, value] of Object.entries(n)) { if (p[key] !== value) ops.push({ op: "map_put", path, key, value }); }
		return;
	}
	// ObjectSchema or VariantSchema – only recurse when something changed
	if (deepEqual(prev, next)) return;
	if (schema.kind === "object") {
		diffObject(prev, next, schema, path, ops);
		return;
	}
	// VariantSchema: pick branch by discriminant value of next
	const discriminantValue: string = next?.[schema.discriminant];
	const branch = schema.branches[discriminantValue];
	if (branch) {
		diffObject(prev, next, branch, path, ops);
	} else {
		// No branch defined: diff all non-discriminant keys with the default "set" strategy
		const allKeys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})]);
		allKeys.delete(schema.discriminant);
		for (const k of allKeys) {
			if (!deepEqual(prev?.[k], next?.[k])) {
				ops.push({ op: "set", path: `${path}.${k}`, value: next?.[k] });
			}
		}
	}
}

function diffObject(
	prev: any,
	next: any,
	schema: ObjectSchema,
	pathPrefix: string,
	ops: ObjectDiffOperation[],
): void {
	const allKeys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})]);
	for (const key of allKeys) {
		const fieldSchema: FieldSchema = schema.fields[key] ?? "set";
		const path = pathPrefix ? `${pathPrefix}.${key}` : key;
		diffField(prev?.[key], next?.[key], fieldSchema, path, ops);
	}
}

export function computeNodeDiff(prev: GraphNodeJson, next: GraphNodeJson): ObjectDiffOperation[] {
	const ops: ObjectDiffOperation[] = [];
	diffObject(prev, next, nodeSchema, "", ops);
	return ops;
}

export function computeEdgeDiff(prev: GraphEdgeJson, next: GraphEdgeJson): ObjectDiffOperation[] {
	const ops: ObjectDiffOperation[] = [];
	diffObject(prev, next, edgeSchema, "", ops);
	return ops;
}
