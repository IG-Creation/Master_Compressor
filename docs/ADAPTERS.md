# losslesspack - Custom Storage Adapter Guide & Conformance Runner

`losslesspack` is completely database-agnostic. While it ships out of the box with adapters for in-memory, filesystem, SQLite, PostgreSQL (`pg`), MySQL (`mysql2`), MongoDB, Redis (`ioredis`), AWS S3, and Supabase, you can easily implement custom adapters for any key-value store, distributed database, or proprietary blob storage.

---

## 1. The `StorageAdapter` Contract

Every adapter must implement the `StorageAdapter` interface:

```typescript
export interface AdapterCapabilities {
  maxValueSizeBytes: number;    // Size threshold where automatic chunk splitting triggers
  atomicWrites: boolean;         // Guarantees all-or-nothing writes
  supportsPrefixList: boolean;   // Supports efficient prefix filtering
  supportsBatchPut: boolean;     // Supports bulk multi-key insertion
  supportsMetadata: boolean;     // Can persist metadata dictionaries alongside blobs
}

export interface StorageAdapter {
  readonly name: string;
  capabilities(): AdapterCapabilities;
  put(key: string, bytes: Buffer, meta?: Record<string, unknown>): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  list(prefix?: string, cursor?: string, limit?: number): Promise<ListResult>;
  putMany?(items: BatchPutItem[]): Promise<void>;
  close?(): Promise<void>;
}
```

---

## 2. Automatic Chunk Splitting with `BaseAdapter`

If your storage backend has a hard ceiling on individual record sizes (e.g., MongoDB's 16 MB BSON limit, DynamoDB's 400 KB item limit, or Postgres column thresholds), inherit from `BaseAdapter`.

`BaseAdapter` automatically:
1. Splits payloads exceeding `capabilities().maxValueSizeBytes` into numbered sub-keys (`${key}.__llp_part__.${index}`).
2. Writes an atomic split manifest (`__LLP_SPLIT_MANIFEST__`) holding individual part sizes and SHA-256 hashes.
3. Reassembles parts upon `get()`, verifying each individual part's SHA-256 and the total payload SHA-256 before returning.
4. Cleans up all orphaned parts atomically when `delete()` is called.

### Example Custom Adapter:
```typescript
import { BaseAdapter, AdapterCapabilities, ListResult } from "losslesspack/adapters";

export class DynamoDBStorageAdapter extends BaseAdapter {
  readonly name = "dynamodb";

  capabilities(): AdapterCapabilities {
    return {
      maxValueSizeBytes: 350 * 1024, // 350 KB chunk size (under DynamoDB 400KB limit)
      atomicWrites: true,
      supportsPrefixList: true,
      supportsBatchPut: true,
      supportsMetadata: true
    };
  }

  protected async rawPut(key: string, bytes: Buffer, meta?: Record<string, unknown>): Promise<void> {
    // Write item to DynamoDB...
  }

  protected async rawGet(key: string): Promise<Buffer | null> {
    // Read item from DynamoDB...
  }

  protected async rawDelete(key: string): Promise<boolean> {
    // Delete item from DynamoDB...
  }

  async exists(key: string): Promise<boolean> {
    return (await this.rawGet(key)) !== null;
  }

  async list(prefix = "", cursor?: string, limit = 100): Promise<ListResult> {
    // Scan or Query DynamoDB table...
  }
}
```

---

## 3. Conformance Verification with `runAdapterConformanceTests`

`losslesspack` exports an automated conformance suite that any first- or third-party adapter can run in its test suite:

```typescript
import { describe, it, expect } from "vitest";
import { runAdapterConformanceTests } from "losslesspack/adapters";
import { DynamoDBStorageAdapter } from "./dynamodb-adapter.js";

describe("DynamoDBStorageAdapter Conformance", () => {
  it("passes standard losslesspack adapter conformance tests", async () => {
    const report = await runAdapterConformanceTests(async () => new DynamoDBStorageAdapter(), {
      testLargeValues: true
    });

    expect(report.failedChecks).toBe(0);
    expect(report.passedChecks).toBe(report.totalChecks);
  });
});
```

### Conformance Suite Verification Criteria:
1. **`missing_key_behavior`**: Ensures `get()` returns `null`, `exists()` returns `false`, and `delete()` returns `false` on missing keys.
2. **`all_256_byte_values_roundtrip`**: Verifies binary preservation of all 256 byte values (`0x00..0xFF`) without character-set corruption or premature null-terminator truncations.
3. **`empty_buffer_roundtrip`**: Verifies exact zero-length buffer persistence.
4. **`overwrite_semantics`**: Asserts that subsequent `put()` calls with updated data overwrite cleanly and atomically.
5. **`unicode_and_special_keys`**: Validates keys with slashes, colons, emojis, non-Latin scripts (Arabic, Japanese), and numeric-looking strings (`"0123"`).
6. **`concurrent_put_and_get`**: Executes parallel puts and gets without race conditions.
7. **`list_pagination_exactly_once`**: Verifies cursor pagination guarantees every record is returned exactly once without duplicates or omissions.
8. **`large_value_splitting`**: Tests automatic splitting into chunks and bit-identical reassembly.