import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { MemoryStorageAdapter } from "../../src/adapters/memory.js";
import { ChecksumMismatchError, TruncatedDataError } from "../../src/errors.js";

describe("Automatic Value Splitting & Manifest Management", () => {
  it("splits payload into parts and reconstructs bit-identically", async () => {
    // Adapter with small threshold: 1000 bytes
    const adapter = new MemoryStorageAdapter({ maxValueSizeBytes: 1000 });
    const original = crypto.randomBytes(3500); // Should yield 4 parts (1000 + 1000 + 1000 + 500)
    const key = "test/large_split_key";

    await adapter.put(key, original);
    const restored = await adapter.get(key);

    expect(restored).not.toBeNull();
    expect(restored!.length).toBe(3500);
    expect(restored!.equals(original)).toBe(true);

    // Verify cleanup
    const deleted = await adapter.delete(key);
    expect(deleted).toBe(true);

    const afterDelete = await adapter.get(key);
    expect(afterDelete).toBeNull();
  });

  it("detects corruption in a single part and throws ChecksumMismatchError", async () => {
    const adapter = new MemoryStorageAdapter({ maxValueSizeBytes: 500 });
    const original = crypto.randomBytes(1200); // 3 parts
    const key = "test/tampered_part_key";

    await adapter.put(key, original);

    // Tamper with part 1
    const part1Key = `${key}.__llp_part__.1`;
    const part1Data = await adapter.get(part1Key);
    expect(part1Data).not.toBeNull();
    part1Data![0] ^= 0xff; // flip byte
    await adapter.put(part1Key, part1Data!);

    await expect(adapter.get(key)).rejects.toThrow(ChecksumMismatchError);
  });

  it("detects missing part and throws TruncatedDataError", async () => {
    const adapter = new MemoryStorageAdapter({ maxValueSizeBytes: 500 });
    const original = crypto.randomBytes(1200);
    const key = "test/missing_part_key";

    await adapter.put(key, original);

    // Delete part 2 directly
    const part2Key = `${key}.__llp_part__.2`;
    await adapter.delete(part2Key);

    await expect(adapter.get(key)).rejects.toThrow(TruncatedDataError);
  });
});