/**
 * losslesspack - Streaming & Chunked Compression Engine
 * Node Transform streams with backpressure, per-chunk CRC32 validation,
 * and end-of-stream SHA-256 footer verification.
 */

import { Transform, TransformCallback } from "node:stream";
import { createHash } from "node:crypto";
import {
  HEADER_SIZE,
  AlgorithmId,
  HeaderFlags,
  computeCRC32,
  packHeader,
  unpackHeader
} from "./format.js";
import {
  ChecksumMismatchError,
  CorruptHeaderError,
  TruncatedDataError,
  SizeLimitExceededError
} from "./errors.js";
import { CompressOptions, DecompressOptions } from "./algorithms/types.js";
import { StoreEngine } from "./algorithms/store.js";
import { GzipEngine } from "./algorithms/gzip.js";
import { BrotliEngine } from "./algorithms/brotli.js";
import { ZstdEngine, isZstdAvailable } from "./algorithms/zstd.js";

const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB

export class CompressTransformStream extends Transform {
  private readonly chunkSize: number;
  private readonly algoId: AlgorithmId;
  private buffer: Buffer;
  private headerWritten = false;
  private totalOriginalLength = 0n;
  private readonly sha256Hasher = createHash("sha256");
  private readonly engine: StoreEngine | GzipEngine | BrotliEngine | ZstdEngine;

  constructor(opts?: CompressOptions) {
    super();
    this.chunkSize = opts?.chunkSize ?? DEFAULT_CHUNK_SIZE;

    const reqAlgo = opts?.algorithm ?? "auto";
    if (reqAlgo === "store") {
      this.algoId = AlgorithmId.STORE;
      this.engine = new StoreEngine();
    } else if (reqAlgo === "gzip") {
      this.algoId = AlgorithmId.GZIP;
      this.engine = new GzipEngine();
    } else if (reqAlgo === "brotli") {
      this.algoId = AlgorithmId.BROTLI;
      this.engine = new BrotliEngine();
    } else if (reqAlgo === "zstd") {
      if (isZstdAvailable()) {
        this.algoId = AlgorithmId.ZSTD;
        this.engine = new ZstdEngine();
      } else {
        this.algoId = AlgorithmId.BROTLI;
        this.engine = new BrotliEngine();
      }
    } else {
      // "auto" stream default: Zstd if available, else Brotli
      if (isZstdAvailable()) {
        this.algoId = AlgorithmId.ZSTD;
        this.engine = new ZstdEngine();
      } else {
        this.algoId = AlgorithmId.BROTLI;
        this.engine = new BrotliEngine();
      }
    }

    this.buffer = Buffer.alloc(0);
  }

  private writeContainerHeader(): void {
    if (!this.headerWritten) {
      // In streaming mode, total length and total hash are finalized in stream footer
      const dummySha = Buffer.alloc(32, 0);
      const header = packHeader({
        algorithmId: this.algoId,
        flags: HeaderFlags.CHUNKED_STREAM,
        originalLength: 0n,
        sha256: dummySha
      });
      this.push(header);
      this.headerWritten = true;
    }
  }

  private async writeChunk(chunkData: Buffer): Promise<void> {
    if (chunkData.length === 0) return;
    this.totalOriginalLength += BigInt(chunkData.length);
    this.sha256Hasher.update(chunkData);

    const compressed = await this.engine.compress(chunkData);
    // If chunk compressed >= original, store raw chunk
    let payloadToWrite = compressed;
    let isChunkRaw = false;
    if (compressed.length >= chunkData.length) {
      payloadToWrite = chunkData;
      isChunkRaw = true;
    }

    // Chunk header (12 bytes):
    // compLen (4B) | origLen (4B) | crc32 (4B, over payload)
    const chunkHead = Buffer.alloc(12);
    // Use top bit of compLen as raw chunk indicator
    const compLenWithFlag = isChunkRaw ? (payloadToWrite.length | 0x80000000) : payloadToWrite.length;
    chunkHead.writeUInt32BE(compLenWithFlag >>> 0, 0);
    chunkHead.writeUInt32BE(chunkData.length, 4);
    const chunkCrc = computeCRC32(payloadToWrite);
    chunkHead.writeUInt32BE(chunkCrc, 8);

    this.push(Buffer.concat([chunkHead, payloadToWrite]));
  }

