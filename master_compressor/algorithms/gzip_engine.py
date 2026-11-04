"""
Gzip compression engine. Standard web and database compression format.
"""

from __future__ import annotations
import gzip
import time
from typing import Optional
from .base import BaseCompressor, AlgorithmType, CompressionResult


class GzipCompressor(BaseCompressor):
    """Gzip compression engine with configurable compresslevel and mtime optimization."""

    def __init__(self, default_level: int = 6):
        self.default_level = max(0, min(9, default_level))

    @property
    def name(self) -> str:
        return "gzip"

    @property
    def algorithm_type(self) -> AlgorithmType:
        return AlgorithmType.GZIP

    def compress(self, data: bytes, level: Optional[int] = None) -> CompressionResult:
        lvl = self.default_level if level is None else max(0, min(9, level))
        t0 = time.perf_counter()
        # mtime=0 produces deterministic output and eliminates 4 timestamp bytes
        compressed = gzip.compress(data, compresslevel=lvl, mtime=0)
        duration_ms = (time.perf_counter() - t0) * 1000.0

        return CompressionResult(
            data=compressed,
            original_size=len(data),
            compressed_size=len(compressed),
            algorithm=self.name,
            duration_ms=duration_ms,
            checksum=self.compute_checksum(data),
            level=lvl
        )

    def decompress(self, data: bytes) -> bytes:
        return gzip.decompress(data)
