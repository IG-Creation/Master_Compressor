/**
 * losslesspack - Zstandard Algorithm with Automatic Fallback
 * Algorithm ID: 3 (zstd) & 4 (zstd-dict)
 */

import { AlgorithmId } from "../format.js";
import { AlgorithmUnavailableError } from "../errors.js";
import { AlgorithmEngine } from "./types.js";
import { BrotliEngine } from "./brotli.js";

interface ZstdModule {
  compress(input: Buffer, level?: number): Promise<Buffer>;
  decompress(input: Buffer): Promise<Buffer>;
  compressUsingDict?(input: Buffer, dict: Buffer, level?: number): Promise<Buffer>;
  decompressUsingDict?(input: Buffer, dict: Buffer): Promise<Buffer>;
}

let cachedZstdModule: ZstdModule | null | undefined = undefined;

export function isZstdAvailable(): boolean {
  if (cachedZstdModule !== undefined) {
    return cachedZstdModule !== null;
  }
  try {
    // Attempt dynamic require
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@mongodb-js/zstd") as ZstdModule;
    if (typeof mod.compress === "function" && typeof mod.decompress === "function") {
      cachedZstdModule = mod;
      return true;
    }
  } catch {
    // Optional dependency not installed or unsupported platform
  }
  cachedZstdModule = null;
  return false;
}

export function getZstdModule(): ZstdModule | null {
  if (cachedZstdModule === undefined) {
    isZstdAvailable();
  }
  return cachedZstdModule ?? null;
}

export class ZstdEngine implements AlgorithmEngine {
  readonly id = AlgorithmId.ZSTD;
  readonly name = "zstd" as const;
  private readonly brotliFallback = new BrotliEngine();

  async compress(input: Buffer, level = 3, dict?: Buffer): Promise<Buffer> {
    const mod = getZstdModule();
    if (mod) {
      if (dict && typeof mod.compressUsingDict === "function") {
        return mod.compressUsingDict(input, dict, level);
      }
      return mod.compress(input, level);
    }
    // Fallback to brotli
    return this.brotliFallback.compress(input);
  }

  async decompress(input: Buffer, dict?: Buffer): Promise<Buffer> {
    const mod = getZstdModule();
    if (!mod) {
      throw new AlgorithmUnavailableError("zstd");
    }
    if (dict && typeof mod.decompressUsingDict === "function") {
      return mod.decompressUsingDict(input, dict);
    }
    return mod.decompress(input);
  }
}
