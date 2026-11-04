/**
 * losslesspack - Adapter Typed Error Hierarchy
 * All adapter errors map to standard typed errors with retryable flags.
 */

import { LosslessPackError } from "../errors.js";

export abstract class AdapterError extends LosslessPackError {
  abstract readonly retryable: boolean;
  readonly adapterName: string;

  constructor(adapterName: string, message: string) {
    super(`[${adapterName}] ${message}`);
    this.adapterName = adapterName;
  }
}

export class AdapterConnectionError extends AdapterError {
  readonly code = "ERR_ADAPTER_CONNECTION";
  readonly retryable = true;
}

export class AdapterTimeoutError extends AdapterError {
  readonly code = "ERR_ADAPTER_TIMEOUT";
  readonly retryable = true;
}

export class AdapterRateLimitError extends AdapterError {
  readonly code = "ERR_ADAPTER_RATE_LIMIT";
  readonly retryable = true;
}

export class AdapterSizeLimitError extends AdapterError {
  readonly code = "ERR_ADAPTER_SIZE_LIMIT";
  readonly retryable = false;
}

export class AdapterConflictError extends AdapterError {
  readonly code = "ERR_ADAPTER_CONFLICT";
  readonly retryable = false;
}

export class AdapterUnknownError extends AdapterError {
  readonly code = "ERR_ADAPTER_UNKNOWN";
  readonly retryable = false;
}

export class AdapterUnavailableError extends AdapterError {
  readonly code = "ERR_ADAPTER_UNAVAILABLE";
  readonly retryable = false;
}