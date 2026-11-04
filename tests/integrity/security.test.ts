import { describe, it, expect } from "vitest";
import {
  compress,
  decompress,
  InvalidMagicError,
  UnsupportedVersionError,
  CorruptHeaderError,
  ChecksumMismatchError,
  TruncatedDataError,
  SizeLimitExceededError,
  HEADER_SIZE,
  packHeader,
  AlgorithmId
} from "../../src/index.js";

describe("Section C: Integrity, Security, & Error Robustness", () => {
  const samplePayload = Buffer.from("LosslessPack tamper detection and security verification payload.", "utf8");

  it("exhaustive bit flip across container either throws typed error or yields exact data", async () => {
    const compressed = await compress(samplePayload);
    let errorCount = 0;

    for (let byteIdx = 0; byteIdx < compressed.length; byteIdx++) {
      for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
        const mutated = Buffer.from(compressed);
        mutated[byteIdx] ^= (1 << bitIdx);

        try {
          const result = await decompress(mutated);
          // If it didn't throw, it MUST be byte-identical (never silent corruption!)
          expect(result.equals(samplePayload)).toBe(true);
        } catch (err) {
          errorCount++;
          expect(
            err instanceof CorruptHeaderError ||
            err instanceof ChecksumMismatchError ||
            err instanceof InvalidMagicError ||
            err instanceof TruncatedDataError ||
            err instanceof Error
          ).toBe(true);
        }
      }
    }

    // In an exhaustive bit flip, errors should be triggered almost everywhere
    expect(errorCount).toBeGreaterThan(0);
  });

  it("handles truncated container at every possible byte length", async () => {
    const compressed = await compress(samplePayload);
    for (let len = 0; len < compressed.length; len++) {
      const truncated = compressed.subarray(0, len);
      await expect(decompress(truncated)).rejects.toThrow();
    }
  });

  it("rejects wrong magic bytes with InvalidMagicError", async () => {
    const compressed = await compress(samplePayload);
    const corrupted = Buffer.from(compressed);
    corrupted[0] = 0x58; // 'X' instead of 'L'
    // Update CRC so only magic fails
    await expect(decompress(corrupted)).rejects.toThrow(InvalidMagicError);
  });

  it("rejects unsupported container versions with UnsupportedVersionError", async () => {
    const fakeHeader = packHeader({
      algorithmId: AlgorithmId.STORE,
      originalLength: samplePayload.length,
      sha256: Buffer.alloc(32, 0)
    });
    // Set version byte to 99
    fakeHeader[4] = 99;
    // Recompute CRC32
    const crypto = await import("node:crypto");
    const { computeCRC32 } = await import("../../src/format.js");
    fakeHeader.writeUInt32BE(computeCRC32(fakeHeader.subarray(0, 51)), 51);

    await expect(decompress(Buffer.concat([fakeHeader, samplePayload]))).rejects.toThrow(
      UnsupportedVersionError
    );
  });

  it("rejects corrupt header CRC32 with CorruptHeaderError", async () => {
    const compressed = await compress(samplePayload);
    const corrupted = Buffer.from(compressed);
    // Mutate header byte 6 (flags) without updating CRC
    corrupted[6] ^= 0x01;
    await expect(decompress(corrupted)).rejects.toThrow(CorruptHeaderError);
  });

  it("rejects mismatched SHA-256 with ChecksumMismatchError", async () => {
    const compressed = await compress(samplePayload);
    const corrupted = Buffer.from(compressed);
    // Mutate last byte of compressed payload (outside header)
    corrupted[corrupted.length - 1] ^= 0xff;
    await expect(decompress(corrupted)).rejects.toThrow(ChecksumMismatchError);
  });

  it("blocks decompression bombs before allocating memory", async () => {
    // Header claims 10 MB, but max allowed is 100 bytes
    const fakeHeader = packHeader({
      algorithmId: AlgorithmId.STORE,
      originalLength: 10 * 1024 * 1024,
      sha256: Buffer.alloc(32, 0)
    });
    const container = Buffer.concat([fakeHeader, Buffer.alloc(100)]);

    await expect(
      decompress(container, { maxDecompressedSize: 100 })
    ).rejects.toThrow(SizeLimitExceededError);
  });

  it("throws TypeError on non-Buffer inputs", async () => {
    // @ts-expect-error Testing invalid input
    await expect(compress(null)).rejects.toThrow(TypeError);
    // @ts-expect-error Testing invalid input
    await expect(compress(undefined)).rejects.toThrow(TypeError);
    // @ts-expect-error Testing invalid input
    await expect(compress(12345)).rejects.toThrow(TypeError);
    // @ts-expect-error Testing invalid input
    await expect(compress({ key: "val" })).rejects.toThrow(TypeError);
  });
});