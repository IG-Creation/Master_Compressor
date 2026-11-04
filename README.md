# losslesspack 🗜️⚡

> **Production-Grade, LOSSLESS Data Compression Library & CLI for Node.js and Supabase**  
> *Engineered for high-volume PostgreSQL `bytea` records and Supabase Storage with strict zero-data-loss guarantees.*

[![CI Matrix Tests](https://github.com/IG-Creation/Master_Compressor/actions/workflows/test.yml/badge.svg)](https://github.com/IG-Creation/Master_Compressor/actions)
[![TypeScript 5.x](https://img.shields.io/badge/TypeScript-Strict%205.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![Format: ESM + CJS](https://img.shields.io/badge/module-ESM%20%2B%20CJS-purple.svg)](#installation)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 🎯 Non-Negotiable Guarantees

1. **Bit-Identical Roundtrip:** `decompress(compress(x))` is byte-identical to `x` for every possible input. Not a single bit may ever change.
2. **In-Memory Self-Verification:** Every `compress()` call verifies itself by decompressing in memory and comparing SHA-256 with original input. If verification fails, it falls back to uncompressed `store` mode and never throws away the original.
3. **No Negative Compression:** If compressed size exceeds or equals the original size, `losslesspack` automatically uses `store` mode (overhead limited to the 55-byte fixed header).
4. **End-to-End Integrity:** Every `decompress()` call verifies both the byte length and SHA-256 digest against the header. Any mismatch throws a typed error—it will **never** return partial or corrupt data.
5. **No Data Loss on Error Paths:** Pure functional design with zero global mutable state. Thread-safe and safe for high-concurrency environments.
6. **Battle-Tested Algorithms:** Built on Node.js standard-library Zlib (Gzip and Brotli) as the always-available baseline, with Zstandard (`zstd`) via optional dependency and automatic graceful fallback.

---

## ⚠️ Honest Reality & Compression Claims

- **Compression is Data-Dependent:** Shannon information theory dictates that no lossless compression algorithm can shrink all possible inputs. Highly redundant data (JSON, server logs, CSV, telemetry, text) will compress by **60% to 95%**.
- **Incompressible Data Won’t Shrink:** Random bytes, cryptographic ciphertexts, and already-compressed media (ZIP, GZ, PNG, JPEG, MP4, WebP, 7z) cannot be compressed further. `losslesspack` automatically detects high-entropy data and skips compression via `store` mode.
- **SQL Filtering Caveat:** Compressed columns in PostgreSQL (`bytea`) cannot be queried with standard SQL `WHERE` clauses. Always keep filterable/indexed metadata in native columns and store only the large payloads compressed (see [docs/SUPABASE.md](docs/SUPABASE.md)).

---

## 📦 Installation

```bash
# Core library (Zero mandatory external dependencies)
npm install losslesspack

# Optional: Install native Zstandard engine
npm install @mongodb-js/zstd
```

---

## 🚀 Quickstart

### 1. Basic In-Memory Compression & Decompression
```typescript
import { compress, decompress } from "losslesspack";

// Compress string or Buffer
const data = Buffer.from("Field visit registration payload with nested telemetry...".repeat(20));
const container = await compress(data);

console.log(`Original: ${data.length} B -> Container: ${container.length} B`);

// Decompress with cryptographic verification
const restored = await decompress(container);
console.assert(restored.equals(data), "Bit-identical verification passed!");
```

### 2. Lossless Canonical JSON Roundtrip
```typescript
import { compressJSON, decompressJSON } from "losslesspack";

const record = {
  id: "rec_90124",
  timestamp: new Date("2026-11-05T00:00:00Z"),
  balance: 9007199254740993123456789n, // BigInt support!
  score: Number.NaN,                    // Preserves NaN, Infinity, -Infinity
  logs: ["LOGIN_SUCCESS", "AUDIT_VERIFIED"]
};

const packed = await compressJSON(record);
const unpacked = await decompressJSON<typeof record>(packed);

console.log(unpacked.balance); // 9007199254740993123456789n (Native BigInt)
console.log(unpacked.timestamp instanceof Date); // true
```

---

## 🗄️ Supabase & PostgreSQL Integration

Import the dedicated subpath export:
```typescript
import { 
  bufferToByteaHex, 
  byteaHexToBuffer, 
  uploadCompressed, 
  downloadDecompressed,
  batchInsertCompressed,
  readKeysetPaginated 
} from "losslesspack/supabase";
```

### PostgreSQL `bytea` Column Storage
```typescript
import { createClient } from "@supabase/supabase-js";
import { compress, decompress } from "losslesspack";
import { bufferToByteaHex, byteaHexToBuffer } from "losslesspack/supabase";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// 1. Insert compressed payload into PostgreSQL bytea column
const rawPayload = Buffer.from(JSON.stringify(fieldVisitReport));
const container = await compress(rawPayload);

await supabase.from("field_visits").insert({
  user_code: "FMF10892",
  branch_name: "Kurla Branch 04",
  visit_date: "2026-11-04T10:30:00Z",
  payload: bufferToByteaHex(container), // Formatted as \x4c4c5031...
  original_size: rawPayload.length,
  compressed_size: container.length
});

// 2. Read back and decompress
const { data } = await supabase.from("field_visits").select("payload").eq("user_code", "FMF10892").single();
const decompressed = await decompress(byteaHexToBuffer(data.payload));
```

### Streaming Keyset Cursor Pagination
```typescript
// Reads millions of rows with constant memory (no OFFSET scanning)
for await (const row of readKeysetPaginated(supabase, "field_visits", { pageSize: 500 })) {
  console.log("Record ID:", row.id, "Payload:", row.payload);
}
```

---

## 📊 Benchmarks

Tested on a 67 KB repetitive JSON telemetry sample:

| Algorithm | Compressed Size | Storage Saved (%) | Compression (ms) | Decompression (ms) | Integrity Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Store (Raw)** | 67,763 B | -0.1% | 1.03 ms | 0.29 ms | ✅ Byte-Identical |
| **Gzip** | 4,811 B | **92.9%** | 2.88 ms | 1.28 ms | ✅ Byte-Identical |
| **Brotli** | 4,115 B | **93.9%** | 1.16 ms | 0.85 ms | ✅ Byte-Identical |
| **Zstandard** | 3,920 B | **94.2%** | 0.94 ms | 0.62 ms | ✅ Byte-Identical |

---

## 🖥️ Command Line Interface (CLI)

```bash
# 1. Compress file (or stdin via -)
npx losslesspack compress visit_log.json visit_log.llp1

# 2. Decompress container (or stdout via -)
npx losslesspack decompress visit_log.llp1 restored.json

# 3. Verify container integrity and SHA-256
npx losslesspack verify visit_log.llp1

# 4. Inspect container header details
npx losslesspack info visit_log.llp1

# 5. Run live benchmark
npx losslesspack bench
```

---

## 🛡️ Error Handling Hierarchy

All errors extend `LosslessPackError` with unique, machine-readable `code` properties:

| Error Class | Code | Cause |
| :--- | :--- | :--- |
| `InvalidMagicError` | `ERR_INVALID_MAGIC` | Container does not start with `"LLP1"`. |
| `UnsupportedVersionError` | `ERR_UNSUPPORTED_VERSION` | Format version is greater than 1. |
| `CorruptHeaderError` | `ERR_CORRUPT_HEADER` | Header CRC-32 checksum failed. |
| `ChecksumMismatchError` | `ERR_CHECKSUM_MISMATCH` | Decompressed payload SHA-256 or length does not match header. |
| `SizeLimitExceededError` | `ERR_SIZE_LIMIT_EXCEEDED` | Payload claims size exceeding `maxDecompressedSize` (zip-bomb defense). |
| `TruncatedDataError` | `ERR_TRUNCATED_DATA` | Input stream ended prematurely. |
| `AlgorithmUnavailableError` | `ERR_ALGORITHM_UNAVAILABLE` | Requested native algorithm binding is missing. |

---

## 📚 Documentation Links
- [Container Format Specification (docs/FORMAT.md)](docs/FORMAT.md)
- [Supabase & PostgreSQL Architecture Guide (docs/SUPABASE.md)](docs/SUPABASE.md)
- [Recommended PostgreSQL Migration (supabase/migrations/)](supabase/migrations/)
- [Executable Code Examples (examples/)](examples/)

---

## 📄 License

MIT License. Copyright (c) 2026 IG-Creation.