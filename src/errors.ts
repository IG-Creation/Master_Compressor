/**
 * losslesspack - Typed Error Hierarchy
 * Strict typed errors with unique, stable machine-readable error codes.
 */

export abstract class LosslessPackError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidMagicError extends LosslessPackError {
  readonly code = "ERR_INVALID_MAGIC";
  constructor(message = "Invalid magic bytes in container header. Expected 'LLP1'.") {
    super(message);
  }
}

export class UnsupportedVersionError extends LosslessPackError {
  readonly code = "ERR_UNSUPPORTED_VERSION";
  constructor(version: number) {
    super(`Unsupported container version ${version}. Only version 1 is supported.`);
  }
}

export class ChecksumMismatchError extends LosslessPackError {
  readonly code = "ERR_CHECKSUM_MISMATCH";
  constructor(expected: string, actual: string) {
    super(`SHA-256 checksum mismatch: expected ${expected}, got ${actual}. Data corrupted!`);
  }
}

export class TruncatedDataError extends LosslessPackError {
  readonly code = "ERR_TRUNCATED_DATA";
  constructor(message = "Unexpected end of data or truncated container payload.") {
    super(message);
  }
}

export class CorruptHeaderError extends LosslessPackError {
  readonly code = "ERR_CORRUPT_HEADER";
  constructor(message = "Container header CRC32 checksum mismatch. Header is corrupt.") {
    super(message);
  }
}

export class SizeLimitExceededError extends LosslessPackError {
  readonly code = "ERR_SIZE_LIMIT_EXCEEDED";
  constructor(originalLength: bigint | number, maxAllowed: number) {
    super(
      `Decompressed size ${originalLength.toString()} bytes exceeds the safety limit of ${maxAllowed} bytes.`
    );
  }
}

export class AlgorithmUnavailableError extends LosslessPackError {
  readonly code = "ERR_ALGORITHM_UNAVAILABLE";
  constructor(algorithm: string) {
    super(`Requested compression algorithm '${algorithm}' is not available in this environment.`);
  }
}

export class DictionaryNotFoundError extends LosslessPackError {
  readonly code = "ERR_DICTIONARY_NOT_FOUND";
  constructor(dictId: number) {
    super(`Dictionary with ID ${dictId} was requested but not found or provided.`);
  }
}

export class UnsupportedTypeError extends LosslessPackError {
  readonly code = "ERR_UNSUPPORTED_TYPE";
  constructor(message: string) {
    super(message);
  }
}
