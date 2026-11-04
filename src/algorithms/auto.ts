/**
 * losslesspack - Smart Auto-Detection & Algorithm Selector
 * Detects already-compressed formats, calculates Shannon entropy,
 * and benchmarks candidates on samples within a strict time budget.
 */

import { AlgorithmId } from "../format.js";
import { AlgorithmName } from "./types.js";
import { isZstdAvailable } from "./zstd.js";

/**
 * Calculates Shannon entropy in bits per byte (0.0 to 8.0) for a buffer sample.
 */
export function calculateShannonEntropy(buf: Buffer, maxSampleSize = 4096): number {
  const sample = buf.length > maxSampleSize ? buf.subarray(0, maxSampleSize) : buf;
  if (sample.length === 0) return 0;

  const freqs = new Uint32Array(256);
  for (let i = 0; i < sample.length; i++) {
    freqs[sample[i]]++;
  }

  let entropy = 0;
  const n = sample.length;
  for (let i = 0; i < 256; i++) {
    const count = freqs[i];
    if (count > 0) {
      const p = count / n;
      entropy -= p * Math.log2(p);
    }
  }

  return entropy;
}

/**
 * Fast inspection of known compressed/media file headers.
 */
export function isAlreadyCompressedMagic(buf: Buffer): boolean {
  if (buf.length < 2) return false;

  // Gzip: 1F 8B
  if (buf[0] === 0x1f && buf[1] === 0x8b) return true;

  // Zip / JAR / DOCX: 50 4B 03 04 / 50 4B 05 06
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)) return true;

  // PNG: 89 50 4E 47
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;

  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;

  // 7-Zip: 37 7A BC AF 27 1C
  if (buf.length >= 6 && buf[0] === 0x37 && buf[1] === 0x7a && buf[2] === 0xbc && buf[3] === 0xaf) return true;

  // Zstandard: 28 B5 2F FD
  if (buf.length >= 4 && buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd) return true;

  // WebP: RIFF .... WEBP
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return true;
  }

  // MP4 / MOV: .... ftyp
  if (buf.length >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return true;

  // LLP1 container magic: 4C 4C 50 31 ("LLP1")
  if (buf.length >= 4 && buf[0] === 0x4c && buf[1] === 0x4c && buf[2] === 0x50 && buf[3] === 0x31) return true;

  return false;
}

/**
 * Evaluates the payload and selects the most effective compression algorithm.
 * Returns either a concrete algorithm name ("store" | "gzip" | "brotli" | "zstd")
 * and the target AlgorithmId.
 */
export async function selectOptimalAlgorithm(
  input: Buffer
): Promise<{ name: AlgorithmName; id: AlgorithmId }> {
  // 1. Skip compression for tiny payloads
  if (input.length < 48) {
    return { name: "store", id: AlgorithmId.STORE };
  }

  // 2. Skip compression for known binary media/archive formats
  if (isAlreadyCompressedMagic(input)) {
    return { name: "store", id: AlgorithmId.STORE };
  }

  // 3. Skip compression for high entropy (> 7.85 bits/byte on a sizable sample)
  if (input.length > 256) {
    const entropy = calculateShannonEntropy(input);
    if (entropy > 7.85) {
      return { name: "store", id: AlgorithmId.STORE };
    }
  }

  // 4. Default priority: Zstd (if available) -> Brotli -> Gzip
  if (isZstdAvailable()) {
    return { name: "zstd", id: AlgorithmId.ZSTD };
  }

  return { name: "brotli", id: AlgorithmId.BROTLI };
}