  override _transform(chunk: Buffer | Uint8Array, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.writeContainerHeader();
    const bufChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = Buffer.concat([this.buffer, bufChunk]);

    const processChunks = async () => {
      while (this.buffer.length >= this.chunkSize) {
        const slice = this.buffer.subarray(0, this.chunkSize);
        this.buffer = this.buffer.subarray(this.chunkSize);
        await this.writeChunk(slice);
      }
    };

    processChunks().then(() => callback()).catch(callback);
  }

  override _flush(callback: TransformCallback): void {
    const finishStream = async () => {
      this.writeContainerHeader();
      if (this.buffer.length > 0) {
        await this.writeChunk(this.buffer);
        this.buffer = Buffer.alloc(0);
      }

      // Final Footer:
      // Marker compLen=0 (4B) | totalOrigLen (8B) | totalSha256 (32B) | footerCrc32 (4B)
      const footer = Buffer.alloc(48);
      footer.writeUInt32BE(0, 0); // Marker
      footer.writeBigUInt64BE(this.totalOriginalLength, 4);
      const finalDigest = this.sha256Hasher.digest();
      finalDigest.copy(footer, 12);
      const footerCrc = computeCRC32(footer.subarray(0, 44));
      footer.writeUInt32BE(footerCrc, 44);

      this.push(footer);
    };

    finishStream().then(() => callback()).catch(callback);
  }
}

export class DecompressTransformStream extends Transform {
  private readonly maxDecompressedSize: number;
  private readonly verify: boolean;
  private buffer: Buffer = Buffer.alloc(0);
  private header: ReturnType<typeof unpackHeader> | null = null;
  private totalDecompressed = 0n;
  private readonly sha256Hasher = createHash("sha256");
  private engines = {
    [AlgorithmId.STORE]: new StoreEngine(),
    [AlgorithmId.GZIP]: new GzipEngine(),
    [AlgorithmId.BROTLI]: new BrotliEngine(),
    [AlgorithmId.ZSTD]: new ZstdEngine(),
    [AlgorithmId.ZSTD_DICT]: new ZstdEngine()
  };

  constructor(opts?: DecompressOptions) {
    super();
    this.maxDecompressedSize = opts?.maxDecompressedSize ?? 1_073_741_824;
    this.verify = opts?.verify ?? true;
  }

