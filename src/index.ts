/**
 * losslesspack - Production-Grade Lossless Data Compression Library
 * Zero data loss guarantees, self-describing container format, and tamper verification.
 */

import crypto from "node:crypto";
import {
  HEADER_SIZE,
  AlgorithmId,
  ContainerHeader,
  packHeader,
  unpackHeader
} from "./format.js";
import {
  ChecksumMismatchError,
  SizeLimitExceededError,
  AlgorithmUnavailableError
} from "./errors.js";
import { CompressOptions, DecompressOptions } from "./algorithms/types.js";
import { GzipEngine } from "./algorithms/gzip.js";
import { BrotliEngine } from "./algorithms/brotli.js";
import { ZstdEngine, isZstdAvailable } from "./algorithms/zstd.js";
import { selectOptimalAlgorithm } from "./algorithms/auto.js";
import { stringifyCanonicalJSON, parseCanonicalJSON } from "./json.js";

export * from "./errors.js";
export * from "./format.js";
export * from "./algorithms/types.js";
export * from "./stream.js";
export * from "./file.js";
export * from "./json.js";

const gzipEngine = new GzipEngine();
const brotliEngine = new BrotliEngine();
const zstdEngine = new ZstdEngine();

/**
 * Normalizes input to a Node Buffer. Throws TypeError on invalid types.
 */
function toBuffer(input: unknown): Buffer {
  if (input === null || input === undefined) {
    throw new TypeError(`Expected Uint8Array, Buffer, or string, received ${String(input)}`);
  }
  if (Buffer.isBuffer(input)) {
    return input;
  }
  if (input instanceof Uint8Array) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  if (typeof input === "string") {
    return Buffer.from(input, "utf8");
  }
  throw new TypeError(`Expected Uint8Array, Buffer, or string, received ${typeof input}`);
}

/**
 * Compresses any binary or string input into a tamper-evident LLP1 container.
 *
 * Guarantees:
 * - Bit-for-bit lossless roundtrip.
 * - In-memory decompression self-verification before returning.
 * - Negative-compression protection (falls back to uncompressed store mode if output >= input).
 */
export async function compress(
  input: Uint8Array | Buffer | string,
  opts?: CompressOptions
): Promise<Buffer> {
  const buf = toBuffer(input);
  const origLen = buf.length;
  const sha256 = crypto.createHash("sha256").update(buf).digest();

  // 1. Determine algorithm
  const reqAlgo = opts?.algorithm ?? "auto";
  let targetAlgoId: AlgorithmId;

  if (reqAlgo === "auto") {
    const auto = await selectOptimalAlgorithm(buf);
    targetAlgoId = auto.id;
  } else if (reqAlgo === "store") {
    targetAlgoId = AlgorithmId.STORE;
  } else if (reqAlgo === "gzip") {
    targetAlgoId = AlgorithmId.GZIP;
  } else if (reqAlgo === "brotli") {
    targetAlgoId = AlgorithmId.BROTLI;
  } else if (reqAlgo === "zstd") {
    if (isZstdAvailable()) {
      targetAlgoId = AlgorithmId.ZSTD;
    } else {
      // Graceful fallback to brotli
      targetAlgoId = AlgorithmId.BROTLI;
    }
  } else {
    throw new TypeError(`Unsupported algorithm: ${String(reqAlgo)}`);
  }

  // If store algorithm requested directly
  if (targetAlgoId === AlgorithmId.STORE) {
    const header = packHeader({
      algorithmId: AlgorithmId.STORE,
      originalLength: origLen,
      sha256
    });
    return Buffer.concat([header, buf]);
  }

  // 2. Execute compression
  let compressedPayload: Buffer;
  let dictBuffer: Buffer | undefined;
  if (opts?.dictionary) {
    dictBuffer = Buffer.isBuffer(opts.dictionary) ? opts.dictionary : Buffer.from(opts.dictionary);
  }

  try {
    if (targetAlgoId === AlgorithmId.GZIP) {
      compressedPayload = await gzipEngine.compress(buf, opts?.level);
    } else if (targetAlgoId === AlgorithmId.BROTLI) {
      compressedPayload = await brotliEngine.compress(buf, opts?.level);
    } else {
      compressedPayload = await zstdEngine.compress(buf, opts?.level, dictBuffer);
    }
  } catch {
    // Compression engine failed; fallback to store mode without throwing away original
    targetAlgoId = AlgorithmId.STORE;
    compressedPayload = buf;
  }

  // 3. Guarantee 3: Negative compression check
  // If compressed output is not smaller than original, store uncompressed
  if (compressedPayload.length >= origLen && origLen > 0) {
    targetAlgoId = AlgorithmId.STORE;
    compressedPayload = buf;
  }

  // 4. Guarantee 2: Self-verification
  // In-memory decompression and SHA-256 comparison
  if (opts?.verify !== false && targetAlgoId !== AlgorithmId.STORE) {
    try {
      let verified: Buffer;
      if (targetAlgoId === AlgorithmId.GZIP) {
        verified = await gzipEngine.decompress(compressedPayload);
      } else if (targetAlgoId === AlgorithmId.BROTLI) {
        verified = await brotliEngine.decompress(compressedPayload);
      } else {
        verified = await zstdEngine.decompress(compressedPayload, dictBuffer);
      }

      const verifiedSha = crypto.createHash("sha256").update(verified).digest();
      if (!verifiedSha.equals(sha256)) {
        // Verification failed! Fallback to uncompressed store mode
        targetAlgoId = AlgorithmId.STORE;
        compressedPayload = buf;
      }
    } catch {
      // Verification error; fallback to store mode
      targetAlgoId = AlgorithmId.STORE;
      compressedPayload = buf;
    }
  }

  // 5. Build envelope header
  const header = packHeader({
    algorithmId: targetAlgoId,
    dictionaryId: opts?.dictionaryId,
    originalLength: origLen,
    sha256
  });

  return Buffer.concat([header, compressedPayload]);
}

