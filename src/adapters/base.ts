/**
 * losslesspack - Base Adapter with Automatic Value Splitting & Manifest Management
 */

import crypto from "node:crypto";
import { StorageAdapter, AdapterCapabilities, ListResult, BatchPutItem } from "./types.js";
import { ChecksumMismatchError, TruncatedDataError } from "../errors.js";

const MANIFEST_MAGIC = Buffer.from("__LLP_SPLIT_MANIFEST__\n", "utf8");

export interface SplitPartMeta {
  partIndex: number;
  partKey: string;
  size: number;
  sha256: string;
}

export interface SplitManifest {
  magic: "__LLP_SPLIT_MANIFEST__";
  version: 1;
  originalKey: string;
  totalSize: number;
  totalSha256: string;
  partCount: number;
  parts: SplitPartMeta[];
}

export abstract class BaseAdapter implements StorageAdapter {
  abstract readonly name: string;
  abstract capabilities(): AdapterCapabilities;

  protected abstract rawPut(key: string, bytes: Buffer, meta?: Record<string, unknown>): Promise<void>;
  protected abstract rawGet(key: string): Promise<Buffer | null>;
  protected abstract rawDelete(key: string): Promise<boolean>;
  abstract exists(key: string): Promise<boolean>;
  abstract list(prefix?: string, cursor?: string, limit?: number): Promise<ListResult>;

  async put(key: string, bytes: Buffer, meta?: Record<string, unknown>): Promise<void> {
    const caps = this.capabilities();
    const maxVal = caps.maxValueSizeBytes;

    // Normal single-part write
    if (bytes.length <= maxVal) {
      return this.rawPut(key, bytes, meta);
    }

    // Value exceeds adapter's max size: Split into numbered parts with manifest
    const totalSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const partCount = Math.ceil(bytes.length / maxVal);
    const partsMeta: SplitPartMeta[] = [];

    for (let i = 0; i < partCount; i++) {
      const start = i * maxVal;
      const end = Math.min(bytes.length, start + maxVal);
      const partSlice = bytes.subarray(start, end);
      const partKey = `${key}.__llp_part__.${i}`;
      const partSha = crypto.createHash("sha256").update(partSlice).digest("hex");

      await this.rawPut(partKey, partSlice, { isPart: true, partIndex: i });
      partsMeta.push({
        partIndex: i,
        partKey,
        size: partSlice.length,
        sha256: partSha
      });
    }

    const manifest: SplitManifest = {
      magic: "__LLP_SPLIT_MANIFEST__",
      version: 1,
      originalKey: key,
      totalSize: bytes.length,
      totalSha256,
      partCount,
      parts: partsMeta
    };

    const manifestBuf = Buffer.concat([
      MANIFEST_MAGIC,
      Buffer.from(JSON.stringify(manifest), "utf8")
    ]);

    await this.rawPut(key, manifestBuf, { isManifest: true, totalSize: bytes.length });
  }

  async get(key: string): Promise<Buffer | null> {
    const raw = await this.rawGet(key);
    if (!raw) return null;

    // Check if this is a split manifest
    if (raw.length > MANIFEST_MAGIC.length && raw.subarray(0, MANIFEST_MAGIC.length).equals(MANIFEST_MAGIC)) {
      const jsonStr = raw.subarray(MANIFEST_MAGIC.length).toString("utf8");
      const manifest: SplitManifest = JSON.parse(jsonStr);

      const assembledParts: Buffer[] = [];
      let accumulatedSize = 0;

      for (const p of manifest.parts) {
        const partData = await this.rawGet(p.partKey);
        if (!partData) {
          throw new TruncatedDataError(`Missing split part ${p.partKey} for key ${key}`);
        }
        if (partData.length !== p.size) {
          throw new ChecksumMismatchError(`part size ${p.size}`, `${partData.length}`);
        }
        const actualPartSha = crypto.createHash("sha256").update(partData).digest("hex");
        if (actualPartSha !== p.sha256) {
          throw new ChecksumMismatchError(p.sha256, actualPartSha);
        }

        assembledParts.push(partData);
        accumulatedSize += partData.length;
      }

      const fullBuffer = Buffer.concat(assembledParts, accumulatedSize);
      const fullSha = crypto.createHash("sha256").update(fullBuffer).digest("hex");
      if (fullSha !== manifest.totalSha256) {
        throw new ChecksumMismatchError(manifest.totalSha256, fullSha);
      }

      return fullBuffer;
    }

    return raw;
  }

  async delete(key: string): Promise<boolean> {
    const raw = await this.rawGet(key);
    if (!raw) return false;

    // If manifest, clean up all parts
    if (raw.length > MANIFEST_MAGIC.length && raw.subarray(0, MANIFEST_MAGIC.length).equals(MANIFEST_MAGIC)) {
      try {
        const jsonStr = raw.subarray(MANIFEST_MAGIC.length).toString("utf8");
        const manifest: SplitManifest = JSON.parse(jsonStr);
        for (const p of manifest.parts) {
          await this.rawDelete(p.partKey);
        }
      } catch {
        // Ignore parse error on cleanup
      }
    }

    return this.rawDelete(key);
  }

  async putMany?(items: BatchPutItem[]): Promise<void> {
    for (const item of items) {
      await this.put(item.key, item.bytes, item.metadata);
    }
  }
}