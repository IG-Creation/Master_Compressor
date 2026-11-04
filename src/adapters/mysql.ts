/**
 * losslesspack - MySQL Storage Adapter
 * Lazy loads "mysql2" or accepts an injected connection/pool.
 */

import { BaseAdapter } from "./base.js";
import { AdapterCapabilities, ListResult } from "./types.js";
import { AdapterUnavailableError, AdapterConnectionError } from "./errors.js";

export interface MySQLAdapterOptions {
  connectionUri?: string;
  client?: any; // mysql2 pool or connection
  tableName?: string;
  maxValueSizeBytes?: number;
}

export class MySQLStorageAdapter extends BaseAdapter {
  readonly name = "mysql";
  private client: any;
  private readonly tableName: string;
  private readonly maxValSize: number;
  private initialized = false;

  constructor(options?: MySQLAdapterOptions) {
    super();
    this.tableName = options?.tableName ?? "losslesspack_records";
    this.maxValSize = options?.maxValueSizeBytes ?? 16 * 1024 * 1024; // 16 MB default for LONGBLOB

    if (options?.client) {
      this.client = options.client;
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mysql = require("mysql2/promise");
        this.client = mysql.createPool(options?.connectionUri ?? "mysql://localhost/test");
      } catch {
        throw new AdapterUnavailableError(this.name, "Install 'mysql2' to use the MySQL storage adapter.");
      }
    }
  }

  private async initTable(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          \`key\` VARCHAR(255) PRIMARY KEY,
          \`val\` LONGBLOB NOT NULL,
          \`meta\` JSON,
          \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );
      `);
      this.initialized = true;
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to initialize MySQL table: ${String(err)}`);
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
        `INSERT INTO ${this.tableName} (\`key\`, \`val\`, \`meta\`)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE \`val\` = VALUES(\`val\`), \`meta\` = VALUES(\`meta\`);`,
        [key, bytes, meta ? JSON.stringify(meta) : null]
      );
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to put key '${key}': ${String(err)}`);
    }
  }

  protected async rawGet(key: string): Promise<Buffer | null> {
    await this.initTable();
    try {
      const [rows]: any = await this.client.query(
        `SELECT \`val\` FROM ${this.tableName} WHERE \`key\` = ?;`,
        [key]
      );
      if (!rows || rows.length === 0 || !rows[0].val) return null;
      return Buffer.isBuffer(rows[0].val) ? rows[0].val : Buffer.from(rows[0].val);
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to get key '${key}': ${String(err)}`);
    }
  }

  protected async rawDelete(key: string): Promise<boolean> {
    await this.initTable();
    try {
      const [result]: any = await this.client.query(
        `DELETE FROM ${this.tableName} WHERE \`key\` = ?;`,
        [key]
      );
      return (result?.affectedRows ?? 0) > 0;
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to delete key '${key}': ${String(err)}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    await this.initTable();
    try {
      const [rows]: any = await this.client.query(
        `SELECT 1 FROM ${this.tableName} WHERE \`key\` = ?;`,
        [key]
      );
      return rows && rows.length > 0;
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to check existence: ${String(err)}`);
    }
  }

  async list(prefix = "", cursor?: string, limit = 100): Promise<ListResult> {
    await this.initTable();
    try {
      let query = `SELECT \`key\` FROM ${this.tableName} WHERE \`key\` LIKE ?`;
      const params: any[] = [`${prefix}%`];
      if (cursor) {
        query += ` AND \`key\` > ?`;
        params.push(cursor);
      }
      query += ` AND \`key\` NOT LIKE '%.__llp_part__.%' ORDER BY \`key\` ASC LIMIT ?;`;
      params.push(limit);

      const [rows]: any = await this.client.query(query, params);
      const keys = (rows || []).map((r: any) => r.key);
      const nextCursor = keys.length === limit ? keys[keys.length - 1] : undefined;
      return { keys, nextCursor };
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to list keys: ${String(err)}`);
    }
  }
}