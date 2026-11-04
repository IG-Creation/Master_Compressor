/**
 * losslesspack - LosslessMediator
 * Production-grade data mediator connecting application code to storage adapters.
 * Implements strict verify-on-write readbacks, WAL crash recovery, idempotency,
 * circuit breaker, safe retries, and quarantine stores.
 */

import crypto from "node:crypto";
import { StorageAdapter } from "../adapters/types.js";
import { compress, decompress } from "../index.js";
import { parseHeader } from "../format.js";
import {
  InvalidArgumentError,
  ChecksumMismatchError,
  TruncatedDataError
} from "../errors.js";
import { AdapterConnectionError } from "../adapters/errors.js";
import {
  MediatorOptions,
  MediatorWriteOptions,
  Receipt,
  RecoveryReport
} from "./types.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { IQuarantineStore, MemoryQuarantineStore } from "./quarantine.js";
import { IWriteAheadJournal, MemoryWriteAheadJournal } from "./journal.js";

export class LosslessMediator {
  readonly adapter: StorageAdapter;
  private readonly options: MediatorOptions;
  readonly circuitBreaker: CircuitBreaker;
  readonly journal: IWriteAheadJournal;
  readonly quarantine: IQuarantineStore;
  private inFlightWrites = 0;

  constructor(
    adapter: StorageAdapter,
    options: MediatorOptions = {},
    journal?: IWriteAheadJournal,
    quarantine?: IQuarantineStore,
    circuitBreaker?: CircuitBreaker
  ) {
    this.adapter = adapter;
    this.options = {
      mode: options.mode ?? "strict",
      sampleRate: options.sampleRate ?? 0.05,
      retries: options.retries ?? 3,
      retryBaseDelayMs: options.retryBaseDelayMs ?? 100,
      retryMaxDelayMs: options.retryMaxDelayMs ?? 2000,
      timeoutMs: options.timeoutMs ?? 10000,
      maxConcurrency: options.maxConcurrency ?? 50,
      ...options
    };
    this.circuitBreaker =
      circuitBreaker ??
      new CircuitBreaker({
        failureThreshold: options.circuitBreakerThreshold ?? 5,
        resetTimeoutMs: options.circuitBreakerResetMs ?? 15000
      });
    this.journal = journal ?? new MemoryWriteAheadJournal();
    this.quarantine = quarantine ?? new MemoryQuarantineStore();
  }

