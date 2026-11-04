# losslesspack 📦⚡

> **Production-Grade, Lossless Data Compression Library, Mediator Pipeline & CLI**  
> *Database-agnostic, self-verifying, and self-reporting with strict zero-data-loss guarantees.*

[![TypeScript 5.x](https://img.shields.io/badge/TypeScript-Strict%205.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![Format: ESM + CJS](https://img.shields.io/badge/module-ESM%20%2B%20CJS-purple.svg)](#installation)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 🛡️ Non-Negotiable Guarantees

1. **Bit-Identical Roundtrip:** `decompress(compress(x))` is byte-identical to `x` for every possible input. Not a single bit may ever change.
2. **In-Memory Self-Verification:** Every `compress()` call verifies itself by decompressing in memory and comparing SHA-256 with original input. If verification fails, it falls back to uncompressed `store` mode and never throws away the original.
3. **No Negative Compression:** If compressed size exceeds or equals the original size, `losslesspack` automatically uses `store` mode (overhead strictly limited to the 55-byte fixed header).
4. **End-to-End Integrity:** Every `decompress()` call verifies both the byte length and SHA-256 digest against the header. Any mismatch throws a typed error—it will **never** return partial or corrupt data.
5. **Zero Data Loss on Error Paths:** Pure functional core with zero global mutable state. Concurrency-safe, retryable, with write-ahead journaling and quarantine stores.
6. **Battle-Tested Engines:** Built on Node.js standard-library Zlib (Gzip and Brotli) as the always-available baseline, with Zstandard (`zstd`) via optional dependency (`@mongodb-js/zstd`) and automatic fallback.

---

## 🚀 Installation

```bash
# Core library (Zero mandatory external dependencies)
npm install losslesspack

# Optional: Install native/wasm Zstandard engine
npm install @mongodb-js/zstd

# Optional: Install Supabase, Postgres, MySQL, Redis, Mongo, or AWS S3 drivers as needed
npm install @supabase/supabase-js pg mysql2 ioredis mongodb @aws-sdk/client-s3
```

---

## ⚡ Quickstart

### 1. In-Memory Compression & Decompression
```typescript
import { compress, decompress } from "losslesspack";

const original = Buffer.from(JSON.stringify({ user: "Alice", metrics: [1, 2, 3] }));

// Compresses into self-describing LLP1 envelope with SHA-256 checksum and header CRC32
const compressed = await compress(original, { algorithm: "auto" });

// Restores exact original bytes with length and SHA-256 verification
const restored = await decompress(compressed);
console.log(restored.equals(original)); // true
```

### 2. Canonical Lossless JSON
Preserves JavaScript primitives that standard JSON loses (`BigInt`, `Date`, `NaN`, `Infinity`, and `Buffer`):
```typescript
import { compressJSON, decompressJSON } from "losslesspack";

const record = {
  id: 1234567890123456789n, // BigInt
  timestamp: new Date("2026-11-05T00:00:00Z"),
  ratio: NaN,
  buffer: Buffer.from([0x00, 0xff, 0x42])
};

const packed = await compressJSON(record);
const unpacked = await decompressJSON<typeof record>(packed);

console.log(typeof unpacked.id); // "bigint"
console.log(unpacked.timestamp instanceof Date); // true
console.log(Number.isNaN(unpacked.ratio)); // true
```

---

## 🏛️ Mediator Pipeline (`LosslessMediator`)

The `LosslessMediator` is the primary entry point connecting application code to storage backends. It wraps every write in strict self-verification, write-ahead journaling (WAL), safe retries, circuit breaking, and quarantine storage.

```typescript
import { LosslessMediator, getAdapter } from "losslesspack";

const adapter = getAdapter("postgres", { client: pgPool });
const mediator = new LosslessMediator(adapter, {
  mode: "strict", // Options: "strict" | "sampled" | "shadow" | "dry-run"
  retries: 3
});

// Writes data: Compress -> Self-verify -> WAL -> Adapter Put -> Read-Back -> Verify SHA-256 -> Commit WAL
const receipt = await mediator.write("user/profile/42", rawBuffer);
console.log(`Saved ${(100 - receipt.ratio * 100).toFixed(1)}% space. Stored in ${receipt.adapter}`);

// Read with automated integrity verification
const data = await mediator.read("user/profile/42");
```

### Mediator Modes:
- **`strict` (Default):** Verified read-back on every single write.
- **`sampled`:** Probabilistically verifies a percentage of writes (e.g., `sampleRate: 0.05` for high-volume pipelines).
- **`shadow`:** Stores compressed payload alongside raw uncompressed data and verifies both during trial periods.
- **`dry-run`:** Evaluates compression ratios and statistics without writing to the storage backend.

---

## 🔌 Database-Agnostic Storage Adapters

`losslesspack` ships with ready-to-use storage adapters. Optional drivers are loaded lazily and throw `AdapterUnavailableError` only if instantiated without the required driver package:

- **`memory`**: In-memory storage for high-speed unit testing.
- **`filesystem`**: Atomic disk storage with temporary staging, fsync flush, and atomic rename.
- **`sqlite`**: SQLite adapter supporting `better-sqlite3` and `sqlite3`.
- **`postgres`**: PostgreSQL `bytea` storage via `pg`.
- **`mysql`**: MySQL `LONGBLOB` storage via `mysql2`.
- **`mongodb`**: MongoDB binary storage.
- **`redis`**: Redis binary string storage via `ioredis`.
- **`s3`**: AWS S3 and S3-compatible object storage via `@aws-sdk/client-s3`.
- **`supabase`**: Unified PostgreSQL `bytea` and Supabase Storage bucket adapter.
- **`chaos`**: Fault injection wrapper to test network drops, timeouts, bit flips, and truncated reads.

### Automatic Chunk Splitting with Manifests
All adapters inheriting from `BaseAdapter` automatically split records exceeding their `maxValueSizeBytes` into numbered chunk parts (`${key}.__llp_part__.${index}`) with an atomic manifest, verifying each chunk and the whole payload with SHA-256 hashes upon reassembly.

---

## 🔍 Data Scrubbing & Auditor CLI

The `losslesspack audit` command scrubs databases to detect bit rot, corrupt headers, or truncated payloads without overloading production systems:

```bash
# Scrub all records in a Postgres adapter with rate limiting
losslesspack audit --adapter postgres --rate 50 --prefix "telemetry/"

# Sample 5% of records in S3
losslesspack audit --adapter s3 --sample 5%

# Resume from a previous cursor
losslesspack audit --adapter filesystem --cursor "cursor_token"
```

---

## 📋 Failure Ledger & Incident Reporting

All operational anomalies (checksum mismatches, adapter timeouts, quarantine events) are recorded in `reports/failures.jsonl` and formatted into `reports/ISSUES.md`.

- **Strict Redaction:** No passwords, connection strings, JWTs, or raw payload bytes are ever stored in reports.
- **Prompt for AI Fix:** Each issue in `reports/ISSUES.md` includes a structured prompt to diagnose root causes and generate reproducible tests.
- **HTML Dashboard:** Export failure reports via `losslesspack report --html reports/dashboard.html`.

### Diagnostics:
```bash
losslesspack doctor
```
Checks Node runtime, monotonic clock, memory headroom, installed drivers, zstd engine, filesystem permissions, and runs an end-to-end binary roundtrip canary.

---

## 📚 Documentation

- [Container Format Specification (LLP1)](docs/FORMAT.md)
- [Supabase & PostgreSQL Integration Guide](docs/SUPABASE.md)
- [Custom Adapter Guide & Conformance Suite](docs/ADAPTERS.md)
- [Production Operations & Quarantine Runbook](docs/OPERATIONS.md)
- [Error Code Lookup & Troubleshooting](docs/TROUBLESHOOTING.md)

---

## 📄 License

MIT © [IG-Creation](https://github.com/IG-Creation)