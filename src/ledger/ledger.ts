/**
 * losslesspack - Failure Ledger & Incident Store
 * Appends structured incidents to JSONL with rotation and generates ISSUES.md.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Incident, LedgerConfig, IncidentFilter } from "./types.js";
import { sanitizeObject, sanitizeString, sanitizeStackTrace } from "./redact.js";
import { generateIssuesMarkdown } from "./issues-generator.js";

const DEFAULT_SUGGESTIONS: Record<string, string> = {
  ERR_CHECKSUM_MISMATCH: "Investigate underlying storage transport or disk controller for silent bit rot or payload truncation.",
  ERR_TRUNCATED_DATA: "Check connection timeouts or network socket buffers prematurely closing during transfer.",
  ERR_ADAPTER_TIMEOUT: "Increase adapter timeoutMs or inspect downstream database / network latency.",
  ERR_ADAPTER_CONNECTION: "Verify network route, authentication credentials, and database server availability.",
  ERR_ADAPTER_RATE_LIMIT: "Decrease concurrency, adjust batch size, or implement rate limiting in the mediator.",
  ERR_ADAPTER_SIZE_LIMIT: "Payload exceeds adapter maximum value size. Ensure automatic splitting is configured.",
  ERR_CORRUPT_HEADER: "Payload does not start with valid LLP1 magic bytes or header CRC32 failed.",
  ERR_RECOVERY_QUARANTINE: "Review records in quarantine store and inspect adapter state for aborted writes."
};

export class FailureLedger {
  private readonly filePath: string;
  private readonly markdownPath: string;
  private readonly maxSizeBytes: number;
  private readonly maxRotatedFiles: number;
  private readonly autoRegenerate: boolean;
  private appendLock = Promise.resolve();

  constructor(config: LedgerConfig = {}) {
    this.filePath = config.filePath ?? path.join(process.cwd(), "reports", "failures.jsonl");
    this.markdownPath = config.markdownPath ?? path.join(process.cwd(), "reports", "ISSUES.md");
    this.maxSizeBytes = config.maxSizeBytes ?? 10 * 1024 * 1024; // 10 MB
    this.maxRotatedFiles = config.maxRotatedFiles ?? 5;
    this.autoRegenerate = config.autoRegenerateMarkdown ?? true;
  }

  private async ensureParentDir(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
  }

  async record(input: Partial<Incident>): Promise<Incident> {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = crypto.randomBytes(3).toString("hex");
    const errorCode = input.errorCode || "ERR_UNKNOWN";

    const incident: Incident = {
      id: input.id || `INC-${dateStr}-${randomSuffix}`,
      timestamp: input.timestamp || new Date().toISOString(),
      severity: input.severity || "ERROR",
      errorCode,
      component: input.component || "mediator",
      message: sanitizeString(input.message || "An operational error occurred"),
      adapterName: input.adapterName,
      adapterVersion: input.adapterVersion,
      libraryVersion: input.libraryVersion || "1.0.0",
      nodeVersion: process.version,
      os: `${process.platform} ${process.arch}`,
      keyOrId: input.keyOrId,
      originalSize: input.originalSize,
      storedSize: input.storedSize,
      originalSha256: input.originalSha256,
      storedSha256: input.storedSha256,
      retryCount: input.retryCount,
      optionsUsed: input.optionsUsed ? sanitizeObject(input.optionsUsed) : undefined,
      stackTrace: sanitizeStackTrace(input.stackTrace),
      suggestedNextStep:
        input.suggestedNextStep ||
        DEFAULT_SUGGESTIONS[errorCode] ||
        "Check system logs, verify adapter status, and run 'losslesspack doctor'."
    };

    // Serialize to JSON line
    const line = JSON.stringify(incident) + "\n";

    // Synchronize concurrent appends
    this.appendLock = this.appendLock.then(async () => {
      await this.ensureParentDir(this.filePath);
      await this.rotateIfNeeded();
      await fs.appendFile(this.filePath, line, "utf8");

      if (this.autoRegenerate) {
        try {
          const allIncidents = await this.query();
          const md = generateIssuesMarkdown(allIncidents);
          await this.ensureParentDir(this.markdownPath);
          await fs.writeFile(this.markdownPath, md, "utf8");
        } catch {
          // Non-blocking if markdown regeneration fails
        }
      }
    });

    await this.appendLock;
    return incident;
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const stat = await fs.stat(this.filePath);
      if (stat.size >= this.maxSizeBytes) {
        for (let i = this.maxRotatedFiles - 1; i >= 1; i--) {
          const src = `${this.filePath}.${i}`;
          const dest = `${this.filePath}.${i + 1}`;
          await fs.rename(src, dest).catch(() => {});
        }
        await fs.rename(this.filePath, `${this.filePath}.1`).catch(() => {});
      }
    } catch {
      // File does not exist yet
    }
  }

  async query(filter: IncidentFilter = {}): Promise<Incident[]> {
    try {
      const data = await fs.readFile(this.filePath, "utf8");
      const lines = data.split("\n").filter((l) => l.trim().length > 0);
      const incidents: Incident[] = [];

      for (const line of lines) {
        try {
          const inc: Incident = JSON.parse(line);

          if (filter.severity && inc.severity !== filter.severity) continue;
          if (filter.errorCode && inc.errorCode !== filter.errorCode) continue;
          if (filter.component && inc.component !== filter.component) continue;
          if (filter.adapterName && inc.adapterName !== filter.adapterName) continue;
          if (filter.since && inc.timestamp < filter.since) continue;

          incidents.push(inc);
        } catch {
          // ignore corrupted line
        }
      }

      if (filter.limit && incidents.length > filter.limit) {
        return incidents.slice(-filter.limit);
      }

      return incidents;
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    await fs.unlink(this.filePath).catch(() => {});
    await fs.unlink(this.markdownPath).catch(() => {});
  }
}