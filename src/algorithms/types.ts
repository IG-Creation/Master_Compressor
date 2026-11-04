/**
 * losslesspack - Algorithm Types & Options
 */

import { AlgorithmId } from "../format.js";

export type AlgorithmName = "auto" | "store" | "gzip" | "brotli" | "zstd";

export interface CompressOptions {
  /**
   * Target compression algorithm.
   * - "auto": inspects entropy and samples algorithms to pick best ratio.
   * - "store": uncompressed raw storage.
   * - "gzip": standard Deflate/Gzip via Node built-in zlib.
   * - "brotli": RFC 7932 Brotli via Node built-in zlib.
   * - "zstd": Zstandard (falls back to brotli if native zstd is unavailable).
   * @default "auto"
   */
  algorithm?: AlgorithmName;

  /**
   * Compression level (engine-specific).
   */
  level?: number;

  /**
   * Pre-shared dictionary buffer for dictionary compression (zstd).
   */
  dictionary?: Buffer | Uint8Array;

  /**
   * Numeric identifier for the dictionary (recorded in container header).
   */
  dictionaryId?: number;

  /**
   * Maximum allowed decompressed size in bytes to prevent zip bomb attacks.
   * @default 1_073_741_824 (1 GiB)
   */
  maxDecompressedSize?: number;

  /**
   * Self-verification flag: verify decompression and SHA-256 in memory before returning.
   * If verification fails, automatically falls back to uncompressed "store" mode.
   * @default true
   */
  verify?: boolean;

  /**
   * Chunk size in bytes for streaming/chunked mode.
   * @default 4_194_304 (4 MiB)
   */
  chunkSize?: number;
}

export interface DecompressOptions {
  /**
   * Maximum allowed decompressed size in bytes to prevent zip bomb attacks.
   * @default 1_073_741_824 (1 GiB)
   */
  maxDecompressedSize?: number;

  /**
   * Pre-shared dictionary buffer if container was compressed with dictionary.
   */
  dictionary?: Buffer | Uint8Array;

  /**
   * Whether to compute and verify SHA-256 and length on decompression.
   * @default true
   */
  verify?: boolean;
}

export interface AlgorithmEngine {
  readonly id: AlgorithmId;
  readonly name: AlgorithmName;
  compress(input: Buffer, level?: number, dict?: Buffer): Promise<Buffer>;
  decompress(input: Buffer, dict?: Buffer): Promise<Buffer>;
}
