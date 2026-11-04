/**
 * losslesspack - Adapters Public Interface & Factory
 */

import { StorageAdapter } from "./types.js";
import { AdapterUnavailableError } from "./errors.js";
import { MemoryStorageAdapter } from "./memory.js";
import { FilesystemStorageAdapter } from "./filesystem.js";
import { SQLiteStorageAdapter } from "./sqlite.js";
import { PostgresStorageAdapter } from "./postgres.js";
import { MySQLStorageAdapter } from "./mysql.js";
import { MongoStorageAdapter } from "./mongodb.js";
import { RedisStorageAdapter } from "./redis.js";
import { S3StorageAdapter } from "./s3.js";
import { SupabaseStorageAdapter } from "./supabase.js";

export * from "./types.js";
export * from "./errors.js";
export * from "./base.js";
export * from "./memory.js";
export * from "./filesystem.js";
export * from "./sqlite.js";
export * from "./postgres.js";
export * from "./mysql.js";
export * from "./mongodb.js";
export * from "./redis.js";
export * from "./s3.js";
export * from "./supabase.js";
export * from "./chaos.js";
export * from "./conformance.js";

export function getAdapter(name: string, options: any = {}): StorageAdapter {
  const norm = name.trim().toLowerCase();
  switch (norm) {
    case "memory":
      return new MemoryStorageAdapter(options);
    case "fs":
    case "filesystem":
      return new FilesystemStorageAdapter(options);
    case "sqlite":
    case "better-sqlite3":
      return new SQLiteStorageAdapter(options);
    case "pg":
    case "postgres":
    case "postgresql":
      return new PostgresStorageAdapter(options);
    case "mysql":
    case "mysql2":
      return new MySQLStorageAdapter(options);
    case "mongo":
    case "mongodb":
      return new MongoStorageAdapter(options);
    case "redis":
    case "ioredis":
      return new RedisStorageAdapter(options);
    case "s3":
      return new S3StorageAdapter(options);
    case "supabase":
      return new SupabaseStorageAdapter(options);
    default:
      throw new AdapterUnavailableError(name, `Unsupported or unknown storage adapter: "${name}"`);
  }
}