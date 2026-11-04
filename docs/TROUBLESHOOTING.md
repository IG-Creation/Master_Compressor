# losslesspack - Error Code Reference & Troubleshooting Guide

Every error in `losslesspack` extends `LosslessPackError` with a unique, stable, machine-readable `code` property.

---

## Error Code Lookup Table

| Error Code | Component | Retryable | Root Cause | Recommended Fix |
|---|---|---|---|---|
| `ERR_CHECKSUM_MISMATCH` | Core / Mediator | ❌ No | SHA-256 hash or length does not match container header. Data is corrupted. | Check physical storage, network socket truncation, or disk controller bit rot. Restore from quarantine or backup. |
| `ERR_INVALID_MAGIC` | Format | ❌ No | First 4 bytes do not match magic bytes `LLP1`. Input is not a losslesspack container. | Ensure data was compressed with losslesspack before calling decompress. |
| `ERR_CORRUPT_HEADER` | Format | ❌ No | Header CRC32 checksum failed. First 51 bytes of envelope were altered. | Payload was truncated or overwritten by an external process. |
| `ERR_TRUNCATED_DATA` | Format / Stream | ❌ No | File or stream terminated prematurely before reading complete header or chunk. | Check socket timeouts, premature stream endings, or disk space exhaustion. |
| `ERR_UNSUPPORTED_VERSION` | Format | ❌ No | Container version is not `1`. | Upgrade `losslesspack` to read newer container formats. |
| `ERR_SIZE_LIMIT_EXCEEDED` | Decompression | ❌ No | Decompressed size exceeds `maxDecompressedSize` (zip bomb safety limit). | If payload is legitimately large, increase `maxDecompressedSize` option. |
| `ERR_ALGORITHM_UNAVAILABLE` | Compression | ❌ No | Algorithm ID requested or stored is not available. | Install `@mongodb-js/zstd` or verify runtime environment. |
| `ERR_DICTIONARY_NOT_FOUND` | Compression | ❌ No | Container requires a dictionary ID that was not supplied in options. | Provide pre-shared dictionary buffer in decompression options. |
| `ERR_INVALID_ARGUMENT` | Core / Mediator | ❌ No | Invalid key (e.g. empty string) or unsupported type passed to API. | Pass valid non-empty string key and binary buffer or JSON-serializable value. |
| `ERR_ADAPTER_CONNECTION` | Adapter | ✅ Yes | Network socket error, connection reset, or database refused connection. | Check network route, database credentials, server capacity, and retry. |
| `ERR_ADAPTER_TIMEOUT` | Adapter | ✅ Yes | Downstream database or storage operation exceeded configured `timeoutMs`. | Increase `timeoutMs` in mediator options or investigate downstream latency. |
| `ERR_ADAPTER_RATE_LIMIT` | Adapter | ✅ Yes | Downstream storage returned HTTP 429 Too Many Requests or quota exceeded. | Decrease write concurrency or configure backoff delays. |
| `ERR_ADAPTER_SIZE_LIMIT` | Adapter | ❌ No | Single value exceeded adapter maximum payload size without chunk splitting. | Inherit adapter from `BaseAdapter` or configure `maxValueSizeBytes`. |
| `ERR_ADAPTER_CONFLICT` | Adapter | ❌ No | Primary key or uniqueness constraint conflict in underlying database. | Ensure idempotent upsert semantics are enabled. |
| `ERR_ADAPTER_UNAVAILABLE` | Adapter | ❌ No | Optional peer dependency driver (e.g. `pg`, `mysql2`, `ioredis`) is missing. | Install the required driver package as a dependency. |
| `ERR_RECOVERY_QUARANTINE` | WAL Recovery | ❌ No | WAL could not verify consistency of orphaned record after process crash. | Inspect `QuarantineStore` records and restore data manually. |

---

## Diagnostic Self-Check

Run the automated diagnostics engine to immediately detect configuration or environment problems:

```bash
losslesspack doctor
```

Outputs comprehensive status for Node.js runtime, monotonic clock, memory headroom, optional drivers, zstd engine, filesystem permissions, and executes an end-to-end binary roundtrip canary.