/**
 * losslesspack - In-Memory Storage Adapter
 */

import { BaseAdapter } from "./base.js";
import { AdapterCapabilities, ListResult } from "./types.js";

export class MemoryStorageAdapter extends BaseAdapter {
  readonly name = "memory";
  private readonly store = new Map<string, Buffer>();
  private readonly metadataStore = new Map<string, Record<string, unknown>>();
  private readonly maxValSize: number;

  constructor(options?: { maxValueSizeBytes?: number }) {
    super();
    this.maxValSize = options?.maxValueSizeBytes ?? 100 * 1024 * 1024; // 100 MB default
  }

  capabilities(): AdapterCapabilities {
    return {
      maxValueSizeBytes: this.maxValSize,
      atomicWrites: true,
      supportsPrefixList: true,
      supportsBatchPut: true,
      supportsMetadata: true
    };
  }

  protected async rawPut(key: string, bytes: Buffer, meta?: Record<string, unknown>): Promise<void> {
    this.store.set(key, Buffer.from(bytes));
    if (meta) {
      this.metadataStore.set(key, { ...meta });
    }
  }

  protected async rawGet(key: string): Promise<Buffer | null> {
    const val = this.store.get(key);
    return val ? Buffer.from(val) : null;
  }

  protected async rawDelete(key: string): Promise<boolean> {
    this.metadataStore.delete(key);
    return this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async list(prefix = "", cursor?: string, limit = 100): Promise<ListResult> {
    const allKeys = Array.from(this.store.keys())
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

  async clear(): Promise<void> {
    this.store.clear();
    this.metadataStore.clear();
  }
}