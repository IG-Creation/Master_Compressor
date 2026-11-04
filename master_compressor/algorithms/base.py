"""
Base interfaces, data structures, and metadata for Master Compressor.
"""

from __future__ import annotations
import time
import zlib
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class AlgorithmType(str, Enum):
    """Supported compression algorithm identifiers."""
    ZLIB = "zlib"          # Deflate via zlib (balanced speed and ratio)
    GZIP = "gzip"          # Gzip format (widely compatible web standard)
    BZ2 = "bz2"            # Bzip2 (high ratio on repetitive text/logs)
    LZMA = "lzma"          # LZMA / XZ (maximum compression ratio)
    RLE_DELTA = "rle_delta"# Delta + Run-Length Encoding for numeric/metrics
    RAW = "raw"            # Uncompressed fallback (when compression increases size)


@dataclass
class CompressionResult:
    """Detailed result of a compression operation."""
    data: bytes
    original_size: int
    compressed_size: int
    algorithm: str
    duration_ms: float
    checksum: str
    level: int = -1

    @property
    def savings_ratio(self) -> float:
        """Percentage of space saved (0.0 to 100.0%). Returns 0.0 if not reduced."""
        if self.original_size <= 0:
            return 0.0
        saved = (self.original_size - self.compressed_size) / self.original_size * 100.0
        return max(0.0, round(saved, 2))

    @property
    def compression_ratio(self) -> float:
        """Compressed size / original size (e.g. 0.25 = compressed to 25% of original)."""
        if self.original_size <= 0:
            return 1.0
        return round(self.compressed_size / self.original_size, 4)

    @property
    def throughput_mb_s(self) -> float:
        """Throughput in Megabytes per second."""
        if self.duration_ms <= 0:
            return 0.0
        mb = self.original_size / (1024 * 1024)
        seconds = self.duration_ms / 1000.0
        return round(mb / seconds, 2)


class BaseCompressor(ABC):
    """Abstract base class for all compression algorithm implementations."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Name identifier of the compressor."""
        pass

    @property
    @abstractmethod
    def algorithm_type(self) -> AlgorithmType:
        """Algorithm type enum value."""
        pass

    @abstractmethod
    def compress(self, data: bytes, level: Optional[int] = None) -> CompressionResult:
        """Compress raw byte payload."""
        pass

    @abstractmethod
    def decompress(self, data: bytes) -> bytes:
        """Decompress compressed byte payload back to original bytes."""
        pass

    def compute_checksum(self, data: bytes) -> str:
        """Compute CRC32 checksum hex string."""
        return f"{zlib.crc32(data) & 0xffffffff:08x}"
