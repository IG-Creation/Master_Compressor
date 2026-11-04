/**
 * losslesspack - Container Format & Header Serialization
 * Version 1 (LLP1) binary header packing and unpacking with CRC32.
 */

import {
  InvalidMagicError,
  UnsupportedVersionError,
  CorruptHeaderError,
  TruncatedDataError
} from "./errors.js";

export const MAGIC = Buffer.from([0x4c, 0x4c, 0x50, 0x31]); // "LLP1"
export const CURRENT_VERSION = 1;
export const HEADER_SIZE = 55; // 4 + 1 + 1 + 1 + 4 + 8 + 32 + 4

export enum AlgorithmId {
  STORE = 0,
  GZIP = 1,
  BROTLI = 2,
  ZSTD = 3,
  ZSTD_DICT = 4
}

export enum HeaderFlags {
  NONE = 0x00,
  HAS_DICTIONARY_ID = 0x01,
  CHUNKED_STREAM = 0x02
}

export function algoIdToName(id: AlgorithmId): string {
  switch (id) {
    case AlgorithmId.STORE: return "store";
    case AlgorithmId.GZIP: return "gzip";
    case AlgorithmId.BROTLI: return "brotli";
    case AlgorithmId.ZSTD: return "zstd";
    case AlgorithmId.ZSTD_DICT: return "zstd-dict";
    default: return `unknown(${id})`;
  }
}

export interface ContainerHeader {
  magic: string;
  version: number;
  algorithmId: AlgorithmId;
  algorithmName: string;
  flags: number;
  dictionaryId: number;
  originalLength: bigint;
  sha256: Buffer;
  sha256Hex: string;
  crc32: number;
}

export interface HeaderInput {
  algorithmId: AlgorithmId;
  flags?: number;
  dictionaryId?: number;
  originalLength: bigint | number;
  sha256: Buffer;
}

// Precomputed CRC32 table (IEEE 802.3 polynomial: 0xEDB88320)
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

/**
 * Computes standard IEEE 802.3 CRC32 checksum for a buffer.
 */
export function computeCRC32(buf: Uint8Array | Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return ((crc ^ 0xffffffff) >>> 0);
}

/**
 * Packs a ContainerHeader into a 55-byte binary buffer.
 */
export function packHeader(input: HeaderInput): Buffer {
  const buf = Buffer.alloc(HEADER_SIZE);
  // Magic: 4 bytes
  MAGIC.copy(buf, 0);
  // Version: 1 byte
  buf.writeUInt8(CURRENT_VERSION, 4);
  // Algorithm ID: 1 byte
  buf.writeUInt8(input.algorithmId, 5);
  // Flags: 1 byte
  const flags = input.flags ?? (input.dictionaryId ? HeaderFlags.HAS_DICTIONARY_ID : HeaderFlags.NONE);
  buf.writeUInt8(flags, 6);
  // Dictionary ID: 4 bytes
  buf.writeUInt32BE(input.dictionaryId ?? 0, 7);
  // Original Length: 8 bytes (uint64)
  buf.writeBigUInt64BE(BigInt(input.originalLength), 11);
  // SHA-256: 32 bytes
  if (input.sha256.length !== 32) {
    throw new Error(`Invalid SHA-256 length: expected 32 bytes, got ${input.sha256.length}`);
  }
  input.sha256.copy(buf, 19);
  // Header CRC32: 4 bytes (computed over bytes 0..50)
  const headerCrc = computeCRC32(buf.subarray(0, 51));
  buf.writeUInt32BE(headerCrc, 51);

  return buf;
}

/**
 * Parses and verifies a 55-byte ContainerHeader from a buffer.
 */
export function unpackHeader(buf: Buffer | Uint8Array): ContainerHeader {
  if (buf.length < HEADER_SIZE) {
    throw new TruncatedDataError(
      `Buffer too small for container header. Needed ${HEADER_SIZE} bytes, got ${buf.length}.`
    );
  }

  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);

  // 1. Verify Magic
  if (!b.subarray(0, 4).equals(MAGIC)) {
    throw new InvalidMagicError();
  }

  // 2. Verify CRC32
  const expectedCrc = b.readUInt32BE(51);
  const actualCrc = computeCRC32(b.subarray(0, 51));
  if (expectedCrc !== actualCrc) {
    throw new CorruptHeaderError(
      `Header CRC32 mismatch: expected 0x${expectedCrc.toString(16)}, computed 0x${actualCrc.toString(16)}.`
    );
  }

  // 3. Verify Version
  const version = b.readUInt8(4);
  if (version !== CURRENT_VERSION) {
    throw new UnsupportedVersionError(version);
  }

  const algorithmId = b.readUInt8(5) as AlgorithmId;
  const flags = b.readUInt8(6);
  const dictionaryId = b.readUInt32BE(7);
  const originalLength = b.readBigUInt64BE(11);
  const sha256 = Buffer.from(b.subarray(19, 51));
  const sha256Hex = sha256.toString("hex");

  return {
    magic: "LLP1",
    version,
    algorithmId,
    algorithmName: algoIdToName(algorithmId),
    flags,
    dictionaryId,
    originalLength,
    sha256,
    sha256Hex,
    crc32: expectedCrc
  };
}

export const parseHeader = unpackHeader;