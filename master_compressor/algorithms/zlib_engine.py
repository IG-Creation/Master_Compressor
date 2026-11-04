"""
Zlib (Deflate) compression engine. Fast, balanced ratio, universally supported.
"""

from __future__ import annotations
import time
import zlib
from typing import Optional
from .base import BaseCompressor, AlgorithmType, CompressionResult


class ZlibCompressor(BaseCompressor):
    """Zlib / Deflate compression engine."""

    def __init__(self, default_level: int = 6):
        self.default_level = max(0, min(9, default_level))

    @property
    def name(self) -> str:
        return "zlib"

    @property
    def algorithm_type(self) -> AlgorithmType:
        return AlgorithmType.ZLIB

    def compress(self, data: bytes, level: Optional[int] = None) -> CompressionResult:
        lvl = self.default_level if level is None else max(0, min(9, level))
        t0 = time.perf_counter()
        compressed = zlib.compress(data, level=lvl)
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
        return zlib.decompress(data)
