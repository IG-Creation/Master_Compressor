/**
 * losslesspack - SQLite Storage Adapter
 * Lazy loads "better-sqlite3" or "sqlite3", or accepts an injected connection.
 */

import { BaseAdapter } from "./base.js";
import { AdapterCapabilities, ListResult } from "./types.js";
import { AdapterUnavailableError, AdapterConnectionError } from "./errors.js";

export interface SQLiteAdapterOptions {
  filename?: string;
  tableName?: string;
  db?: any; // Existing db instance
  maxValueSizeBytes?: number;
}

export class SQLiteStorageAdapter extends BaseAdapter {
  readonly name = "sqlite";
  private db: any;
  private readonly tableName: string;
  private readonly maxValSize: number;
  private initialized = false;

  constructor(options?: SQLiteAdapterOptions) {
    super();
    this.tableName = options?.tableName ?? "losslesspack_records";
    this.maxValSize = options?.maxValueSizeBytes ?? 100 * 1024 * 1024;

    if (options?.db) {
      this.db = options.db;
    } else {
      const filename = options?.filename ?? ":memory:";
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Database = require("better-sqlite3");
        this.db = new Database(filename);
      } catch {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const sqlite3 = require("sqlite3");
          this.db = new sqlite3.Database(filename);
        } catch {
          throw new AdapterUnavailableError(
            this.name,
            "Install 'better-sqlite3' or 'sqlite3' to use the SQLite storage adapter."
          );
        }
      }
    }
  }

  private initTable(): void {
    if (this.initialized) return;
    try {
      if (typeof this.db.exec === "function") {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS ${this.tableName} (
            key TEXT PRIMARY KEY,
            val BLOB NOT NULL,
            meta TEXT,
            updated_at INTEGER NOT NULL
          );
        `);
      }
      this.initialized = true;
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to initialize SQLite table: ${String(err)}`);
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
    this.initTable();
    try {
      const metaStr = meta ? JSON.stringify(meta) : null;
      const now = Date.now();

      if (typeof this.db.prepare === "function") {
        // better-sqlite3 style
        const stmt = this.db.prepare(`
          INSERT INTO ${this.tableName} (key, val, meta, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET val = excluded.val, meta = excluded.meta, updated_at = excluded.updated_at;
        `);
        stmt.run(key, bytes, metaStr, now);
      } else if (typeof this.db.run === "function") {
        // sqlite3 style
        await new Promise<void>((resolve, reject) => {
          this.db.run(
            `INSERT OR REPLACE INTO ${this.tableName} (key, val, meta, updated_at) VALUES (?, ?, ?, ?);`,
            [key, bytes, metaStr, now],
            (err: any) => (err ? reject(err) : resolve())
          );
        });
      }
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to put key '${key}': ${String(err)}`);
    }
  }

  protected async rawGet(key: string): Promise<Buffer | null> {
    this.initTable();
    try {
      if (typeof this.db.prepare === "function") {
        const stmt = this.db.prepare(`SELECT val FROM ${this.tableName} WHERE key = ?;`);
        const row = stmt.get(key);
        return row && row.val ? Buffer.from(row.val) : null;
      } else if (typeof this.db.get === "function") {
        return new Promise<Buffer | null>((resolve, reject) => {
          this.db.get(
            `SELECT val FROM ${this.tableName} WHERE key = ?;`,
            [key],
            (err: any, row: any) => {
              if (err) return reject(err);
              resolve(row && row.val ? Buffer.from(row.val) : null);
            }
          );
        });
      }
      return null;
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to get key '${key}': ${String(err)}`);
    }
  }

  protected async rawDelete(key: string): Promise<boolean> {
    this.initTable();
    try {
      if (typeof this.db.prepare === "function") {
        const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE key = ?;`);
        const res = stmt.run(key);
        return res.changes > 0;
      } else if (typeof this.db.run === "function") {
        return new Promise<boolean>((resolve, reject) => {
          this.db.run(`DELETE FROM ${this.tableName} WHERE key = ?;`, [key], function (this: any, err: any) {
            if (err) return reject(err);
            resolve((this?.changes ?? 0) > 0);
          });
        });
      }
      return false;
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to delete key '${key}': ${String(err)}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    this.initTable();
    const val = await this.rawGet(key);
    return val !== null;
  }

  async list(prefix = "", cursor?: string, limit = 100): Promise<ListResult> {
    this.initTable();
    try {
      let query = `SELECT key FROM ${this.tableName} WHERE key LIKE ?`;
      const params: any[] = [`${prefix}%`];
      if (cursor) {
        query += ` AND key > ?`;
        params.push(cursor);
      }
      query += ` AND key NOT LIKE '%.__llp_part__.%' ORDER BY key ASC LIMIT ?;`;
      params.push(limit);

      let keys: string[] = [];
      if (typeof this.db.prepare === "function") {
        const rows = this.db.prepare(query).all(...params);
        keys = rows.map((r: any) => r.key);
      } else if (typeof this.db.all === "function") {
        keys = await new Promise<string[]>((resolve, reject) => {
          this.db.all(query, params, (err: any, rows: any[]) => {
            if (err) return reject(err);
            resolve(rows.map((r) => r.key));
          });
        });
      }

      const nextCursor = keys.length === limit ? keys[keys.length - 1] : undefined;
      return { keys, nextCursor };
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to list keys: ${String(err)}`);
    }
  }
}