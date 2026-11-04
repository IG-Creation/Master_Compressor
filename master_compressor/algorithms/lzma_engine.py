"""
LZMA / XZ compression engine. Exceptional compression ratios for archiving and low-bandwidth storage.
"""

from __future__ import annotations
import lzma
import time
from typing import Optional
from .base import BaseCompressor, AlgorithmType, CompressionResult


class LzmaCompressor(BaseCompressor):
    """LZMA (XZ format) compression engine."""

    def __init__(self, default_preset: int = 6):
        self.default_preset = max(0, min(9, default_preset))

    @property
    def name(self) -> str:
        return "lzma"

    @property
    def algorithm_type(self) -> AlgorithmType:
        return AlgorithmType.LZMA

    def compress(self, data: bytes, level: Optional[int] = None) -> CompressionResult:
        lvl = self.default_preset if level is None else max(0, min(9, level))
        t0 = time.perf_counter()
        compressed = lzma.compress(data, preset=lvl)
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
        return lzma.decompress(data)
