# Changelog

All notable changes to the `losslesspack` library are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-05

### Added
- **LLP1 Container Format:** 55-byte self-describing binary header with hardware CRC32 and SHA-256 verification.
- **Non-Negotiable Guarantees:**
  - 100% bit-for-bit lossless roundtrip.
  - In-memory self-verification prior to returning.
  - Automatic fallback to uncompressed store mode on negative compression.
- **Multiple Engines:** Standard-library Zlib (Gzip and Brotli) baseline with optional Zstandard (`@mongodb-js/zstd`) and graceful fallback.
- **Lossless Canonical JSON:** Tagged encoding supporting `Date`, `BigInt`, `NaN`, `Infinity`, `-Infinity`, and Buffers with strict rejection of functions/symbols.
- **Streaming Transform Streams:** Memory-bounded chunked streaming with per-chunk CRC32 and end-of-stream SHA-256 footer verification.
- **Atomic File Operations:** `compressFile` and `decompressFile` with crash resilience, temporary file staging, `fsync`, and atomic rename.
- **Supabase Integration (`losslesspack/supabase`):**
  - PostgreSQL `bytea` hex (`\x...`) encoder/decoder.
  - Supabase Storage upload/download helpers with metadata tracking.
  - Bounded-concurrency batch insert with exponential backoff, jitter, and per-row error isolation.
  - Keyset cursor pagination reader for streaming millions of records with constant memory.
- **Command Line Interface (`losslesspack`):** Subcommands for `compress`, `decompress`, `verify`, `info`, and `bench`.
- **Automated Test Suite:** 71 test suites spanning roundtrips, property-based tests (fast-check), security bit-flipping, decompression bomb defense, and concurrency.