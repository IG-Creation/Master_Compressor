# Supabase & PostgreSQL Storage Guide

This document details architectural best practices for integrating **losslesspack** with Supabase (PostgreSQL + Supabase Storage) across millions of records.

---

## 1. Architectural Philosophy: Filterable Columns vs Compressed Blobs

> **CRITICAL RULE:** Compressed binary columns (`bytea`) cannot be filtered or searched using standard SQL WHERE clauses (e.g. `WHERE payload->>'status' = 'ACTIVE'`).  
> Therefore, high-cardinality metadata used for filtering, indexing, and dashboard queries **MUST** remain as native typed columns.

### Recommended Data Splitting:
- **Plain SQL Columns (Indexed):** Primary key (`id`), tenant ID (`org_id`), timestamps (`created_at`, `visit_date`), category/status enums (`role`, `status`, `state`, `branch`).
- **Compressed Bytea Column (`payload`):** Large JSON forms, deeply nested telemetry, audit trails, raw sensory data, image bytes, and verbose remarks.
- **Compression Metadata Columns:** `algorithm (smallint)`, `original_size (bigint)`, `compressed_size (bigint)`, `sha256 (text)`.

---

## 2. Recommended Database Schema & Migration

```sql
-- Migration: 20261105000000_create_field_visits_compressed.sql

CREATE TABLE IF NOT EXISTS field_visits (
    -- Filterable metadata columns (Indexed)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR(32) NOT NULL,
    user_code VARCHAR(32) NOT NULL,
    branch_name VARCHAR(128) NOT NULL,
    visit_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',

    -- Compressed payload column (losslesspack LLP1 container)
    payload BYTEA NOT NULL,

    -- Compression observability metadata
    compression_algorithm SMALLINT NOT NULL DEFAULT 2, -- 0=store, 1=gzip, 2=brotli, 3=zstd
    original_size BIGINT NOT NULL,
    compressed_size BIGINT NOT NULL,
    payload_sha256 CHAR(64) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for dashboard filtering and keyset pagination
CREATE INDEX idx_field_visits_filtering 
    ON field_visits (visit_date DESC, branch_name, status);

CREATE INDEX idx_field_visits_keyset 
    ON field_visits (id ASC);
```

---

## 3. PostgREST `bytea` Encoding Convention

PostgREST encodes binary `bytea` columns as hex strings prefixed with `\x` (e.g. `\x4c4c5031...`).

`losslesspack/supabase` provides zero-overhead helpers:
```typescript
import { bufferToByteaHex, byteaHexToBuffer } from "losslesspack/supabase";

// Writing to Supabase
const hexString = bufferToByteaHex(compressedBuffer); // "\x4c4c5031..."
await supabase.from("field_visits").insert({ payload: hexString, ... });

// Reading from Supabase
const { data } = await supabase.from("field_visits").select("payload").single();
const compressedBuffer = byteaHexToBuffer(data.payload);
const original = await decompress(compressedBuffer);
```

---

## 4. Supabase Storage Integration

For large attachments, photos, or documents exceeding 5 MB:
```typescript
import { uploadCompressed, downloadDecompressed } from "losslesspack/supabase";

// 1. Upload photo / document
const result = await uploadCompressed(
  supabase,
  "attachments",
  "visits/photo_101.llp1",
  rawImageBuffer
);

// 2. Download and verify
const restoredImage = await downloadDecompressed(
  supabase,
  "attachments",
  "visits/photo_101.llp1"
);
```

---

## 5. Keyset Pagination (Constant Memory vs Offset)

Standard offset pagination (`OFFSET 500000 LIMIT 500`) scans half a million rows into Postgres buffer cache before discarding them.

`losslesspack/supabase` implements index-accelerated **keyset cursors**:
```typescript
import { readKeysetPaginated } from "losslesspack/supabase";

for await (const record of readKeysetPaginated(supabase, "field_visits", { pageSize: 500 })) {
  // Each record payload is automatically decompressed and parsed
  console.log("Processed record:", record.id, record.payload);
}
```