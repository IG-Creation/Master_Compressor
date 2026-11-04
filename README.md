# Master Compressor 🗜️⚡

> **High-Performance Universal Data Compression & Database Storage Engine**  
> *Compress any type of data and store it in your database using minimal storage.*

[![CI Test Suite](https://github.com/IG-Creation/Master_Compressor/actions/workflows/test.yml/badge.svg)](https://github.com/IG-Creation/Master_Compressor/actions)
[![Deploy Pages](https://github.com/IG-Creation/Master_Compressor/actions/workflows/pages.yml/badge.svg)](https://github.com/IG-Creation/Master_Compressor/actions)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-blue?logo=github)](https://ig-creation.github.io/Master_Compressor/)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Storage Reduction](https://img.shields.io/badge/Storage%20Saved-60%25%20--%2098%25-brightgreen.svg)](#-live-benchmarks)

---

## 🌐 Live Interactive Studio & Playground

Try Master Compressor directly in your browser:  
👉 **[https://ig-creation.github.io/Master_Compressor/](https://ig-creation.github.io/Master_Compressor/)**

- **Live Compression Studio:** Drag & drop any file, image, JSON, or text to see real-time compression ratios and speeds.
- **In-Browser Database Lab:** Test transparent compression with client-side IndexedDB and measure storage quotas.
- **Algorithm Arena:** Compare Deflate, Gzip, Bzip2, LZMA, and Canvas WebP side by side.
- **ROI & Cost Calculator:** Calculate monthly and annual AWS RDS, Aurora, MongoDB Atlas, and S3 storage savings.

---

## 🚀 Key Highlights & Architectural Features

### 1. 🗜️ Universal Multi-Type Data Compression
Compresses every category of enterprise data:
- **JSON & Structured Documents:** High-redundancy dictionary compression yielding 80%–96% reduction.
- **Logs & Text Telemetry:** Stream compression for audit trails, webserver logs, and crash reports.
- **Tabular Data & CSV:** Columnar and record-level compression.
- **Numeric & Time-Series Series:** Specialized Delta + Run-Length Encoding (RLE) for sensor readings and metrics.
- **Images & Visual Media:** Client-side Canvas WebP/JPEG quantization that shrinks 10MB mobile photos to ~25KB while preserving clarity.
- **Binary Buffers & Blobs:** Lossless arbitrary byte array compression.

### 2. ⚡ Self-Describing `MC01` Envelope & Tamper Resistance
Every compressed item is wrapped in an ultra-compact 17-byte self-describing header:
- **Magic Bytes (`MC\x01`):** Instant format identification.
- **Algorithm Identifier:** Automatic detection of decompression algorithm without external database columns.
- **Original Size Header:** Protects against decompression memory exhaustion and zip-bombs.
- **Hardware CRC32 Checksum:** Validates 100% lossless bit-for-bit restoration.
- **Negative Compression Fallback (`RAW`):** If random high-entropy data would expand when compressed, it automatically switches to RAW mode so data never grows.

### 3. 🗄️ Transparent Database Integration
- **SQLite Adapter (`SQLiteCompressedStore`):** Transparently compresses payloads before saving into BLOB columns and decompresses on retrieval.
- **Custom SQL UDFs:** Directly executes `mc_compress(?)` and `mc_decompress(?)` in standard SQL queries.
- **Key-Value Store (`CompressedKVStore`):** Drop-in document and cache store with automatic compression.
- **Storage Analytics:** Live tracking of disk file size, uncompressed volume, compressed volume, and percent saved.

---

## 📊 Live Benchmarks

Tested on standard synthetic 50 KB repetitive JSON payload:

| Algorithm | Compressed Size | Storage Saved (%) | Throughput (MB/s) | Latency (ms) |
| :--- | :---: | :---: | :---: | :---: |
| **Zlib (Deflate)** | **1.43 KB** | **95.6%** | **123.9 MB/s** | **0.26 ms** |
| **Gzip** | **1.45 KB** | **95.6%** | **176.4 MB/s** | **0.18 ms** |
| **Bzip2** | **0.80 KB** | **97.6%** | **13.5 MB/s** | **2.37 ms** |
| **LZMA (XZ)** | **0.43 KB** | **98.7%** | **4.3 MB/s** | **7.45 ms** |
| **RLE + Delta** | **3.40 KB** | **89.7%** | **4.5 MB/s** | **7.05 ms** |

---

## 🛠️ Installation & Setup

Zero third-party dependencies required. Standard library compatibility out of the box!

```bash
# Clone repository
git clone https://github.com/IG-Creation/Master_Compressor.git
cd Master_Compressor

# Optional: Create virtual environment
python -m venv venv
# On Windows:
.\venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate
```

---

## 💻 Python Quickstart

### 1. High-Performance Text & JSON Compression
```python
from master_compressor import compress_json, decompress_json, compress_text, decompress_text

# Compress JSON object
payload = {
    "user_id": 1024,
    "role": "SYSTEM_ADMIN",
    "permissions": ["read", "write", "audit", "export"],
    "metrics": [12.4, 15.8, 99.1, 4.2]
}

result = compress_json(payload)
print(f"Original: {result.original_size} bytes -> Compressed: {result.compressed_size} bytes")
print(f"Space Saved: {result.savings_ratio}% | Algorithm: {result.algorithm}")

# Lossless Decompression with Checksum Verification
restored = decompress_json(result.data)
assert restored == payload
```

### 2. Transparent Database Storage (SQLite)
```python
from master_compressor.database import SQLiteCompressedStore

# Initialize compressed table
store = SQLiteCompressedStore("analytics.db")

# Store document (automatically compressed before disk write)
store.store("session_9012", payload)

# Retrieve document (automatically decompressed)
session = store.retrieve("session_9012")

# Check storage savings statistics
stats = store.get_stats()
print(f"Total Stored: {stats['record_count']} records")
print(f"Savings: {stats['savings_percentage']}% space saved on disk!")
store.close()
```

### 3. Key-Value Store Usage
```python
from master_compressor.database import CompressedKVStore

kv = CompressedKVStore("cache.db")
kv.set("user_token", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...")
token = kv.get("user_token")
print("KV Storage Stats:", kv.stats())
kv.close()
```

---

## 🖥️ Command Line Interface (CLI)

```bash
# 1. Compress a file into a Master Compressor envelope
python run.py compress server.log -o server.log.mc

# 2. Decompress file back to original
python run.py decompress server.log.mc -o server_restored.log

# 3. Store compressed record into SQLite from terminal
python run.py db-store records.db user_101 '{"status": "ACTIVE", "tier": "GOLD"}'

# 4. Retrieve record from database
python run.py db-get records.db user_101

# 5. Show database storage savings report
python run.py db-stats records.db

# 6. Run automated algorithm benchmark
python run.py --bench 100

# 7. Run full test suite
python run.py --test

# 8. Start local REST microservice
python run.py --serve 8080
```

---

## 🧪 Comprehensive Automated Testing

The repository contains an exhaustive test suite verifying every possible scenario:
- **Algorithm Lossless Integrity:** Deflate, Gzip, BZ2, LZMA, RLE-Delta roundtrip equality.
- **Data Types:** Empty payloads, 1-byte payloads, multi-megabyte payloads, random high-entropy bytes (RAW fallback), unicode, and emojis.
- **Envelope Headers:** Magic bytes, CRC32 checksum tampering detection, zip-bomb decompression limit guards.
- **Database Operations:** Insert, retrieve, update, delete, SQLite custom UDF functions, and storage savings accounting.
- **CLI & REST API:** File compress/decompress roundtrips, database commands, and HTTP microservice endpoints.

Run the test suite with:
```bash
python run.py --test
```

Output:
```text
Ran 22 tests in 0.483s
OK
```

---

## 📁 Repository Structure

```text
Master_Compressor/
├── master_compressor/             # Core Python Engine
│   ├── algorithms/                # Compression algorithms (Zlib, Gzip, BZ2, LZMA, RLE-Delta)
│   ├── database/                  # SQLite adapter, KV store, and base interfaces
│   ├── core.py                    # MasterCompressor core class & envelope serialization
│   ├── cli.py                     # Command-line interface
│   └── server.py                  # HTTP REST API server
├── tests/                         # Comprehensive Unit & Integration Tests
│   ├── test_algorithms.py
│   ├── test_core_envelope.py
│   ├── test_data_types.py
│   ├── test_database.py
│   └── test_cli_server.py
├── .github/workflows/             # GitHub Actions CI & Pages Deployment
│   ├── test.yml                   # Automated Multi-OS Python matrix tests
│   └── pages.yml                  # Automated GitHub Pages deploy
├── index.html                     # Live Interactive Web Dashboard & Studio
├── styles.css                     # Executive responsive styling & themes
├── app.js                         # Web compression engine & IndexedDB manager
├── run.py                         # Unified runner script
├── requirements.txt               # Dependencies
└── README.md                      # Documentation
```

---

## 📄 License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.
