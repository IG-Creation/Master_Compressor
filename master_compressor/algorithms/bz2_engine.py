"""
Bzip2 compression engine. High compression ratio for text, logs, and repeating tabular data.
"""

from __future__ import annotations
import bz2
import time
from typing import Optional
from .base import BaseCompressor, AlgorithmType, CompressionResult


class Bz2Compressor(BaseCompressor):
    """Bzip2 compression engine."""

    def __init__(self, default_level: int = 9):
        self.default_level = max(1, min(9, default_level))

    @property
    def name(self) -> str:
        return "bz2"

    @property
    def algorithm_type(self) -> AlgorithmType:
        return AlgorithmType.BZ2

    def compress(self, data: bytes, level: Optional[int] = None) -> CompressionResult:
        lvl = self.default_level if level is None else max(1, min(9, level))
        t0 = time.perf_counter()
        compressed = bz2.compress(data, compresslevel=lvl)
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
        return bz2.decompress(data)
