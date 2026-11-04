/**
 * losslesspack - Filesystem Storage Adapter
 * Pure hash-addressed on-disk storage with embedded key headers.
 * Safe across all operating systems (Windows, Linux, macOS) for unicode,
 * arbitrary length keys, emojis, slashes, and special characters.
 */

import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { BaseAdapter } from "./base.js";
import { AdapterCapabilities, ListResult } from "./types.js";
import { AdapterConnectionError } from "./errors.js";

export class FilesystemStorageAdapter extends BaseAdapter {
  readonly name = "filesystem";
  private readonly rootDir: string;
  private readonly maxValSize: number;
  private readonly keyIndex = new Map<string, string>(); // key -> hash
  private initialized = false;

  constructor(options: { rootDir?: string; baseDir?: string; maxValueSizeBytes?: number } = {}) {
    super();
    const dir = options.rootDir || options.baseDir || "./.losslesspack_storage";
    this.rootDir = path.resolve(dir);
    this.maxValSize = options.maxValueSizeBytes ?? 100 * 1024 * 1024;
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
  }

  capabilities(): AdapterCapabilities {
    return {
      maxValueSizeBytes: this.maxValSize,
      atomicWrites: true,
      supportsPrefixList: true,
      supportsBatchPut: true,
      supportsMetadata: false
    };
  }

  private keyToHash(key: string): string {
    return crypto.createHash("sha256").update(key).digest("hex");
  }

  private hashToPath(hash: string): string {
    return path.join(this.rootDir, `${hash}.llp`);
  }

  private async ensureIndex(): Promise<void> {
    if (this.initialized) return;
    try {
      const files = await fsp.readdir(this.rootDir);
      for (const f of files) {
        if (f.endsWith(".llp") && !f.includes(".tmp.")) {
          const filePath = path.join(this.rootDir, f);
          try {
            const fd = await fsp.open(filePath, "r");
            const lenBuf = Buffer.alloc(4);
            const { bytesRead } = await fd.read(lenBuf, 0, 4, 0);
            if (bytesRead === 4) {
              const keyLen = lenBuf.readUInt32BE(0);
              const keyBuf = Buffer.alloc(keyLen);
              await fd.read(keyBuf, 0, keyLen, 4);
              const key = keyBuf.toString("utf8");
              this.keyIndex.set(key, f.replace(".llp", ""));
            }
            await fd.close();
          } catch {
            // ignore corrupted record
          }
        }
      }
    } catch {
      // ignore readdir error
    }
    this.initialized = true;
  }

  protected async rawPut(key: string, bytes: Buffer): Promise<void> {
    const hash = this.keyToHash(key);
    const destPath = this.hashToPath(hash);
    const tempPath = `${destPath}.tmp.${crypto.randomBytes(6).toString("hex")}`;

    const keyBuf = Buffer.from(key, "utf8");
    const headerBuf = Buffer.alloc(4);
    headerBuf.writeUInt32BE(keyBuf.length, 0);

    const fullBuffer = Buffer.concat([headerBuf, keyBuf, bytes]);

    try {
      await fsp.writeFile(tempPath, fullBuffer);
      const fd = await fsp.open(tempPath, "r+");
      await fd.sync();
      await fd.close();
      await fsp.rename(tempPath, destPath);
      this.keyIndex.set(key, hash);
    } catch (err) {
      try {
        if (fs.existsSync(tempPath)) await fsp.unlink(tempPath);
      } catch {
        // Ignore cleanup error
      }
      throw new AdapterConnectionError(this.name, `Failed to write file for key ${key}: ${String(err)}`);
    }
  }

  protected async rawGet(key: string): Promise<Buffer | null> {
    const hash = this.keyToHash(key);
    const destPath = this.hashToPath(hash);

    try {
      const fullBuffer = await fsp.readFile(destPath);
      if (fullBuffer.length < 4) return null;
      const keyLen = fullBuffer.readUInt32BE(0);
      if (fullBuffer.length < 4 + keyLen) return null;
      return fullBuffer.subarray(4 + keyLen);
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw new AdapterConnectionError(this.name, `Failed to read key ${key}: ${String(err)}`);
    }
  }

  protected async rawDelete(key: string): Promise<boolean> {
    const hash = this.keyToHash(key);
    const destPath = this.hashToPath(hash);
    this.keyIndex.delete(key);

    try {
      await fsp.unlink(destPath);
      return true;
    } catch (err: any) {
      if (err.code === "ENOENT") return false;
      throw new AdapterConnectionError(this.name, `Failed to delete key ${key}: ${String(err)}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    const hash = this.keyToHash(key);
    const destPath = this.hashToPath(hash);
    return fs.existsSync(destPath);
  }

  async list(prefix = "", cursor?: string, limit = 100): Promise<ListResult> {
    await this.ensureIndex();

    const allKeys = Array.from(this.keyIndex.keys())
      .filter((k) => k.startsWith(prefix) && !k.includes(".__llp_part__."))
      .sort();

    let startIndex = 0;
    if (cursor) {
      const idx = allKeys.indexOf(cursor);
      startIndex = idx !== -1 ? idx + 1 : 0;
    }

    const page = allKeys.slice(startIndex, startIndex + limit);
    const nextCursor = page.length === limit && startIndex + limit < allKeys.length
      ? page[page.length - 1]
      : undefined;

    return { keys: page, nextCursor };
  }
}