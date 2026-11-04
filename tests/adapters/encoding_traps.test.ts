import { describe, it, expect } from "vitest";
import { MemoryStorageAdapter } from "../../src/adapters/memory.js";

describe("Encoding Traps & Binary Integrity", () => {
  const adapter = new MemoryStorageAdapter();

  it("handles null bytes, 0xFF, and trailing zeros without truncation", async () => {
    // Array of all 256 byte values followed by 50 zeros and 50 0xFFs
    const buf = Buffer.alloc(256 + 100);
    for (let i = 0; i < 256; i++) buf[i] = i;
    buf.fill(0x00, 256, 306);
    buf.fill(0xff, 306, 356);

    const key = "traps/null_and_ff_trailing_zeros";
    await adapter.put(key, buf);
    const retrieved = await adapter.get(key);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.length).toBe(buf.length);
    expect(retrieved!.equals(buf)).toBe(true);
  });

  it("handles numeric-like keys without type coercion", async () => {
    // Keys that might be coerced to numbers: "0", "0123", "1e6", "Infinity", "NaN"
    const trapKeys = ["0", "0123", "00456", "1e6", "Infinity", "NaN", "true", "null"];

    for (const k of trapKeys) {
      const payload = Buffer.from(`data-for-${k}`, "utf8");
      await adapter.put(k, payload);
      const res = await adapter.get(k);
      expect(res).not.toBeNull();
      expect(res!.toString("utf8")).toBe(`data-for-${k}`);
    }
  });

  it("handles keys with slashes, backslashes, quotes, emojis, and unicode", async () => {
    const specialKeys = [
      "path/to/nested/resource.bin",
      "path\\with\\windows\\backslashes",
      "key'with\"quotes'and`backticks`",
      "emoji_🌟_🚀_🔥_test",
      "chinese_中文_arabic_عربي_hebrew_עברית",
      "spaces in key and tabs\there"
    ];

    for (const k of specialKeys) {
      const payload = Buffer.from(`special-${k}`, "utf8");
      await adapter.put(k, payload);
      const res = await adapter.get(k);
      expect(res).not.toBeNull();
      expect(res!.equals(payload)).toBe(true);
      await adapter.delete(k);
    }
  });
});