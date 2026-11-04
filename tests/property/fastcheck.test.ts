import { describe, it, expect } from "vitest";
import fc from "fast-check";
import crypto from "node:crypto";
import { compress, decompress, inspectContainer, HEADER_SIZE } from "../../src/index.js";

describe("Section B: Property-Based Invariant Testing (fast-check)", () => {
  it("maintains lossless byte-identity and size bounds across arbitrary buffers", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 0, maxLength: 8192 }), async (uint8) => {
        const inputBuf = Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength);
        const compressed = await compress(inputBuf);

        // Invariant 1: Header length is 55 bytes
        expect(compressed.length).toBeGreaterThanOrEqual(HEADER_SIZE);

        // Invariant 2: Output never exceeds input size + 55 bytes
        expect(compressed.length).toBeLessThanOrEqual(inputBuf.length + HEADER_SIZE);

        // Invariant 3: Header properties are consistent
        const header = inspectContainer(compressed);
        expect(header.magic).toBe("LLP1");
        expect(header.version).toBe(1);
        expect(header.originalLength).toBe(BigInt(inputBuf.length));

        const expectedSha = crypto.createHash("sha256").update(inputBuf).digest();
        expect(header.sha256.equals(expectedSha)).toBe(true);

        // Invariant 4: Decompressed output is byte-identical
        const decompressed = await decompress(compressed);
        expect(decompressed.equals(inputBuf)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});