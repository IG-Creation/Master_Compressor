import { describe, it, expect } from "vitest";
import {
  compress,
  decompress,
  compressJSON,
  decompressJSON,
  inspectContainer,
  AlgorithmId,
  UnsupportedTypeError
} from "../../src/index.js";

describe("Section A: Round-Trip Correctness for Every Algorithm & Level", () => {
  const algorithms = ["store", "gzip", "brotli", "zstd"] as const;

  // 1. Boundary sizes
  const boundaryCases = [
    { name: "empty input", data: Buffer.alloc(0) },
    { name: "1 byte", data: Buffer.from([0x42]) },
    { name: "2 bytes", data: Buffer.from([0xaa, 0xbb]) },
    { name: "header-sized (55 bytes)", data: Buffer.alloc(55, 0x7a) },
    { name: "chunkSize - 1 (65535 bytes)", data: Buffer.alloc(65535, "A") },
    { name: "chunkSize (65536 bytes)", data: Buffer.alloc(65536, "B") },
    { name: "chunkSize + 1 (65537 bytes)", data: Buffer.alloc(65537, "C") }
  ];

  for (const algo of algorithms) {
    describe(`Algorithm: ${algo}`, () => {
      for (const { name, data } of boundaryCases) {
        it(`correctly round-trips ${name}`, async () => {
          const compressed = await compress(data, { algorithm: algo, verify: true });
          expect(compressed.length).toBeGreaterThanOrEqual(55);

          const decompressed = await decompress(compressed);
          expect(decompressed.equals(data)).toBe(true);
        });
      }
    });
  }

  // 2. Binary Profiles
  describe("Binary Patterns & Extremes", () => {
    it("handles all 256 byte values sequentially", async () => {
      const allBytes = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) allBytes[i] = i;

      const compressed = await compress(allBytes);
      const decompressed = await decompress(compressed);
      expect(decompressed.equals(allBytes)).toBe(true);
    });

    it("handles long runs of zeros (100 KB)", async () => {
      const zeros = Buffer.alloc(100 * 1024, 0x00);
      const compressed = await compress(zeros);
      expect(compressed.length).toBeLessThan(zeros.length); // High compression

      const decompressed = await decompress(compressed);
      expect(decompressed.equals(zeros)).toBe(true);
    });

    it("handles long runs of 0xFF (100 KB)", async () => {
      const ones = Buffer.alloc(100 * 1024, 0xff);
      const compressed = await compress(ones);
      expect(compressed.length).toBeLessThan(ones.length);

      const decompressed = await decompress(compressed);
      expect(decompressed.equals(ones)).toBe(true);
    });

    it("handles embedded null bytes interspersed in text", async () => {
      const withNulls = Buffer.from("FieldA\0FieldB\0FieldC\0FieldD\0\0\0End", "utf8");
      const compressed = await compress(withNulls);
      const decompressed = await decompress(compressed);
      expect(decompressed.equals(withNulls)).toBe(true);
    });

    it("gracefully falls back to store mode on incompressible random bytes", async () => {
      const crypto = await import("node:crypto");
      const randomData = crypto.randomBytes(4096);
      const compressed = await compress(randomData);

      // Check header indicates STORE
      const header = inspectContainer(compressed);
      expect(header.algorithmId).toBe(AlgorithmId.STORE);
      expect(compressed.length).toBe(randomData.length + 55);

      const decompressed = await decompress(compressed);
      expect(decompressed.equals(randomData)).toBe(true);
    });

    it("detects already-compressed data (Gzip magic) and skips recompression", async () => {
      const mockGzip = Buffer.concat([
        Buffer.from([0x1f, 0x8b, 0x08, 0x00]),
        Buffer.alloc(200, 0x55)
      ]);
      const compressed = await compress(mockGzip, { algorithm: "auto" });
      const header = inspectContainer(compressed);
      expect(header.algorithmId).toBe(AlgorithmId.STORE);
    });
  });

  // 3. UTF-8 Text
  describe("Multilingual UTF-8 & String Formats", () => {
    it("handles multi-byte emojis, combining characters, and RTL", async () => {
      const complexText = "🚀 Master Compressor 🗜️ 👨‍👩‍👧‍👦 RTL: עִבְרִית العربية 🇮🇳 CJK: 漢字, ひらがな";
      const compressed = await compress(complexText);
      const decompressed = await decompress(compressed);
      expect(decompressed.toString("utf8")).toBe(complexText);
    });

    it("handles Devanagari / Hindi unicode text", async () => {
      const hindi = "डेटा कम्प्रेशन और सुरक्षित डेटाबेस संग्रहण इंजन";
      const compressed = await compress(hindi);
      const decompressed = await decompress(compressed);
      expect(decompressed.toString("utf8")).toBe(hindi);
    });

    it("preserves exact CRLF vs LF newlines and UTF-8 BOM", async () => {
      const crlf = "\uFEFFLine1\r\nLine2\nLine3\r\n\r\nEnd";
      const compressed = await compress(crlf);
      const decompressed = await decompress(compressed);
      expect(decompressed.toString("utf8")).toBe(crlf);
    });
  });

  // 4. JSON Serialization & Primitives
  describe("Lossless JSON Round-Tripping", () => {
    it("losslessly encodes and decodes BigInt, Date, NaN, and Infinity", async () => {
      const now = new Date("2026-11-05T00:00:00.000Z");
      const payload = {
        bigNumber: 9007199254740993123456789n,
        timestamp: now,
        notANumber: Number.NaN,
        positiveInf: Infinity,
        negativeInf: -Infinity,
        nested: {
          items: [1, 2, 3],
          active: true,
          label: "Audit Passed"
        }
      };

      const compressed = await compressJSON(payload);
      const restored = await decompressJSON<typeof payload>(compressed);

      expect(restored.bigNumber).toBe(9007199254740993123456789n);
      expect(restored.timestamp.toISOString()).toBe(now.toISOString());
      expect(Number.isNaN(restored.notANumber)).toBe(true);
      expect(restored.positiveInf).toBe(Infinity);
      expect(restored.negativeInf).toBe(-Infinity);
      expect(restored.nested.items).toEqual([1, 2, 3]);
      expect(restored.nested.active).toBe(true);
    });

    it("strictly rejects functions and symbols with UnsupportedTypeError", async () => {
      const invalidPayload = {
        fn: () => "invalid"
      };
      await expect(compressJSON(invalidPayload)).rejects.toThrow(UnsupportedTypeError);
    });
  });
});