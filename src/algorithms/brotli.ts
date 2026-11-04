/**
 * losslesspack - Brotli Algorithm
 * Algorithm ID: 2
 */

import zlib from "node:zlib";
import { promisify } from "node:util";
import { AlgorithmId } from "../format.js";
import { AlgorithmEngine } from "./types.js";

const brotliCompressAsync = promisify(zlib.brotliCompress);
const brotliDecompressAsync = promisify(zlib.brotliDecompress);

export class BrotliEngine implements AlgorithmEngine {
  readonly id = AlgorithmId.BROTLI;
  readonly name = "brotli" as const;

  async compress(input: Buffer, quality = 4): Promise<Buffer> {
    const validQuality = Math.max(0, Math.min(11, quality));
    return brotliCompressAsync(input, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: validQuality
      }
    });
  }

  async decompress(input: Buffer): Promise<Buffer> {
    return brotliDecompressAsync(input);
  }
}
