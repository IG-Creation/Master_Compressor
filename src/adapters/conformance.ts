/**
 * losslesspack - Storage Adapter Conformance Test Suite
 * Exported conformance test suite that any first- or third-party adapter can run
 * to guarantee compliance with the StorageAdapter contract.
 */

import crypto from "node:crypto";
import { StorageAdapter } from "./types.js";

export interface ConformanceOptions {
  /** If true, runs a large payload test (up to declared maxValueSizeBytes or capped at 10 MB) */
  testLargeValues?: boolean;
  /** Custom key prefix for test isolation */
  keyPrefix?: string;
}

export interface ConformanceResult {
  adapterName: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  failures: Array<{ testName: string; error: string }>;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Conformance Assertion Failed: ${message}`);
  }
}

export async function runAdapterConformanceTests(
  adapterFactory: () => Promise<StorageAdapter>,
  options: ConformanceOptions = {}
): Promise<ConformanceResult> {
  const adapter = await adapterFactory();
  const prefix = options.keyPrefix || `__conf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}/`;
  const result: ConformanceResult = {
    adapterName: adapter.name,
    totalChecks: 0,
    passedChecks: 0,
    failedChecks: 0,
    failures: []
  };

  async function step(name: string, fn: () => Promise<void>) {
    result.totalChecks++;
    try {
      await fn();
      result.passedChecks++;
    } catch (err: any) {
      result.failedChecks++;
      result.failures.push({ testName: name, error: err?.message || String(err) });
    }
  }

  // 1. Missing Key Behavior
  await step("missing_key_behavior", async () => {
    const missingKey = `${prefix}non_existent_key_${Date.now()}`;
    const data = await adapter.get(missingKey);
    assert(data === null, `get() on missing key must return null, got ${typeof data}`);

    const exists = await adapter.exists(missingKey);
    assert(exists === false, `exists() on missing key must return false, got ${exists}`);

    const deleted = await adapter.delete(missingKey);
    assert(deleted === false, `delete() on missing key must return false, got ${deleted}`);
  });

  // 2. Binary-Safe Round Trip (all 256 byte values 0x00..0xFF)
  await step("all_256_byte_values_roundtrip", async () => {
    const key = `${prefix}all_256_bytes`;
    const bytes256 = Buffer.alloc(256 * 16);
    for (let i = 0; i < bytes256.length; i++) {
      bytes256[i] = i % 256;
    }

    await adapter.put(key, bytes256);
    const read = await adapter.get(key);
    assert(read !== null, "read must not be null");
    assert(read!.length === bytes256.length, `Length mismatch: expected ${bytes256.length}, got ${read!.length}`);
    assert(read!.equals(bytes256), "Payload byte content mismatch on 0x00..0xFF binary round trip");
    await adapter.delete(key);
  });

  // 3. Empty Buffer (0 bytes)
  await step("empty_buffer_roundtrip", async () => {
    const key = `${prefix}empty_buffer`;
    const empty = Buffer.alloc(0);
    await adapter.put(key, empty);
    const read = await adapter.get(key);
    assert(read !== null, "read must not be null for 0-byte buffer");
    assert(read!.length === 0, `Length expected 0, got ${read!.length}`);
    await adapter.delete(key);
  });

  // 4. Overwrite Semantics
  await step("overwrite_semantics", async () => {
    const key = `${prefix}overwrite_test`;
    const valA = Buffer.from("value_alpha_initial", "utf8");
    const valB = Buffer.from("value_beta_overwritten_longer_payload", "utf8");

    await adapter.put(key, valA);
    let read = await adapter.get(key);
    assert(read !== null && read.equals(valA), "Initial put failed");

    await adapter.put(key, valB);
    read = await adapter.get(key);
    assert(read !== null && read.equals(valB), "Overwritten put failed to replace value");

    const exists = await adapter.exists(key);
    assert(exists === true, "exists() must be true after put");

    const deleted = await adapter.delete(key);
    assert(deleted === true, "delete() on existing key must return true");

    const existsAfter = await adapter.exists(key);
    assert(existsAfter === false, "exists() must be false after delete");
  });

  // 5. Special, Long, and Unicode Keys
  await step("unicode_and_special_keys", async () => {
    const testKeys = [
      `${prefix}sub/path/item.bin`,
      `${prefix}colons:and-dashes`,
      `${prefix}emoji_🚀_🔥_pack`,
      `${prefix}arabic_عربي_japanese_日本語`,
      `${prefix}0123456`, // numeric-looking
      `${prefix}${"a".repeat(300)}` // long key
    ];

    for (const k of testKeys) {
      const payload = crypto.randomBytes(64);
      await adapter.put(k, payload);
      const fetched = await adapter.get(k);
      assert(fetched !== null && fetched.equals(payload), `Key roundtrip failed for ${k.slice(0, 30)}...`);
      await adapter.delete(k);
    }
  });

  // 6. Concurrent Put and Get
  await step("concurrent_put_and_get", async () => {
    const count = 15;
    const items = Array.from({ length: count }, (_, i) => ({
      key: `${prefix}concurrent_${i}`,
      buf: crypto.randomBytes(128 + i * 32)
    }));

    // Concurrent puts
    await Promise.all(items.map((it) => adapter.put(it.key, it.buf)));

    // Concurrent gets
    const results = await Promise.all(items.map((it) => adapter.get(it.key)));
    for (let i = 0; i < count; i++) {
      assert(results[i] !== null && results[i]!.equals(items[i].buf), `Concurrent get mismatch for item ${i}`);
    }

    // Concurrent deletes
    await Promise.all(items.map((it) => adapter.delete(it.key)));
  });

  // 7. List Pagination Exactly Once
  await step("list_pagination_exactly_once", async () => {
    const listPrefix = `${prefix}list_test/`;
    const totalKeys = 12;
    const insertedKeys = Array.from({ length: totalKeys }, (_, i) => `${listPrefix}key_${i.toString().padStart(2, "0")}`);

    for (const k of insertedKeys) {
      await adapter.put(k, Buffer.from("list_data", "utf8"));
    }

    const collectedKeys: string[] = [];
    let cursor: string | undefined = undefined;
    let iterations = 0;

    do {
      const page = await adapter.list(listPrefix, cursor, 4);
      collectedKeys.push(...page.keys);
      cursor = page.nextCursor;
      iterations++;
      if (iterations > 20) {
        throw new Error("Pagination loop exceeded 20 iterations (possible cursor loop)");
      }
    } while (cursor);

    // Verify all keys found exactly once
    assert(collectedKeys.length === totalKeys, `Expected ${totalKeys} keys, got ${collectedKeys.length}`);
    const keySet = new Set(collectedKeys);
    assert(keySet.size === totalKeys, "Duplicate keys found during pagination");
    for (const k of insertedKeys) {
      assert(keySet.has(k), `Missing key in pagination: ${k}`);
    }

    for (const k of insertedKeys) {
      await adapter.delete(k);
    }
  });

  // 8. Large Value Splitting (if enabled or if adapter has small max value)
  if (options.testLargeValues) {
    await step("large_value_splitting", async () => {
      const caps = adapter.capabilities();
      // Generate a payload slightly larger than maxValueSizeBytes if reasonable (capped at 5MB for quick tests)
      const testSize = Math.min(caps.maxValueSizeBytes * 2, 2 * 1024 * 1024);
      const largePayload = crypto.randomBytes(testSize);
      const largeKey = `${prefix}large_val_split`;

      await adapter.put(largeKey, largePayload);
      const readLarge = await adapter.get(largeKey);
      assert(readLarge !== null, "Large payload read returned null");
      assert(readLarge!.length === testSize, `Large payload size mismatch: expected ${testSize}, got ${readLarge!.length}`);
      assert(readLarge!.equals(largePayload), "Large payload SHA mismatch");
      await adapter.delete(largeKey);
    });
  }

  if (adapter.close) {
    await adapter.close();
  }

  if (result.failedChecks > 0) {
    const failureSummary = result.failures.map((f) => `[${f.testName}]: ${f.error}`).join("; ");
    throw new Error(`Adapter conformance tests failed (${result.failedChecks}/${result.totalChecks}): ${failureSummary}`);
  }

  return result;
}