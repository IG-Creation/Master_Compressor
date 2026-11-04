/**
 * losslesspack - Chaos / Fault Injection Storage Adapter
 * Wraps any underlying StorageAdapter to inject real-world faults for testing:
 * timeouts, connection resets, bit flips, truncated reads, disk full, rate limits, latency.
 */

import { StorageAdapter, AdapterCapabilities, ListResult, BatchPutItem } from "./types.js";
import {
  AdapterConnectionError,
  AdapterTimeoutError,
  AdapterRateLimitError,
  AdapterSizeLimitError
} from "./errors.js";

export interface ChaosOptions {
  /** Global fault rate (0.0 to 1.0). If set, applies as chance to trigger any enabled fault. */
  failureRate?: number;
  /** Probability (0.0 to 1.0) of throwing AdapterTimeoutError */
  timeoutRate?: number;
  /** Probability (0.0 to 1.0) of throwing AdapterConnectionError */
  connectionResetRate?: number;
  /** Probability (0.0 to 1.0) of throwing AdapterRateLimitError */
  rateLimitRate?: number;
  /** Probability (0.0 to 1.0) of throwing AdapterSizeLimitError (simulated disk full) */
  diskFullRate?: number;
  /** Probability (0.0 to 1.0) of truncating read buffer */
  truncatedReadRate?: number;
  /** Probability (0.0 to 1.0) of flipping a bit in read buffer */
  bitFlipRate?: number;
  /** Probability (0.0 to 1.0) of writing only partial bytes */
  partialWriteRate?: number;
  /** Simulated latency range in milliseconds */
  latencyMs?: { min: number; max: number };
  /** Seed or custom RNG function for reproducible chaos runs */
  rng?: () => number;
}

export class ChaosAdapter implements StorageAdapter {
  readonly name: string;
  private readonly target: StorageAdapter;
  private readonly opts: ChaosOptions;
  private readonly rng: () => number;

  constructor(target: StorageAdapter, options: ChaosOptions = {}) {
    this.target = target;
    this.name = `chaos(${target.name})`;
    this.opts = options;
    this.rng = options.rng || Math.random;
  }

  capabilities(): AdapterCapabilities {
    return this.target.capabilities();
  }

  private async maybeInjectLatency(): Promise<void> {
    if (this.opts.latencyMs) {
      const { min, max } = this.opts.latencyMs;
      const delay = min + Math.floor(this.rng() * (max - min + 1));
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private checkRate(specificRate?: number): boolean {
    if (specificRate !== undefined && specificRate > 0) {
      return this.rng() < specificRate;
    }
    if (this.opts.failureRate !== undefined && this.opts.failureRate > 0) {
      return this.rng() < this.opts.failureRate;
    }
    return false;
  }

  private maybeThrowCommonError(): void {
    if (this.checkRate(this.opts.timeoutRate)) {
      throw new AdapterTimeoutError(this.name, "Injected chaos: operation timed out");
    }
    if (this.checkRate(this.opts.connectionResetRate)) {
      throw new AdapterConnectionError(this.name, "Injected chaos: connection reset by peer");
    }
    if (this.checkRate(this.opts.rateLimitRate)) {
      throw new AdapterRateLimitError(this.name, "Injected chaos: 429 Too Many Requests");
    }
    if (this.checkRate(this.opts.diskFullRate)) {
      throw new AdapterSizeLimitError(this.name, "Injected chaos: ENOSPC device out of space");
    }
  }

  async put(key: string, bytes: Buffer, meta?: Record<string, unknown>): Promise<void> {
    await this.maybeInjectLatency();
    this.maybeThrowCommonError();

    if (this.checkRate(this.opts.partialWriteRate) && bytes.length > 2) {
      const half = Math.max(1, Math.floor(bytes.length / 2));
      const truncated = bytes.subarray(0, half);
      return this.target.put(key, truncated, meta);
    }

    return this.target.put(key, bytes, meta);
  }

  async get(key: string): Promise<Buffer | null> {
    await this.maybeInjectLatency();
    this.maybeThrowCommonError();

    const data = await this.target.get(key);
    if (!data || data.length === 0) return data;

    if (this.checkRate(this.opts.truncatedReadRate) && data.length > 1) {
      const cut = Math.max(1, Math.floor(data.length / 2));
      return Buffer.from(data.subarray(0, cut));
    }

    if (this.checkRate(this.opts.bitFlipRate)) {
      const corrupted = Buffer.from(data);
      const targetByte = Math.floor(this.rng() * corrupted.length);
      corrupted[targetByte] ^= 0x01; // flip 1 bit
      return corrupted;
    }

    return data;
  }

  async delete(key: string): Promise<boolean> {
    await this.maybeInjectLatency();
    this.maybeThrowCommonError();
    return this.target.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    await this.maybeInjectLatency();
    this.maybeThrowCommonError();
    return this.target.exists(key);
  }

  async list(prefix?: string, cursor?: string, limit?: number): Promise<ListResult> {
    await this.maybeInjectLatency();
    this.maybeThrowCommonError();
    return this.target.list(prefix, cursor, limit);
  }

  async putMany(items: BatchPutItem[]): Promise<void> {
    await this.maybeInjectLatency();
    this.maybeThrowCommonError();
    if (this.target.putMany) {
      return this.target.putMany(items);
    }
    for (const item of items) {
      await this.put(item.key, item.bytes, item.metadata);
    }
  }

  async close(): Promise<void> {
    if (this.target.close) {
      await this.target.close();
    }
  }
}