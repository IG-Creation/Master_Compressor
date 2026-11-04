/**
 * losslesspack - PostgreSQL Storage Adapter
 * Lazy loads "pg" or accepts an injected pool/client.
 */

import { BaseAdapter } from "./base.js";
import { AdapterCapabilities, ListResult } from "./types.js";
import { AdapterUnavailableError, AdapterConnectionError } from "./errors.js";

export interface PostgresAdapterOptions {
  connectionString?: string;
  client?: any; // pg Pool or Client
  tableName?: string;
  maxValueSizeBytes?: number;
}

export class PostgresStorageAdapter extends BaseAdapter {
  readonly name = "postgres";
  private client: any;
  private readonly tableName: string;
  private readonly maxValSize: number;
  private initialized = false;

  constructor(options?: PostgresAdapterOptions) {
    super();
    this.tableName = options?.tableName ?? "losslesspack_records";
    this.maxValSize = options?.maxValueSizeBytes ?? 100 * 1024 * 1024;

    if (options?.client) {
      this.client = options.client;
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Pool } = require("pg");
        this.client = new Pool({ connectionString: options?.connectionString });
      } catch {
        throw new AdapterUnavailableError(this.name, "Install 'pg' to use the PostgreSQL storage adapter.");
      }
    }
  }

  private async initTable(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          key VARCHAR(512) PRIMARY KEY,
          val BYTEA NOT NULL,
          meta JSONB,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      this.initialized = true;
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to initialize PostgreSQL table: ${String(err)}`);
    }
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
    await this.initTable();
    try {
      await this.client.query(
        `INSERT INTO ${this.tableName} (key, val, meta, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val, meta = EXCLUDED.meta, updated_at = NOW();`,
        [key, bytes, meta ? JSON.stringify(meta) : null]
      );
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to put key '${key}': ${String(err)}`);
    }
  }

  protected async rawGet(key: string): Promise<Buffer | null> {
    await this.initTable();
    try {
      const res = await this.client.query(`SELECT val FROM ${this.tableName} WHERE key = $1;`, [key]);
      if (res.rows.length === 0 || !res.rows[0].val) return null;
      return Buffer.isBuffer(res.rows[0].val) ? res.rows[0].val : Buffer.from(res.rows[0].val);
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to get key '${key}': ${String(err)}`);
    }
  }

  protected async rawDelete(key: string): Promise<boolean> {
    await this.initTable();
    try {
      const res = await this.client.query(`DELETE FROM ${this.tableName} WHERE key = $1;`, [key]);
      return (res.rowCount ?? 0) > 0;
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to delete key '${key}': ${String(err)}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    await this.initTable();
    try {
      const res = await this.client.query(`SELECT 1 FROM ${this.tableName} WHERE key = $1;`, [key]);
      return res.rows.length > 0;
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to check existence: ${String(err)}`);
    }
  }

  async list(prefix = "", cursor?: string, limit = 100): Promise<ListResult> {
    await this.initTable();
    try {
      let query = `SELECT key FROM ${this.tableName} WHERE key LIKE $1`;
      const params: any[] = [`${prefix}%`];
      let pIdx = 2;
      if (cursor) {
        query += ` AND key > $${pIdx++}`;
        params.push(cursor);
      }
      query += ` AND key NOT LIKE '%.__llp_part__.%' ORDER BY key ASC LIMIT $${pIdx};`;
      params.push(limit);

      const res = await this.client.query(query, params);
      const keys = res.rows.map((r: any) => r.key);
      const nextCursor = keys.length === limit ? keys[keys.length - 1] : undefined;
      return { keys, nextCursor };
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to list keys: ${String(err)}`);
    }
  }
}