/**
 * Decompresses a losslesspack container back to its exact uncompressed byte representation.
 * Verifies both length and cryptographic SHA-256 checksum stored in the header.
 */
export async function decompress(
  input: Uint8Array | Buffer,
  opts?: DecompressOptions
): Promise<Buffer> {
  const buf = toBuffer(input);
  const header = unpackHeader(buf);

  const maxAllowed = opts?.maxDecompressedSize ?? 1_073_741_824; // 1 GiB default
  if (header.originalLength > BigInt(maxAllowed)) {
    throw new SizeLimitExceededError(header.originalLength, maxAllowed);
  }

  const payload = buf.subarray(HEADER_SIZE);
  let decompressed: Buffer;
  let dictBuffer: Buffer | undefined;
  if (opts?.dictionary) {
    dictBuffer = Buffer.isBuffer(opts.dictionary) ? opts.dictionary : Buffer.from(opts.dictionary);
  }

  switch (header.algorithmId) {
    case AlgorithmId.STORE:
      decompressed = Buffer.from(payload);
      break;
    case AlgorithmId.GZIP:
      decompressed = await gzipEngine.decompress(payload);
      break;
    case AlgorithmId.BROTLI:
      decompressed = await brotliEngine.decompress(payload);
      break;
    case AlgorithmId.ZSTD:
    case AlgorithmId.ZSTD_DICT:
      decompressed = await zstdEngine.decompress(payload, dictBuffer);
      break;
    default:
      throw new AlgorithmUnavailableError(`Unknown algorithm ID ${header.algorithmId}`);
  }

  // Length verification
  if (BigInt(decompressed.length) !== header.originalLength) {
    throw new ChecksumMismatchError(
      `length ${header.originalLength.toString()}`,
      `length ${decompressed.length}`
    );
  }

  // Cryptographic SHA-256 verification
  if (opts?.verify !== false) {
    const actualSha = crypto.createHash("sha256").update(decompressed).digest();
    if (!actualSha.equals(header.sha256)) {
      throw new ChecksumMismatchError(
        header.sha256.toString("hex"),
        actualSha.toString("hex")
      );
    }
  }

  return decompressed;
}

/**
 * Losslessly serializes an object into canonical JSON and compresses it into an LLP1 container.
 */
export async function compressJSON(value: unknown, opts?: CompressOptions): Promise<Buffer> {
  const jsonBuf = stringifyCanonicalJSON(value);
  return compress(jsonBuf, opts);
}

/**
 * Decompresses an LLP1 container and parses it back into an exact JavaScript object.
 */
export async function decompressJSON<T = unknown>(
  buf: Uint8Array | Buffer,
  opts?: DecompressOptions
): Promise<T> {
  const rawBuf = await decompress(buf, opts);
  return parseCanonicalJSON<T>(rawBuf);
}

/**
 * Inspects a losslesspack container header without decompressing the payload.
 */
export function inspectContainer(buf: Uint8Array | Buffer): ContainerHeader {
  return unpackHeader(buf);
}