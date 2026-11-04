/**
 * losslesspack - Redis Storage Adapter
 * Lazy loads "ioredis" or "redis", or accepts an injected client.
 */

import { BaseAdapter } from "./base.js";
import { AdapterCapabilities, ListResult } from "./types.js";
import { AdapterUnavailableError, AdapterConnectionError } from "./errors.js";

export interface RedisAdapterOptions {
  url?: string;
  client?: any; // ioredis or redis client
  keyPrefix?: string;
  maxValueSizeBytes?: number;
}

export class RedisStorageAdapter extends BaseAdapter {
  readonly name = "redis";
  private client: any;
  private readonly keyPrefix: string;
  private readonly maxValSize: number;

  constructor(options?: RedisAdapterOptions) {
    super();
    this.keyPrefix = options?.keyPrefix ?? "llp:";
    this.maxValSize = options?.maxValueSizeBytes ?? 512 * 1024 * 1024; // 512 MB max Redis string

    if (options?.client) {
      this.client = options.client;
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Redis = require("ioredis");
        this.client = new Redis(options?.url ?? "redis://localhost:6379");
      } catch {
        throw new AdapterUnavailableError(this.name, "Install 'ioredis' or 'redis' to use the Redis storage adapter.");
      }
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

  private fullKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private origKey(fullKey: string): string {
    return fullKey.startsWith(this.keyPrefix) ? fullKey.slice(this.keyPrefix.length) : fullKey;
  }

  protected async rawPut(key: string, bytes: Buffer): Promise<void> {
    try {
      const fk = this.fullKey(key);
      if (typeof this.client.setBuffer === "function") {
        await this.client.setBuffer(fk, bytes);
      } else {
        await this.client.set(fk, bytes);
      }
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to put key '${key}': ${String(err)}`);
    }
  }

  protected async rawGet(key: string): Promise<Buffer | null> {
    try {
      const fk = this.fullKey(key);
      let val: any;
      if (typeof this.client.getBuffer === "function") {
        val = await this.client.getBuffer(fk);
      } else {
        val = await this.client.get(fk);
      }
      if (!val) return null;
      return Buffer.isBuffer(val) ? val : Buffer.from(val);
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to get key '${key}': ${String(err)}`);
    }
  }

  protected async rawDelete(key: string): Promise<boolean> {
    try {
      const fk = this.fullKey(key);
      const res = await this.client.del(fk);
      return res > 0;
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to delete key '${key}': ${String(err)}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const fk = this.fullKey(key);
      const res = await this.client.exists(fk);
      return res > 0;
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to check existence: ${String(err)}`);
    }
  }

  async list(prefix = "", cursor = "0", limit = 100): Promise<ListResult> {
    try {
      const matchPattern = `${this.keyPrefix}${prefix}*`;
      let scanResult: [string, string[]];

      if (typeof this.client.scan === "function") {
        scanResult = await this.client.scan(cursor, "MATCH", matchPattern, "COUNT", limit);
      } else {
        scanResult = ["0", []];
      }

      const nextCursor = scanResult[0] !== "0" ? scanResult[0] : undefined;
      const keys = scanResult[1]
        .map((k) => this.origKey(k))
        .filter((k) => !k.includes(".__llp_part__."))
        .sort();

      return { keys, nextCursor };
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to list keys: ${String(err)}`);
    }
  }
}