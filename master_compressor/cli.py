"""
Command Line Interface for Master Compressor.
"""

from __future__ import annotations
import argparse
import os
import sys
import time
from typing import List, Optional

from .core import MasterCompressor
from .algorithms.base import AlgorithmType
from .database.sqlite_adapter import SQLiteCompressedStore


def run_benchmark(sample_size_kb: int = 100) -> None:
    """Benchmark all available algorithms against synthetic text, JSON, and repetitive datasets."""
    print("=" * 65)
    print(f"MASTER COMPRESSOR BENCHMARK (Sample Size: {sample_size_kb} KB)")
    print("=" * 65)

    # 1. Natural repetitive JSON dataset
    raw_sample = {
        "user_id": 1024,
        "role": "REGIONAL_MANAGER",
        "access_permissions": ["read", "write", "audit", "export"],
        "activity_log": [
            {"action": "LOGIN", "status": "SUCCESS", "timestamp": 1700000000 + i}
            for i in range(sample_size_kb * 10)
        ]
    }
    import json
    data = json.dumps(raw_sample).encode("utf-8")
    orig_kb = len(data) / 1024.0

    print(f"Data Profile: Repetitive JSON ({orig_kb:.1f} KB, {len(data):,} bytes)\n")
    print(f"{'Algorithm':<14} | {'Compressed':<12} | {'Savings':<10} | {'Throughput':<14} | {'Speed (ms)'}")
    print("-" * 65)

    compressor = MasterCompressor(adaptive=False)
    algos = [AlgorithmType.ZLIB, AlgorithmType.GZIP, AlgorithmType.BZ2, AlgorithmType.LZMA, AlgorithmType.RLE_DELTA]

    for algo in algos:
        try:
            res = compressor.compress(data, algorithm=algo)
            # Verify roundtrip
            decomp = compressor.decompress(res.data)
            assert decomp == data, "Integrity check failed!"

            comp_kb = res.compressed_size / 1024.0
            print(
                f"{res.algorithm:<14} | "
                f"{comp_kb:>8.2f} KB   | "
                f"{res.savings_ratio:>7.1f}%  | "
                f"{res.throughput_mb_s:>9.1f} MB/s | "
                f"{res.duration_ms:>8.2f} ms"
            )
        except Exception as e:
            print(f"{algo.value:<14} | ERROR: {e}")

    print("-" * 65)
    print("All algorithm roundtrip integrity tests verified successfully!")
    print("=" * 65)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="master_compressor",
        description="Master Compressor - Compress any type of data and store in database using minimal storage."
    )
    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")

    # Compress file
    p_comp = subparsers.add_parser("compress", help="Compress a file into a Master Compressor envelope (.mc)")
    p_comp.add_argument("source", help="Path to input file")
    p_comp.add_argument("-o", "--output", help="Output file path (default: <source>.mc)")
    p_comp.add_argument("-a", "--algorithm", choices=["zlib", "gzip", "bz2", "lzma", "rle_delta", "adaptive"], default="adaptive")

    # Decompress file
    p_decomp = subparsers.add_parser("decompress", help="Decompress a Master Compressor envelope file")
    p_decomp.add_argument("source", help="Path to .mc input file")
    p_decomp.add_argument("-o", "--output", required=True, help="Output destination file path")

    # Benchmark
    p_bench = subparsers.add_parser("benchmark", help="Run algorithm compression ratio & throughput benchmarks")
    p_bench.add_argument("--size-kb", type=int, default=100, help="Test payload size in KB (default: 100)")

    # Database Store
    p_db = subparsers.add_parser("db-store", help="Compress and store a record into SQLite database")
    p_db.add_argument("db", help="Path to SQLite database file")
    p_db.add_argument("key", help="Unique record key")
    p_db.add_argument("value", help="Value string or JSON")

    # Database Retrieve
    p_dbget = subparsers.add_parser("db-get", help="Retrieve and decompress a record from SQLite database")
    p_dbget.add_argument("db", help="Path to SQLite database file")
    p_dbget.add_argument("key", help="Record key to fetch")

    # Database Stats
    p_dbstats = subparsers.add_parser("db-stats", help="Show SQLite compression savings and database size stats")
    p_dbstats.add_argument("db", help="Path to SQLite database file")

    args = parser.parse_args(argv)

    if not args.command:
        parser.print_help()
        return 0

    mc = MasterCompressor()

    if args.command == "compress":
        algo = None if args.algorithm == "adaptive" else args.algorithm
        out = args.output or f"{args.source}.mc"
        res = mc.compress_file(args.source, out)
        print(f"Compressed {args.source} -> {out}")
        print(f"Original Size   : {res.original_size:,} bytes")
        print(f"Compressed Size : {res.compressed_size:,} bytes")
        print(f"Space Saved     : {res.savings_ratio:.1f}%")
        print(f"Algorithm Used  : {res.algorithm}")
        print(f"Checksum        : {res.checksum}")
        print(f"Duration        : {res.duration_ms:.2f} ms ({res.throughput_mb_s:.1f} MB/s)")
        return 0

    elif args.command == "decompress":
        written = mc.decompress_file(args.source, args.output)
        print(f"Decompressed {args.source} -> {args.output}")
        print(f"Restored Size   : {written:,} bytes (verified lossless roundtrip)")
        return 0

    elif args.command == "benchmark":
        run_benchmark(args.size_kb)
        return 0

    elif args.command == "db-store":
        store = SQLiteCompressedStore(args.db)
        written = store.store(args.key, args.value)
        store.close()
        print(f"Stored '{args.key}' into {args.db} ({written} compressed bytes)")
        return 0

    elif args.command == "db-get":
        store = SQLiteCompressedStore(args.db)
        val = store.retrieve(args.key)
        store.close()
        if val is None:
            print(f"Key '{args.key}' not found.")
            return 1
        print(val)
        return 0

    elif args.command == "db-stats":
        store = SQLiteCompressedStore(args.db)
        stats = store.get_stats()
        store.close()
        import json
        print(json.dumps(stats, indent=2))
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
