/**
 * losslesspack - Quarantine Store
 * Safely preserves corrupted, unwritten, or failed records to ensure zero data loss.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { QuarantineRecord } from "./types.js";

export interface IQuarantineStore {
  quarantine(record: QuarantineRecord): Promise<void>;
  list(): Promise<QuarantineRecord[]>;
  get(id: string): Promise<QuarantineRecord | null>;
  remove(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

export class MemoryQuarantineStore implements IQuarantineStore {
  private readonly records = new Map<string, QuarantineRecord>();

  async quarantine(record: QuarantineRecord): Promise<void> {
    this.records.set(record.id, {
      ...record,
      payload: Buffer.from(record.payload)
    });
  }

  async list(): Promise<QuarantineRecord[]> {
    return Array.from(this.records.values());
  }

  async get(id: string): Promise<QuarantineRecord | null> {
    const rec = this.records.get(id);
    return rec ? { ...rec, payload: Buffer.from(rec.payload) } : null;
  }

  async remove(id: string): Promise<boolean> {
    return this.records.delete(id);
  }

  async clear(): Promise<void> {
    this.records.clear();
  }
}

export class FilesystemQuarantineStore implements IQuarantineStore {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  async quarantine(record: QuarantineRecord): Promise<void> {
    await this.ensureDir();
    const metaPath = path.join(this.baseDir, `${record.id}.meta.json`);
    const binPath = path.join(this.baseDir, `${record.id}.bin`);

    const meta = {
      id: record.id,
      key: record.key,
      sha256: record.sha256,
      error: record.error,
      errorCode: record.errorCode,
      failedAt: record.failedAt,
      adapterName: record.adapterName,
      metadata: record.metadata
    };

    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
    await fs.writeFile(binPath, record.payload);
  }

  async list(): Promise<QuarantineRecord[]> {
    await this.ensureDir();
    const files = await fs.readdir(this.baseDir);
    const metaFiles = files.filter((f) => f.endsWith(".meta.json"));

    const records: QuarantineRecord[] = [];
    for (const mf of metaFiles) {
      const id = mf.replace(".meta.json", "");
      const rec = await this.get(id);
      if (rec) records.push(rec);
    }
    return records;
  }

  async get(id: string): Promise<QuarantineRecord | null> {
    const metaPath = path.join(this.baseDir, `${id}.meta.json`);
    const binPath = path.join(this.baseDir, `${id}.bin`);

    try {
      const metaContent = await fs.readFile(metaPath, "utf8");
      const meta = JSON.parse(metaContent);
      const payload = await fs.readFile(binPath);
      return {
        ...meta,
        payload
      };
    } catch {
      return null;
    }
  }

  async remove(id: string): Promise<boolean> {
    const metaPath = path.join(this.baseDir, `${id}.meta.json`);
    const binPath = path.join(this.baseDir, `${id}.bin`);
    let deleted = false;

    try {
      await fs.unlink(metaPath);
      deleted = true;
    } catch {
      // ignore
    }

    try {
      await fs.unlink(binPath);
      deleted = true;
    } catch {
      // ignore
    }

    return deleted;
  }

  async clear(): Promise<void> {
    await this.ensureDir();
    const files = await fs.readdir(this.baseDir);
    for (const f of files) {
      await fs.unlink(path.join(this.baseDir, f)).catch(() => {});
    }
  }
}