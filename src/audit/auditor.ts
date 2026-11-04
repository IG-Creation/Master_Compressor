/**
 * losslesspack - Storage Auditor & Scrubber
 * Scans stored records, verifies container headers, checksums, and lengths,
 * and reports corrupted, truncated, or unreadable records with rate-limiting and resume support.
 */

import crypto from "node:crypto";
import { StorageAdapter } from "../adapters/types.js";
import { parseHeader } from "../format.js";
import { decompress } from "../index.js";
import {
  ChecksumMismatchError,
  TruncatedDataError,
  CorruptHeaderError
} from "../errors.js";
import { FailureLedger } from "../ledger/ledger.js";

export interface AuditOptions {
  adapter: StorageAdapter;
  prefix?: string;
  sampleRate?: number; // 0.0 to 1.0 (default 1.0 = all)
  rateLimitRps?: number; // max requests per second
  cursor?: string;
  maxRecords?: number;
  ledger?: FailureLedger;
}

export interface AuditFailure {
  key: string;
  code: string;
  error: string;
  storedSize?: number;
  expectedSha256?: string;
  actualSha256?: string;
}

export interface AuditProgress {
  scanned: number;
  sampled: number;
  verified: number;
  corrupted: number;
  missing: number;
  unreadable: number;
  lastProcessedKey?: string;
  nextCursor?: string;
  completed: boolean;
  failures: AuditFailure[];
}

export class StorageAuditor {
  private readonly adapter: StorageAdapter;
  private readonly options: AuditOptions;
  private readonly ledger?: FailureLedger;

  constructor(options: AuditOptions) {
    this.adapter = options.adapter;
    this.options = {
      prefix: "",
      sampleRate: 1.0,
      rateLimitRps: 50,
      ...options
    };
    this.ledger = options.ledger;
  }

  async run(onProgress?: (p: AuditProgress) => void): Promise<AuditProgress> {
    const progress: AuditProgress = {
      scanned: 0,
      sampled: 0,
      verified: 0,
      corrupted: 0,
      missing: 0,
      unreadable: 0,
      completed: false,
      failures: []
    };

    let cursor = this.options.cursor;
    const prefix = this.options.prefix || "";
    const sampleRate = this.options.sampleRate ?? 1.0;
    const rps = this.options.rateLimitRps || 50;
    const delayPerItemMs = rps > 0 ? Math.floor(1000 / rps) : 0;
    const max = this.options.maxRecords || Infinity;

    let hasMore = true;

    while (hasMore && progress.scanned < max) {
      const pageSize = Math.min(50, max - progress.scanned);
      const listRes = await this.adapter.list(prefix, cursor, pageSize);
      const keys = listRes.keys;

      if (keys.length === 0) {
        break;
      }

      for (const key of keys) {
        if (progress.scanned >= max) break;
        progress.scanned++;
        progress.lastProcessedKey = key;

        // Apply sampling rate
        if (sampleRate < 1.0 && Math.random() > sampleRate) {
          continue;
        }

        progress.sampled++;

        // Rate limiting delay
        if (delayPerItemMs > 0) {
          await new Promise((r) => setTimeout(r, delayPerItemMs));
        }

        try {
          const raw = await this.adapter.get(key);
          if (!raw) {
            progress.missing++;
            const fail: AuditFailure = {
              key,
              code: "ERR_AUDIT_MISSING",
              error: "Key was listed by adapter but returned null on get()"
            };
            progress.failures.push(fail);
            await this.recordLedgerIncident(key, fail, "WARN");
            continue;
          }

          // Parse LLP1 header
          let header;
          try {
            header = parseHeader(raw);
          } catch (hErr: any) {
            progress.corrupted++;
            const fail: AuditFailure = {
              key,
              code: hErr.code || "ERR_CORRUPT_HEADER",
              error: hErr.message,
              storedSize: raw.length
            };
            progress.failures.push(fail);
            await this.recordLedgerIncident(key, fail, "CRITICAL");
            continue;
          }

          // Decompress and verify content SHA-256
          try {
            const restored = await decompress(raw);
            const sha = crypto.createHash("sha256").update(restored).digest("hex");
            if (sha !== header.sha256Hex) {
              progress.corrupted++;
              const fail: AuditFailure = {
                key,
                code: "ERR_CHECKSUM_MISMATCH",
                error: `Decompressed SHA-256 mismatch: expected ${header.sha256Hex}, got ${sha}`,
                storedSize: raw.length,
                expectedSha256: header.sha256Hex,
                actualSha256: sha
              };
              progress.failures.push(fail);
              await this.recordLedgerIncident(key, fail, "CRITICAL");
              continue;
            }

            if (BigInt(restored.length) !== header.originalLength) {
              progress.corrupted++;
              const fail: AuditFailure = {
                key,
                code: "ERR_TRUNCATED_DATA",
                error: `Length mismatch: header says ${header.originalLength}, got ${restored.length}`,
                storedSize: raw.length
              };
              progress.failures.push(fail);
              await this.recordLedgerIncident(key, fail, "CRITICAL");
              continue;
            }

            progress.verified++;
          } catch (dErr: any) {
            const isCorruption =
              dErr instanceof ChecksumMismatchError ||
              dErr instanceof TruncatedDataError ||
              dErr instanceof CorruptHeaderError ||
              dErr?.code === "ERR_CHECKSUM_MISMATCH" ||
              dErr?.code === "ERR_TRUNCATED_DATA" ||
              dErr?.code === "ERR_CORRUPT_HEADER";

            if (isCorruption) {
              progress.corrupted++;
            } else {
              progress.unreadable++;
            }

            const fail: AuditFailure = {
              key,
              code: dErr.code || "ERR_DECOMPRESS_FAILED",
              error: dErr.message,
              storedSize: raw.length
            };
            progress.failures.push(fail);
            await this.recordLedgerIncident(key, fail, isCorruption ? "CRITICAL" : "ERROR");
          }
        } catch (getErr: any) {
          progress.unreadable++;
          const fail: AuditFailure = {
            key,
            code: getErr.code || "ERR_ADAPTER_READ",
            error: getErr.message
          };
          progress.failures.push(fail);
          await this.recordLedgerIncident(key, fail, "ERROR");
        }

        if (onProgress) {
          onProgress({ ...progress, nextCursor: listRes.nextCursor });
        }
      }

      cursor = listRes.nextCursor;
      progress.nextCursor = cursor;
      hasMore = !!cursor;
    }

    progress.completed = !cursor;
    return progress;
  }

  private async recordLedgerIncident(key: string, fail: AuditFailure, severity: "WARN" | "ERROR" | "CRITICAL"): Promise<void> {
    if (this.ledger) {
      await this.ledger.record({
        severity,
        errorCode: fail.code,
        component: "audit",
        adapterName: this.adapter.name,
        keyOrId: key,
        storedSize: fail.storedSize,
        originalSha256: fail.expectedSha256,
        storedSha256: fail.actualSha256,
        message: `Audit anomaly on key '${key}': ${fail.error}`,
        suggestedNextStep: "Run 'losslesspack audit' with recovery or restore record from backup/quarantine."
      });
    }
  }
}