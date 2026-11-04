/**
 * losslesspack - MongoDB Storage Adapter
 * Lazy loads "mongodb" or accepts an injected db/collection.
 */

import { BaseAdapter } from "./base.js";
import { AdapterCapabilities, ListResult } from "./types.js";
import { AdapterUnavailableError, AdapterConnectionError } from "./errors.js";

export interface MongoAdapterOptions {
  uri?: string;
  dbName?: string;
  collectionName?: string;
  collection?: any; // injected collection instance
  maxValueSizeBytes?: number;
}

export class MongoStorageAdapter extends BaseAdapter {
  readonly name = "mongodb";
  private collection: any;
  private readonly maxValSize: number;

  constructor(options?: MongoAdapterOptions) {
    super();
    this.maxValSize = options?.maxValueSizeBytes ?? 15 * 1024 * 1024; // 15 MB for standard BSON document limit (16MB max)

    if (options?.collection) {
      this.collection = options.collection;
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { MongoClient } = require("mongodb");
        const client = new MongoClient(options?.uri ?? "mongodb://localhost:27017");
        const db = client.db(options?.dbName ?? "losslesspack");
        this.collection = db.collection(options?.collectionName ?? "records");
      } catch {
        throw new AdapterUnavailableError(this.name, "Install 'mongodb' to use the MongoDB storage adapter.");
      }
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
    try {
      await this.collection.updateOne(
        { _id: key },
        { $set: { val: bytes, meta, updatedAt: new Date() } },
        { upsert: true }
      );
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to put key '${key}': ${String(err)}`);
    }
  }

  protected async rawGet(key: string): Promise<Buffer | null> {
    try {
      const doc = await this.collection.findOne({ _id: key });
      if (!doc || !doc.val) return null;
      if (Buffer.isBuffer(doc.val)) return doc.val;
      if (doc.val.buffer) return Buffer.from(doc.val.buffer);
      return Buffer.from(doc.val);
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to get key '${key}': ${String(err)}`);
    }
  }

  protected async rawDelete(key: string): Promise<boolean> {
    try {
      const res = await this.collection.deleteOne({ _id: key });
      return (res?.deletedCount ?? 0) > 0;
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to delete key '${key}': ${String(err)}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const count = await this.collection.countDocuments({ _id: key }, { limit: 1 });
      return count > 0;
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to check existence: ${String(err)}`);
    }
  }

  async list(prefix = "", cursor?: string, limit = 100): Promise<ListResult> {
    try {
      const query: any = {
        _id: {
          $regex: `^${prefix}`,
          $not: /\.__llp_part__\./
        }
      };
      if (cursor) {
        query._id.$gt = cursor;
      }
      const docs = await this.collection
        .find(query, { projection: { _id: 1 } })
        .sort({ _id: 1 })
        .limit(limit)
        .toArray();

      const keys = docs.map((d: any) => d._id);
      const nextCursor = keys.length === limit ? keys[keys.length - 1] : undefined;
      return { keys, nextCursor };
    } catch (err) {
      throw new AdapterConnectionError(this.name, `Failed to list keys: ${String(err)}`);
    }
  }
}