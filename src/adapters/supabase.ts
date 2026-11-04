/**
 * losslesspack - Supabase Unified Storage Adapter
 * Adapts Supabase Postgres bytea tables or Supabase Storage buckets to the StorageAdapter contract.
 */

import { BaseAdapter } from "./base.js";
import { AdapterCapabilities, ListResult } from "./types.js";
import { AdapterConnectionError } from "./errors.js";
import { bufferToByteaHex, byteaHexToBuffer } from "../supabase/bytea.js";

export interface SupabaseAdapterOptions {
  client: any; // SupabaseClient
  tableName?: string; // If using PostgreSQL bytea table
  keyColumn?: string;
  byteaColumn?: string;
  bucket?: string; // If using Storage bucket
  maxValueSizeBytes?: number;
}

export class SupabaseStorageAdapter extends BaseAdapter {
  readonly name = "supabase";
  private client: any;
  private readonly tableName: string;
  private readonly keyColumn: string;
  private readonly byteaColumn: string;
  private readonly bucket?: string;
  private readonly maxValSize: number;

  constructor(options: SupabaseAdapterOptions) {
    super();
    this.client = options.client;
    this.tableName = options.tableName ?? "compressed_records";
    this.keyColumn = options.keyColumn ?? "id";
    this.byteaColumn = options.byteaColumn ?? "payload";
    this.bucket = options.bucket;
    this.maxValSize = options.maxValueSizeBytes ?? (this.bucket ? 50 * 1024 * 1024 : 10 * 1024 * 1024);
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
    try {
      if (this.bucket) {
        // Use Supabase Storage
        const { error } = await this.client.storage.from(this.bucket).upload(key, bytes, {
          contentType: "application/octet-stream",
          upsert: true
        });
        if (error) throw error;
      } else {
        // Use Postgres bytea column
        const hex = bufferToByteaHex(bytes);
        const { error } = await this.client.from(this.tableName).upsert({
          [this.keyColumn]: key,
          [this.byteaColumn]: hex,
          ...meta
        });
        if (error) throw error;
      }
    } catch (err: any) {
      throw new AdapterConnectionError(this.name, `Failed to put key '${key}': ${err.message ?? String(err)}`);
    }
  }

  protected async rawGet(key: string): Promise<Buffer | null> {
    try {
      if (this.bucket) {
        const { data, error } = await this.client.storage.from(this.bucket).download(key);
        if (error || !data) return null;
        if (Buffer.isBuffer(data)) return data;
        const ab = await data.arrayBuffer();
        return Buffer.from(ab);
      } else {
        const { data, error } = await this.client
          .from(this.tableName)
          .select(this.byteaColumn)
          .eq(this.keyColumn, key)
          .maybeSingle();

        if (error || !data || !data[this.byteaColumn]) return null;
        return byteaHexToBuffer(data[this.byteaColumn]);
      }
    } catch (err: any) {
      throw new AdapterConnectionError(this.name, `Failed to get key '${key}': ${err.message ?? String(err)}`);
    }
  }

  protected async rawDelete(key: string): Promise<boolean> {
    try {
      if (this.bucket) {
        const { data, error } = await this.client.storage.from(this.bucket).remove([key]);
        if (error) throw error;
        return (data && data.length > 0) ?? false;
      } else {
        const { data, error } = await this.client
          .from(this.tableName)
          .delete()
          .eq(this.keyColumn, key)
          .select();
        if (error) throw error;
        return (data && data.length > 0) ?? false;
      }
    } catch (err: any) {
      throw new AdapterConnectionError(this.name, `Failed to delete key '${key}': ${err.message ?? String(err)}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    const val = await this.rawGet(key);
    return val !== null;
  }

  async list(prefix = "", cursor?: string, limit = 100): Promise<ListResult> {
    try {
      if (this.bucket) {
        const { data, error } = await this.client.storage.from(this.bucket).list(prefix, {
          limit,
          offset: cursor ? parseInt(cursor, 10) : 0
        });
        if (error) throw error;
        const keys = (data || []).map((f: any) => f.name).filter((k: string) => !k.includes(".__llp_part__."));
        const offset = cursor ? parseInt(cursor, 10) : 0;
        const nextCursor = keys.length === limit ? (offset + limit).toString() : undefined;
        return { keys, nextCursor };
      } else {
        let query = this.client
          .from(this.tableName)
          .select(this.keyColumn)
          .ilike(this.keyColumn, `${prefix}%`)
          .order(this.keyColumn, { ascending: true })
          .limit(limit);

        if (cursor) {
          query = query.gt(this.keyColumn, cursor);
        }

        const { data, error } = await query;
        if (error) throw error;

        const keys = (data || []).map((r: any) => r[this.keyColumn]).filter((k: string) => !k.includes(".__llp_part__."));
        const nextCursor = keys.length === limit ? keys[keys.length - 1] : undefined;
        return { keys, nextCursor };
      }
    } catch (err: any) {
      throw new AdapterConnectionError(this.name, `Failed to list keys: ${err.message ?? String(err)}`);
    }
  }
}