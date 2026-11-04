/**
 * losslesspack - Resilient Batch Insert Engine for Supabase
 * Handles hundreds of thousands of rows with bounded concurrency,
 * exponential backoff + jitter on 429/5xx, automatic batch splitting,
 * idempotency (upsert), and per-row error isolation.
 */

import { compress } from "../index.js";
import { bufferToByteaHex } from "./bytea.js";
import { CompressOptions } from "../algorithms/types.js";

export interface BatchInsertOptions<_T = Record<string, unknown>> {
  /**
   * Number of rows per insert batch.
   * @default 500
   */
  batchSize?: number;

  /**
   * Maximum total bytes per batch before auto-splitting.
   * @default 2_097_152 (2 MiB)
   */
  maxPayloadBytes?: number;

  /**
   * Maximum concurrent network requests in flight.
   * @default 4
   */
  concurrency?: number;

  /**
   * Maximum retry attempts for transient 429/5xx/network errors.
   * @default 5
   */
  maxRetries?: number;

  /**
   * Primary key or unique column for idempotent upserts.
   * @default "id"
   */
  idColumn?: string;

  /**
   * Name of the bytea column where compressed data is stored.
   * @default "payload"
   */
  compressColumn?: string;

  /**
   * Compression options passed to losslesspack.compress.
   */
  compressOptions?: CompressOptions;

  /**
   * Optional progress callback.
   */
  onProgress?: (progress: {
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
  }) => void;
}

export interface BatchSummaryReport<T = Record<string, unknown>> {
  total: number;
  inserted: number;
  skipped: number;
  failed: Array<{ row: T; error: string }>;
}

export interface GenericSupabaseTable {
  upsert(
    values: unknown[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean }
  ): Promise<{ error: { message: string; status?: number; code?: string } | null }>;
}

export interface GenericSupabaseClient {
  from(table: string): GenericSupabaseTable;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err: { status?: number; message?: string } | null): boolean {
  if (!err) return false;
  const status = err.status;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const msg = (err.message ?? "").toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("timeout") ||
    msg.includes("network") ||
    msg.includes("connection reset") ||
    msg.includes("econnreset")
  );
}

/**
 * Inserts or upserts a collection of rows with automatic payload compression,
 * rate limit backoff, and per-row error tracking.
 */
export async function batchInsertCompressed<T extends Record<string, unknown>>(
  supabase: GenericSupabaseClient,
  tableName: string,
  rows: T[],
  opts?: BatchInsertOptions<T>
): Promise<BatchSummaryReport<T>> {
  const batchSize = Math.max(1, opts?.batchSize ?? 500);
  const maxPayloadBytes = opts?.maxPayloadBytes ?? 2 * 1024 * 1024;
  const concurrency = Math.max(1, opts?.concurrency ?? 4);
  const maxRetries = opts?.maxRetries ?? 5;
  const idColumn = opts?.idColumn ?? "id";
  const compressCol = opts?.compressColumn ?? "payload";

  const total = rows.length;
  let succeeded = 0;
  const failed: Array<{ row: T; error: string }> = [];

  // Step 1: Pre-process and compress rows
  const preparedRows: Array<{ original: T; dbRow: Record<string, unknown>; estimatedSize: number }> = [];

  for (const row of rows) {
    const rawPayload = row[compressCol];
    let hexPayload: string;
    let payloadSize = 0;

    if (rawPayload !== undefined) {
      let rawBuf: Buffer;
      if (Buffer.isBuffer(rawPayload)) {
        rawBuf = rawPayload;
      } else if (rawPayload instanceof Uint8Array) {
        rawBuf = Buffer.from(rawPayload.buffer, rawPayload.byteOffset, rawPayload.byteLength);
      } else if (typeof rawPayload === "string") {
        rawBuf = Buffer.from(rawPayload, "utf8");
      } else {
        rawBuf = Buffer.from(JSON.stringify(rawPayload), "utf8");
      }

      const compressed = await compress(rawBuf, opts?.compressOptions);
      hexPayload = bufferToByteaHex(compressed);
      payloadSize = compressed.length;
    } else {
      hexPayload = "\\x";
    }

    const dbRow: Record<string, unknown> = {
      ...row,
      [compressCol]: hexPayload
    };

    preparedRows.push({ original: row, dbRow, estimatedSize: payloadSize + 100 });
  }

  // Step 2: Partition into size-respecting batches
  const batches: Array<Array<{ original: T; dbRow: Record<string, unknown> }>> = [];
  let currentBatch: Array<{ original: T; dbRow: Record<string, unknown> }> = [];
  let currentBatchBytes = 0;

  for (const item of preparedRows) {
    if (
      currentBatch.length >= batchSize ||
      (currentBatchBytes + item.estimatedSize > maxPayloadBytes && currentBatch.length > 0)
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchBytes = 0;
    }
    currentBatch.push(item);
    currentBatchBytes += item.estimatedSize;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  // Step 3: Concurrency-bounded queue execution with retry
  let batchIndex = 0;

  async function processBatch(
    batchItems: Array<{ original: T; dbRow: Record<string, unknown> }>
  ): Promise<void> {
    const table = supabase.from(tableName);
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const payload = batchItems.map((b) => b.dbRow);
        const { error } = await table.upsert(payload, { onConflict: idColumn });

        if (!error) {
          succeeded += batchItems.length;
          opts?.onProgress?.({
            total,
            processed: succeeded + failed.length,
            succeeded,
            failed: failed.length
          });
          return;
        }

        if (isRetryableError(error) && attempt < maxRetries) {
          attempt++;
          // Exponential backoff with jitter: 100ms * 2^attempt + jitter
          const backoffMs = Math.min(10000, 100 * Math.pow(2, attempt) + Math.random() * 200);
          await sleep(backoffMs);
          continue;
        }

        // Non-retryable or retries exhausted: isolate individual rows to identify the faulty one
        if (batchItems.length > 1) {
          for (const item of batchItems) {
            await processBatch([item]);
          }
          return;
        } else {
          failed.push({
            row: batchItems[0].original,
            error: error.message ?? "Unknown database error"
          });
          opts?.onProgress?.({
            total,
            processed: succeeded + failed.length,
            succeeded,
            failed: failed.length
          });
          return;
        }
      } catch (err) {
        if (attempt < maxRetries) {
          attempt++;
          const backoffMs = Math.min(10000, 100 * Math.pow(2, attempt) + Math.random() * 200);
          await sleep(backoffMs);
          continue;
        }
        if (batchItems.length > 1) {
          for (const item of batchItems) {
            await processBatch([item]);
          }
          return;
        } else {
          failed.push({
            row: batchItems[0].original,
            error: err instanceof Error ? err.message : String(err)
          });
          opts?.onProgress?.({
            total,
            processed: succeeded + failed.length,
            succeeded,
            failed: failed.length
          });
          return;
        }
      }
    }
  }

  // Worker pool for concurrency control
  const activeWorkers: Promise<void>[] = [];
  while (batchIndex < batches.length) {
    while (activeWorkers.length < concurrency && batchIndex < batches.length) {
      const current = batches[batchIndex++];
      const task = processBatch(current).finally(() => {
        const idx = activeWorkers.indexOf(task);
        if (idx !== -1) activeWorkers.splice(idx, 1);
      });
      activeWorkers.push(task);
    }
    if (activeWorkers.length > 0) {
      await Promise.race(activeWorkers);
    }
  }
  await Promise.all(activeWorkers);

  return {
    total,
    inserted: succeeded,
    skipped: 0,
    failed
  };
}