  async write(
    key: string,
    data: Uint8Array | Buffer | string,
    opts: MediatorWriteOptions = {}
  ): Promise<Receipt> {
    if (!key || typeof key !== "string") {
      throw new InvalidArgumentError("Storage key must be a non-empty string");
    }

    const buf = Buffer.isBuffer(data)
      ? data
      : typeof data === "string"
      ? Buffer.from(data, "utf8")
      : Buffer.from(data);

    const originalSha = crypto.createHash("sha256").update(buf).digest("hex");
    const activeMode = opts.mode ?? this.options.mode ?? "strict";

    // 1. Idempotency Check (same key + same content hash = no-op)
    if (opts.idempotent !== false) {
      try {
        const existing = await this.adapter.get(key);
        if (existing) {
          const parsed = parseHeader(existing);
          if (parsed.sha256Hex === originalSha) {
            return {
              key,
              originalSize: Number(parsed.originalLength),
              storedSize: existing.length,
              ratio: existing.length / (Number(parsed.originalLength) || 1),
              algo: parsed.algorithmName,
              sha256: originalSha,
              adapter: this.adapter.name,
              verifiedAt: new Date().toISOString()
            };
          }
        }
      } catch {
        // If reading existing fails, proceed with write
      }
    }

    // 2. Circuit Breaker Check
    if (!this.circuitBreaker.canExecute()) {
      throw new AdapterConnectionError(
        this.adapter.name,
        `Circuit breaker is OPEN. Fast-failing write for key: ${key}`
      );
    }

    // 3. Compress & Self-Verify in-memory
    const compressed = await compress(buf, {
      algorithm: opts.algorithm ?? this.options.defaultAlgorithm ?? "auto",
      level: opts.level,
      dictionary: opts.dictionary,
      verify: true
    });

    const parsedHeader = parseHeader(compressed);
    const ratio = compressed.length / (buf.length || 1);

    // 4. Dry-run Mode Check
    if (activeMode === "dry-run") {
      return {
        key,
        originalSize: buf.length,
        storedSize: compressed.length,
        ratio,
        algo: parsedHeader.algorithmName,
        sha256: originalSha,
        adapter: this.adapter.name,
        verifiedAt: new Date().toISOString(),
        dryRun: true
      };
    }

    // 5. Write-Ahead Journal Entry
    const writeId = crypto.randomUUID();
    await this.journal.beginWrite({
      id: writeId,
      key,
      sha256: originalSha,
      compressedPayload: compressed,
      originalPayload: buf,
      metadata: opts.metadata
    });

    this.inFlightWrites++;
    const maxRetries = opts.retries ?? this.options.retries ?? 3;
    let lastError: any = null;

    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          // Timeout protection
          const writeTimeout = opts.timeoutMs ?? this.options.timeoutMs ?? 10000;
          await this.withTimeout(
            this.adapter.put(key, compressed, opts.metadata),
            writeTimeout,
            `put(${key})`
          );

          // Shadow mode write
          if (activeMode === "shadow") {
            const shadowKey = `${key}.__llp_shadow_raw__`;
            await this.adapter.put(shadowKey, buf, { shadow: true });
          }

          // Verification on read-back
          let shouldVerifyReadBack = false;
          if (activeMode === "strict" || activeMode === "shadow") {
            shouldVerifyReadBack = true;
          } else if (activeMode === "sampled") {
            const sampleRate = opts.sampleRate ?? this.options.sampleRate ?? 0.05;
            shouldVerifyReadBack = Math.random() < sampleRate;
          }

          if (shouldVerifyReadBack) {
            const readBack = await this.withTimeout(
              this.adapter.get(key),
              writeTimeout,
              `get(${key})`
            );

            if (!readBack) {
              throw new TruncatedDataError(`Read-back returned null for key: ${key}`);
            }

            const restored = await decompress(readBack);
            const restoredSha = crypto.createHash("sha256").update(restored).digest("hex");
            if (restoredSha !== originalSha) {
              throw new ChecksumMismatchError(originalSha, restoredSha);
            }

            if (activeMode === "shadow") {
              const shadowKey = `${key}.__llp_shadow_raw__`;
              const shadowRaw = await this.adapter.get(shadowKey);
              if (!shadowRaw || !shadowRaw.equals(buf)) {
                throw new ChecksumMismatchError("shadow raw match", "shadow mismatch");
              }
            }
          }

          // Mark success
          this.circuitBreaker.recordSuccess();
          await this.journal.commitWrite(writeId);

          return {
            key,
            originalSize: buf.length,
            storedSize: compressed.length,
            ratio,
            algo: parsedHeader.algorithmName,
            sha256: originalSha,
            adapter: this.adapter.name,
            verifiedAt: new Date().toISOString(),
            shadowVerified: activeMode === "shadow"
          };
        } catch (err: any) {
          lastError = err;
          const isRetryable = err?.retryable !== false;

          if (attempt < maxRetries && isRetryable) {
            const base = this.options.retryBaseDelayMs ?? 100;
            const maxDelay = this.options.retryMaxDelayMs ?? 2000;
            const backoff = Math.min(maxDelay, base * Math.pow(2, attempt));
            const jitter = Math.floor(Math.random() * 50);
            await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
          } else {
            break;
          }
        }
      }

      // If loop exited without returning, all attempts failed
      this.circuitBreaker.recordFailure();
      await this.journal.rollbackWrite(writeId);

      // Quarantine record so original data is never lost
      await this.quarantine.quarantine({
        id: writeId,
        key,
        payload: buf,
        sha256: originalSha,
        error: lastError?.message || "Write failed after retries",
        errorCode: lastError?.code || "ERR_WRITE_FAILED",
        failedAt: new Date().toISOString(),
        adapterName: this.adapter.name,
        metadata: opts.metadata
      });

      if (lastError && typeof lastError === "object") {
        lastError.quarantined = true;
        lastError.quarantineId = writeId;
        lastError.originalPayload = buf;
      }

      throw lastError;
    } finally {
      this.inFlightWrites = Math.max(0, this.inFlightWrites - 1);
    }
  }

  async read(key: string, opts?: { maxDecompressedSize?: number }): Promise<Buffer | null> {
    if (!key || typeof key !== "string") {
      throw new InvalidArgumentError("Storage key must be a non-empty string");
    }

    const raw = await this.adapter.get(key);
    if (!raw) return null;

    // decompress automatically verifies LLP1 magic bytes, header CRC32, payload length, and SHA-256
    return decompress(raw, opts);
  }

  async delete(key: string): Promise<boolean> {
    if (!key || typeof key !== "string") {
      throw new InvalidArgumentError("Storage key must be a non-empty string");
    }

    const deleted = await this.adapter.delete(key);
    const shadowKey = `${key}.__llp_shadow_raw__`;
    await this.adapter.delete(shadowKey).catch(() => {});
    return deleted;
  }

  async exists(key: string): Promise<boolean> {
    return this.adapter.exists(key);
  }

  async recover(): Promise<RecoveryReport> {
    const pending = await this.journal.getPending();
    const report: RecoveryReport = {
      scanned: pending.length,
      committed: 0,
      rolledBack: 0,
      quarantined: 0
    };

    for (const entry of pending) {
      try {
        const stored = await this.adapter.get(entry.key);
        if (stored) {
          const restored = await decompress(stored);
          const restoredSha = crypto.createHash("sha256").update(restored).digest("hex");
          if (restoredSha === entry.sha256) {
            // Already safely in storage! Commit journal
            await this.journal.commitWrite(entry.id);
            report.committed++;
            continue;
          }
        }

        // Stored data is missing or mismatched; try to write again if compressed payload exists in journal
        if (entry.compressedPayload) {
          await this.adapter.put(entry.key, entry.compressedPayload, entry.metadata);
          const verify = await this.adapter.get(entry.key);
          if (verify) {
            const restored = await decompress(verify);
            const sha = crypto.createHash("sha256").update(restored).digest("hex");
            if (sha === entry.sha256) {
              await this.journal.commitWrite(entry.id);
              report.committed++;
              continue;
            }
          }
        }

        // If recovery was unable to verify the record, quarantine it
        if (entry.originalPayload || entry.compressedPayload) {
          await this.quarantine.quarantine({
            id: entry.id,
            key: entry.key,
            payload: entry.originalPayload || entry.compressedPayload!,
            sha256: entry.sha256,
            error: "Recovery could not verify storage consistency",
            errorCode: "ERR_RECOVERY_QUARANTINE",
            failedAt: new Date().toISOString(),
            adapterName: this.adapter.name,
            metadata: entry.metadata
          });
          report.quarantined++;
        }

        await this.journal.rollbackWrite(entry.id);
        report.rolledBack++;
      } catch {
        if (entry.originalPayload) {
          await this.quarantine.quarantine({
            id: entry.id,
            key: entry.key,
            payload: entry.originalPayload,
            sha256: entry.sha256,
            error: "Recovery exception",
            errorCode: "ERR_RECOVERY_EXCEPTION",
            failedAt: new Date().toISOString(),
            adapterName: this.adapter.name,
            metadata: entry.metadata
          });
          report.quarantined++;
        }
        await this.journal.rollbackWrite(entry.id);
        report.rolledBack++;
      }
    }

    return report;
  }

  async shutdown(timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (this.inFlightWrites > 0) {
      if (Date.now() - start > timeoutMs) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (this.adapter.close) {
      await this.adapter.close();
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new AdapterConnectionError(this.adapter.name, `Operation ${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }
}