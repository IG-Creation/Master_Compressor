# LLP1 Container Format Specification (Version 1)

This document specifies the binary container format used by **losslesspack** (version 1, "LLP1").
All multi-byte numeric values in headers, chunks, and footers are encoded in **network byte order (big-endian)**.

---

## 1. Design Principles & Invariants

1. **Self-Describing & Versioned:** Every payload carries format version, algorithm identification, and uncompressed length. Readers decode the envelope without requiring out-of-band metadata.
2. **Deterministic & Tamper-Evident:** SHA-256 and CRC32 checksums guard against bit flips, partial transmissions, or silent corruption.
3. **Lossless Verification:** Every decompression pass verifies both byte length and SHA-256 hash. Any mismatch results in a typed exception.
4. **Safety Against Memory Exhaustion:** Original length is checked prior to allocating decompression buffers, defending against decompression bombs.
5. **No Overhead for Incompressible Data:** If compressed size exceeds or equals the input size, the algorithm falls back to `0 (store)`.

---

## 2. Fixed Header Layout (55 Bytes)

The header occupies exactly 55 bytes at offset 0:

| Field | Offset (Bytes) | Length (Bytes) | Type | Description |
| :--- | :---: | :---: | :---: | :--- |
| **Magic Bytes** | 0 | 4 | `ASCII` | Fixed magic constant: `0x4C 0x4C 0x50 0x31` (`"LLP1"`). |
| **Format Version** | 4 | 1 | `uint8` | Format version number: `0x01`. |
| **Algorithm ID** | 5 | 1 | `uint8` | Compression algorithm used (see Table 2.1). |
| **Flags** | 6 | 1 | `uint8` | Feature flags bitmask (see Table 2.2). |
| **Dictionary ID** | 7 | 4 | `uint32_be` | 32-bit dictionary identifier; `0` if no dictionary is used. |
| **Original Length** | 11 | 8 | `uint64_be` | Uncompressed byte length of the input data. |
| **Original SHA-256** | 19 | 32 | `bytes[32]` | Cryptographic SHA-256 digest of uncompressed source data. |
| **Header CRC32** | 51 | 4 | `uint32_be` | CRC-32 checksum computed over the first 51 bytes (offsets 0–50). |

### 2.1 Algorithm Identifiers

| Algorithm ID | Name | Description |
| :---: | :--- | :--- |
| `0x00` | `store` | Raw uncompressed payload (used when compression offers no size reduction). |
| `0x01` | `gzip` | Deflate compression with RFC 1952 standard framing. |
| `0x02` | `brotli` | Brotli compression (RFC 7932), optimal for text, JSON, and web payloads. |
| `0x03` | `zstd` | Zstandard compression, optimal balance of high ratio and extreme throughput. |
| `0x04` | `zstd-dict` | Zstandard compression utilizing a pre-trained dictionary specified by Dictionary ID. |

### 2.2 Header Flags Bitmask

| Bit | Hex Value | Name | Description |
| :---: | :---: | :--- | :--- |
| **Bit 0** | `0x01` | `HAS_DICTIONARY_ID` | Set if `Dictionary ID > 0`. |
| **Bit 1** | `0x02` | `CHUNKED_STREAM` | Set if payload is encoded in streaming/chunked mode. |
| **Bits 2–7** | `0xFC` | `RESERVED` | Reserved for future versions. Must be zero in Version 1. |

---

## 3. Payload Layout Modes

### 3.1 Non-Chunked Mode (`Flags & 0x02 == 0`)

In standard mode, the entire payload is encoded as a single contiguous stream starting immediately at byte offset 55:

```text
+-------------------------------------------------------------+
| Fixed Header (55 Bytes)                                     |
+-------------------------------------------------------------+
| Compressed Payload (remaining N bytes until EOF)            |
+-------------------------------------------------------------+
```

During decompression:
1. Validate Header CRC32.
2. Confirm `Original Length <= maxDecompressedSize`.
3. Decompress the payload using the specified algorithm (or pass through if `algorithm == 0`).
4. Validate that decompressed byte length equals `Original Length`.
5. Compute SHA-256 over decompressed bytes and assert equality with `Original SHA-256`.

---

### 3.2 Chunked / Streaming Mode (`Flags & 0x02 != 0`)

For high-volume streams and multi-gigabyte files, data is partitioned into independent chunks (default 4 MiB) starting at offset 55, followed by a terminating footer:

#### Chunk Layout:
```text
+-------------------------------+---------------------------------+
| Field                         | Size & Type                     |
+-------------------------------+---------------------------------+
| Chunk Compressed Length       | 4 bytes (uint32_be)             |
| Chunk Uncompressed Length     | 4 bytes (uint32_be)             |
| Chunk CRC32                   | 4 bytes (uint32_be)             |
| Chunk Compressed Payload      | [Chunk Compressed Length] bytes |
+-------------------------------+---------------------------------+
```

#### Final Stream Footer:
Chunks repeat until a chunk header where `Chunk Compressed Length == 0`. Immediately following is the 44-byte stream footer:

```text
+-------------------------------+---------------------------------+
| Field                         | Size & Type                     |
+-------------------------------+---------------------------------+
| Marker: Chunk Length = 0      | 4 bytes (uint32_be = 0x00000000)|
| Total Uncompressed Length     | 8 bytes (uint64_be)             |
| Total SHA-256 Digest          | 32 bytes                        |
| Footer CRC32                  | 4 bytes (uint32_be)             |
+-------------------------------+---------------------------------+
```

This guarantees that streaming decompression checks each individual chunk in real time and finishes with an end-to-end global SHA-256 verification.

---

## 4. Error Handling Requirements

Implementations **MUST** throw explicit, typed errors when encountering anomalies:

- **InvalidMagicError:** First 4 bytes != `LLP1`.
- **UnsupportedVersionError:** Version != `1`.
- **CorruptHeaderError:** Header CRC32 does not match byte contents.
- **ChecksumMismatchError:** Decompressed payload SHA-256 != Header SHA-256.
- **TruncatedDataError:** Stream ends before expected chunk or footer boundary.
- **SizeLimitExceededError:** Header original length exceeds `maxDecompressedSize`.
- **AlgorithmUnavailableError:** Specified algorithm runtime binding is unavailable.
- **DictionaryNotFoundError:** Referenced dictionary ID cannot be resolved.
