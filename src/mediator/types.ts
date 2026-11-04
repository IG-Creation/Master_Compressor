/**
 * losslesspack - Mediator Pipeline Types
 */

import { AlgorithmName } from "../algorithms/types.js";

export type MediatorMode = "strict" | "sampled" | "shadow" | "dry-run";

export interface MediatorOptions {
  mode?: MediatorMode;
  sampleRate?: number; // 0.0 to 1.0 (used when mode === "sampled")
  defaultAlgorithm?: AlgorithmName;
  retries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerResetMs?: number;
  maxConcurrency?: number;
  timeoutMs?: number;
}

export interface MediatorWriteOptions {
  algorithm?: AlgorithmName;
  level?: number;
  dictionary?: Buffer;
  metadata?: Record<string, unknown>;
  mode?: MediatorMode;
  sampleRate?: number;
  retries?: number;
  timeoutMs?: number;
  idempotent?: boolean;
}

export interface Receipt {
  key: string;
  originalSize: number;
  storedSize: number;
  ratio: number;
  algo: string;
  sha256: string;
  adapter: string;
  verifiedAt: string;
  dryRun?: boolean;
  shadowVerified?: boolean;
}

export interface QuarantineRecord {
  id: string;
  key: string;
  payload: Buffer;
  sha256: string;
  error: string;
  errorCode: string;
  failedAt: string;
  adapterName: string;
  metadata?: Record<string, unknown>;
}

export interface JournalEntry {
  id: string;
  key: string;
  sha256: string;
  status: "pending" | "committed" | "rolled_back";
  createdAt: number;
  compressedPayload?: Buffer;
  originalPayload?: Buffer;
  metadata?: Record<string, unknown>;
}

export interface RecoveryReport {
  scanned: number;
  committed: number;
  rolledBack: number;
  quarantined: number;
}