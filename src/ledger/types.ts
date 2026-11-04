/**
 * losslesspack - Failure Ledger Types & Incident Schema
 */

export type IncidentSeverity = "INFO" | "WARN" | "ERROR" | "CRITICAL";
export type IncidentComponent = "core" | "adapter" | "mediator" | "audit" | "cli";

export interface Incident {
  /** Stable unique incident ID (e.g. "INC-20261105-a1b2c3") */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Severity level */
  severity: IncidentSeverity;
  /** Stable error code (e.g. ERR_CHECKSUM_MISMATCH, ERR_ADAPTER_TIMEOUT) */
  errorCode: string;
  /** System component where error originated */
  component: IncidentComponent;
  /** High-level description of what happened */
  message: string;
  /** Storage adapter name (if applicable) */
  adapterName?: string;
  /** Adapter driver version (if detectable) */
  adapterVersion?: string;
  /** Losslesspack library version */
  libraryVersion: string;
  /** Node.js runtime version */
  nodeVersion: string;
  /** Operating system platform and release */
  os: string;
  /** Target key or logical record identifier */
  keyOrId?: string;
  /** Original uncompressed byte size */
  originalSize?: number;
  /** Stored or compressed byte size */
  storedSize?: number;
  /** SHA-256 hash of original data (hex) */
  originalSha256?: string;
  /** SHA-256 hash of stored or received data (hex) */
  storedSha256?: string;
  /** Number of retries attempted */
  retryCount?: number;
  /** Redacted options dictionary */
  optionsUsed?: Record<string, unknown>;
  /** Sanitized stack trace (raw user data and credentials strictly stripped) */
  stackTrace?: string;
  /** Actionable guidance on next steps */
  suggestedNextStep: string;
}

export interface LedgerConfig {
  filePath?: string;
  markdownPath?: string;
  maxSizeBytes?: number;
  maxRotatedFiles?: number;
  autoRegenerateMarkdown?: boolean;
}

export interface IncidentFilter {
  severity?: IncidentSeverity;
  errorCode?: string;
  component?: IncidentComponent;
  adapterName?: string;
  since?: string;
  limit?: number;
}