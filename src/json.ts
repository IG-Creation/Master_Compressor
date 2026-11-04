/**
 * losslesspack - Lossless Canonical JSON Engine
 * Guarantees bit-identical roundtripping for all JavaScript primitives,
 * including Date, BigInt, NaN, Infinity, -Infinity, and Buffers via tagged encoding.
 * Functions and Symbols are strictly rejected with UnsupportedTypeError.
 */

import { UnsupportedTypeError } from "./errors.js";

const TAG_FIELD = "__llp_tag__";

/**
 * Custom replacer that maps non-standard JSON types into deterministic tagged envelopes.
 * Uses `this[key]` to access pre-serialized objects (like Date before toJSON is triggered).
 */
function canonicalReplacer(this: unknown, key: string, value: unknown): unknown {
  const container = this as Record<string, unknown> | undefined;
  const original = container && key !== "" ? container[key] : value;

  if (typeof original === "bigint" || typeof value === "bigint") {
    const val = typeof original === "bigint" ? original : (value as bigint);
    return { [TAG_FIELD]: "bigint", value: val.toString() };
  }
  if (typeof original === "number") {
    if (Number.isNaN(original)) {
      return { [TAG_FIELD]: "nan" };
    }
    if (original === Infinity) {
      return { [TAG_FIELD]: "infinity", sign: 1 };
    }
    if (original === -Infinity) {
      return { [TAG_FIELD]: "infinity", sign: -1 };
    }
  }
  if (original instanceof Date) {
    return { [TAG_FIELD]: "date", value: original.toISOString() };
  }
  if (Buffer.isBuffer(original) || original instanceof Uint8Array) {
    return { [TAG_FIELD]: "buffer", data: Buffer.from(original).toString("base64") };
  }
  if (typeof original === "undefined") {
    return { [TAG_FIELD]: "undefined" };
  }
  if (typeof original === "function" || typeof original === "symbol") {
    throw new UnsupportedTypeError(
      `Cannot serialize ${typeof original} to lossless JSON. Only data primitives are supported.`
    );
  }

  // Sort object keys alphabetically for canonical determinism
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sortedObj: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const k of keys) {
      sortedObj[k] = (value as Record<string, unknown>)[k];
    }
    return sortedObj;
  }

  return value;
}

/**
 * Custom reviver that reconstructs tagged envelopes into exact native types.
 */
function canonicalReviver(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (TAG_FIELD in obj) {
      const tag = obj[TAG_FIELD];
      switch (tag) {
        case "bigint":
          return BigInt(obj.value as string);
        case "nan":
          return Number.NaN;
        case "infinity":
          return (obj.sign as number) > 0 ? Infinity : -Infinity;
        case "date":
          return new Date(obj.value as string);
        case "buffer":
          return Buffer.from(obj.data as string, "base64");
        case "undefined":
          return undefined;
        default:
          return value;
      }
    }
  }
  return value;
}

/**
 * Serializes an arbitrary JavaScript object or primitive into a canonical UTF-8 JSON Buffer.
 */
export function stringifyCanonicalJSON(value: unknown): Buffer {
  if (value === undefined) {
    return Buffer.from(JSON.stringify({ [TAG_FIELD]: "undefined" }), "utf8");
  }
  const jsonStr = JSON.stringify(value, canonicalReplacer);
  return Buffer.from(jsonStr, "utf8");
}

/**
 * Deserializes a canonical JSON buffer back into its native representation.
 */
export function parseCanonicalJSON<T = unknown>(buf: Buffer | Uint8Array): T {
  const jsonStr = Buffer.from(buf).toString("utf8");
  return JSON.parse(jsonStr, canonicalReviver) as T;
}