  override _transform(chunk: Buffer | Uint8Array, _encoding: BufferEncoding, callback: TransformCallback): void {
    const bufChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = Buffer.concat([this.buffer, bufChunk]);

    const processBuffer = async () => {
      // 1. Read header if not yet parsed
      if (!this.header) {
        if (this.buffer.length < HEADER_SIZE) return;
        this.header = unpackHeader(this.buffer.subarray(0, HEADER_SIZE));
        this.buffer = this.buffer.subarray(HEADER_SIZE);
      }

      const isChunked = (this.header.flags & HeaderFlags.CHUNKED_STREAM) !== 0;

      if (!isChunked) {
        // In non-chunked mode, wait for complete payload (handled in _flush)
        return;
      }

      // Process chunked stream
      while (this.buffer.length >= 12) {
        const rawCompLenWithFlag = this.buffer.readUInt32BE(0);
        if (rawCompLenWithFlag === 0) {
          // Footer reached! Check if footer buffer is complete (48 bytes: 4B marker + 8B len + 32B sha + 4B crc)
          if (this.buffer.length < 48) return; // Wait for full footer
          const footerBuf = this.buffer.subarray(0, 48);
          const expectedFooterCrc = footerBuf.readUInt32BE(44);
          const actualFooterCrc = computeCRC32(footerBuf.subarray(0, 44));
          if (expectedFooterCrc !== actualFooterCrc) {
            throw new CorruptHeaderError("Stream footer CRC32 verification failed.");
          }
          const expectedTotalLen = footerBuf.readBigUInt64BE(4);
          const expectedSha256 = footerBuf.subarray(12, 44);

          if (this.totalDecompressed !== expectedTotalLen) {
            throw new ChecksumMismatchError(
              `Total length ${expectedTotalLen.toString()} bytes`,
              `${this.totalDecompressed.toString()} bytes`
            );
          }

          if (this.verify) {
            const actualSha256 = this.sha256Hasher.digest();
            if (!actualSha256.equals(expectedSha256)) {
              throw new ChecksumMismatchError(
                expectedSha256.toString("hex"),
                actualSha256.toString("hex")
              );
            }
          }

          this.buffer = this.buffer.subarray(48);
          return;
        }

        const isChunkRaw = (rawCompLenWithFlag & 0x80000000) !== 0;
        const compLen = (rawCompLenWithFlag & 0x7fffffff) >>> 0;
        const origLen = this.buffer.readUInt32BE(4);
        const chunkCrc = this.buffer.readUInt32BE(8);

        const totalChunkSize = 12 + compLen;
        if (this.buffer.length < totalChunkSize) {
          // Need more bytes
          return;
        }

        const chunkPayload = this.buffer.subarray(12, totalChunkSize);
        this.buffer = this.buffer.subarray(totalChunkSize);

        // Verify chunk CRC32
        const computedCrc = computeCRC32(chunkPayload);
        if (computedCrc !== chunkCrc) {
          throw new CorruptHeaderError("Chunk CRC32 checksum mismatch. Chunk data corrupted.");
        }

        // Decompress chunk
        let uncompressedChunk: Buffer;
        if (isChunkRaw) {
          uncompressedChunk = chunkPayload;
        } else {
          const engine = this.engines[this.header.algorithmId];
          uncompressedChunk = await engine.decompress(chunkPayload);
        }

        if (uncompressedChunk.length !== origLen) {
          throw new ChecksumMismatchError(`Chunk length ${origLen}`, `${uncompressedChunk.length}`);
        }

        this.totalDecompressed += BigInt(uncompressedChunk.length);
        if (this.totalDecompressed > BigInt(this.maxDecompressedSize)) {
          throw new SizeLimitExceededError(this.totalDecompressed, this.maxDecompressedSize);
        }

        this.sha256Hasher.update(uncompressedChunk);
        this.push(uncompressedChunk);
      }
    };

    processBuffer().then(() => callback()).catch(callback);
  }

  override _flush(callback: TransformCallback): void {
    const finish = async () => {
      if (!this.header) {
        throw new TruncatedDataError("Stream ended without container header.");
      }

      const isChunked = (this.header.flags & HeaderFlags.CHUNKED_STREAM) !== 0;
      if (!isChunked) {
        // Non-chunked single stream decompression
        if (this.header.originalLength > BigInt(this.maxDecompressedSize)) {
          throw new SizeLimitExceededError(this.header.originalLength, this.maxDecompressedSize);
        }

        const engine = this.engines[this.header.algorithmId];
        const decompressed = await engine.decompress(this.buffer);

        if (BigInt(decompressed.length) !== this.header.originalLength) {
          throw new ChecksumMismatchError(
            `Original length ${this.header.originalLength.toString()}`,
            `${decompressed.length}`
          );
        }

        if (this.verify) {
          const actualSha = createHash("sha256").update(decompressed).digest();
          if (!actualSha.equals(this.header.sha256)) {
            throw new ChecksumMismatchError(
              this.header.sha256.toString("hex"),
              actualSha.toString("hex")
            );
          }
        }

        this.push(decompressed);
      }
    };

    finish().then(() => callback()).catch(callback);
  }
}

export function compressStream(opts?: CompressOptions): Transform {
  return new CompressTransformStream(opts);
}

export function decompressStream(opts?: DecompressOptions): Transform {
  return new DecompressTransformStream(opts);
}
