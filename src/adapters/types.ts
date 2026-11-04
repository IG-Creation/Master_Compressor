/**
 * losslesspack - Storage Adapter Interface & Contracts
 */

export interface AdapterCapabilities {
  /**
   * Maximum allowed byte size for a single raw value before splitting is triggered.
   * Default: 104,857,600 (100 MB).
   */
  maxValueSizeBytes: number;

  /**
   * Whether put() is guaranteed to be atomic (either full value is written or nothing).
   */
  atomicWrites: boolean;

  /**
   * Whether list() supports efficient prefix filtering.
   */
  supportsPrefixList: boolean;

  /**
   * Whether adapter natively supports batch insertion.
   */
  supportsBatchPut: boolean;

  /**
   * Whether adapter stores metadata dictionaries alongside the byte payload.
   */
  supportsMetadata: boolean;
}

export interface PutOptions {
  metadata?: Record<string, unknown>;
  overwrite?: boolean;
}

export interface ListResult {
  keys: string[];
  nextCursor?: string;
}

export interface BatchPutItem {
  key: string;
  bytes: Buffer;
  metadata?: Record<string, unknown>;
}

export interface StorageAdapter {
  /**
   * Unique machine-readable name of the adapter (e.g. "memory", "filesystem", "sqlite", "postgres").
   */
  readonly name: string;

  /**
   * Returns capabilities, size thresholds, and feature support flags.
   */
  capabilities(): AdapterCapabilities;

  /**
   * Stores a byte payload under the specified key.
   * If key exists, overwrites atomically unless specified otherwise.
   */
  put(key: string, bytes: Buffer, meta?: Record<string, unknown>): Promise<void>;

  /**
   * Retrieves the raw byte payload associated with key, or null if key does not exist.
   */
  get(key: string): Promise<Buffer | null>;

  /**
   * Deletes a record by key. Returns true if key was deleted, false if not found.
   */
  delete(key: string): Promise<boolean>;

  /**
   * Checks whether a key exists in storage.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Lists keys with optional prefix filtering and cursor-based pagination.
   */
  list(prefix?: string, cursor?: string, limit?: number): Promise<ListResult>;

  /**
   * Optional batch put operation.
   */
  putMany?(items: BatchPutItem[]): Promise<void>;

  /**
   * Optional cleanup/disconnection hook.
   */
  close?(): Promise<void>;
}