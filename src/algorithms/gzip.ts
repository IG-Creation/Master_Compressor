/**
 * losslesspack - Gzip Algorithm
 * Algorithm ID: 1
 */

import zlib from "node:zlib";
import { promisify } from "node:util";
import { AlgorithmId } from "../format.js";
import { AlgorithmEngine } from "./types.js";

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

export class GzipEngine implements AlgorithmEngine {
  readonly id = AlgorithmId.GZIP;
  readonly name = "gzip" as const;

  async compress(input: Buffer, level = 6): Promise<Buffer> {
    const validLevel = Math.max(0, Math.min(9, level));
    return gzipAsync(input, { level: validLevel });
  }

  async decompress(input: Buffer): Promise<Buffer> {
    return gunzipAsync(input);
  }
}
