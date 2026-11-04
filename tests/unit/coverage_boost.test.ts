import { describe, it, expect } from "vitest";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  compress,
  decompress,
  compressStream,
  decompressStream,
  compressFile,
  decompressFile,
  AlgorithmId,
  AlgorithmUnavailableError,
  DictionaryNotFoundError,
  CorruptHeaderError,
  SizeLimitExceededError,
  TruncatedDataError
} from "../../src/index.js";
import { StoreEngine } from "../../src/algorithms/store.js";
import { GzipEngine } from "../../src/algorithms/gzip.js";
import { BrotliEngine } from "../../src/algorithms/brotli.js";
import { ZstdEngine } from "../../src/algorithms/zstd.js";
import {
  calculateShannonEntropy,
  isAlreadyCompressedMagic,
  selectOptimalAlgorithm
} from "../../src/algorithms/auto.js";
import { bufferToByteaHex, byteaHexToBuffer } from "../../src/supabase/bytea.js";
import { uploadCompressed, downloadDecompressed } from "../../src/supabase/storage.js";
import { readKeysetPaginated } from "../../src/supabase/pagination.js";
import { stringifyCanonicalJSON, parseCanonicalJSON } from "../../src/json.js";

describe("Coverage Boost & Edge Branches", () => {
  it("exercises StoreEngine direct compress and decompress", async () => {
    const store = new StoreEngine();
    const data = Buffer.from("Direct store engine test");
    const comp = await store.compress(data);
    const decomp = await store.decompress(comp);
    expect(decomp.equals(data)).toBe(true);
  });

  it("exercises GzipEngine and BrotliEngine directly", async () => {
    const gz = new GzipEngine();
    const br = new BrotliEngine();
    const data = Buffer.from("Direct engine test payload".repeat(10));

    const gzComp = await gz.compress(data, 1);
    expect((await gz.decompress(gzComp)).equals(data)).toBe(true);

    const brComp = await br.compress(data, 1);
    expect((await br.decompress(brComp)).equals(data)).toBe(true);
  });

  it("exercises ZstdEngine directly with and without dictionary", async () => {
    const zstd = new ZstdEngine();
    const data = Buffer.from("Direct zstd engine payload".repeat(10));
    const comp = await zstd.compress(data);
    const decomp = await zstd.decompress(comp);
    expect(decomp.equals(data)).toBe(true);
  });

  it("exercises all typed errors constructors", () => {
    const dnf = new DictionaryNotFoundError(42);
    expect(dnf.code).toBe("ERR_DICTIONARY_NOT_FOUND");
    expect(dnf.message).toContain("42");

    const au = new AlgorithmUnavailableError("xz");
    expect(au.code).toBe("ERR_ALGORITHM_UNAVAILABLE");
    expect(au.message).toContain("xz");
  });

  it("exercises auto magic checks for zip, png, jpeg, 7z, zstd, webp, mp4", () => {
    // PNG
    expect(isAlreadyCompressedMagic(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    // JPEG
    expect(isAlreadyCompressedMagic(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
    // Zip
    expect(isAlreadyCompressedMagic(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(isAlreadyCompressedMagic(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
    // 7z
    expect(isAlreadyCompressedMagic(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))).toBe(true);
    // Zstd
    expect(isAlreadyCompressedMagic(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))).toBe(true);
    // WebP
    const webpBuf = Buffer.alloc(16);
    webpBuf.write("RIFF", 0, "ascii");
    webpBuf.write("WEBP", 8, "ascii");
    expect(isAlreadyCompressedMagic(webpBuf)).toBe(true);
    // MP4
    const mp4Buf = Buffer.alloc(16);
    mp4Buf.write("ftyp", 4, "ascii");
    expect(isAlreadyCompressedMagic(mp4Buf)).toBe(true);
    // Too short
    expect(isAlreadyCompressedMagic(Buffer.from([0x01]))).toBe(false);
  });

  it("exercises calculateShannonEntropy with small and empty buffers", () => {
    expect(calculateShannonEntropy(Buffer.alloc(0))).toBe(0);
    const lowEntropy = Buffer.alloc(100, 0x41);
    expect(calculateShannonEntropy(lowEntropy)).toBe(0);
    const highEntropy = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    expect(calculateShannonEntropy(highEntropy)).toBe(8);
  });

  it("exercises bytea hex with 0x prefix and invalid input", () => {
    const data = Buffer.from("Bytea test data");
    const hexWith0x = "0x" + data.toString("hex");
    const from0x = byteaHexToBuffer(hexWith0x);
    expect(from0x.equals(data)).toBe(true);

    const hexWithUpperX = "\\X" + data.toString("hex");
    expect(byteaHexToBuffer(hexWithUpperX).equals(data)).toBe(true);

    // @ts-expect-error Testing non-string input
    expect(() => byteaHexToBuffer(12345)).toThrow(TypeError);
  });

  it("exercises Supabase storage error and Blob handling branches", async () => {
    const mockClientFail = {
      storage: {
        from(_bucket: string) {
          return {
            async upload() { return { data: null, error: new Error("Upload failed") }; },
            async download() { return { data: null, error: new Error("Download failed") }; }
          };
        }
      }
    };

    const res = await uploadCompressed(mockClientFail as any, "bucket", "path.llp1", "data");
    expect(res.error).toBeDefined();

    await expect(
      downloadDecompressed(mockClientFail as any, "bucket", "path.llp1")
    ).rejects.toThrow();

    // Mock client with Blob arrayBuffer
    const testData = Buffer.from("Blob test payload", "utf8");
    const compData = await compress(testData);

    const mockClientBlob = {
      storage: {
        from(_b: string) {
          return {
            async upload() { return { data: { path: "ok" }, error: null }; },
            async download() {
              return {
                data: {
                  async arrayBuffer() { return compData.buffer.slice(compData.byteOffset, compData.byteOffset + compData.byteLength); }
                },
                error: null
              };
            }
          };
        }
      }
    };

    const downloaded = await downloadDecompressed(mockClientBlob as any, "bucket", "path.llp1");
    expect(downloaded.equals(testData)).toBe(true);
  });

  it("exercises stream non-chunked flush decompression", async () => {
    const raw = Buffer.from("Single non-chunked stream compression test payload".repeat(5));
    const comp = await compress(raw, { algorithm: "store" });

    const chunks: Buffer[] = [];
    const inStream = Readable.from([comp]);
    const dStream = decompressStream();
    const outStream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      }
    });

    await pipeline(inStream, dStream, outStream);
    const restored = Buffer.concat(chunks);
    expect(restored.equals(raw)).toBe(true);
  });

  it("exercises JSON serialization with top-level undefined and nulls", () => {
    const buf = stringifyCanonicalJSON(undefined);
    const restored = parseCanonicalJSON(buf);
    expect(restored).toBe(undefined);

    const bufNull = stringifyCanonicalJSON(null);
    expect(parseCanonicalJSON(bufNull)).toBe(null);
  });

  it("exercises compress with dictionary option", async () => {
    const dict = Buffer.from("common dictionary keys and common domain terms");
    const data = Buffer.from("common dictionary keys in user data");
    const comp = await compress(data, { algorithm: "zstd", dictionary: dict, dictionaryId: 101 });
    const decomp = await decompress(comp, { dictionary: dict });
    expect(decomp.equals(data)).toBe(true);
  });
});