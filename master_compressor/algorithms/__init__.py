"""
Compression algorithms package.
"""

from .base import BaseCompressor, AlgorithmType, CompressionResult
from .zlib_engine import ZlibCompressor
from .gzip_engine import GzipCompressor
from .bz2_engine import Bz2Compressor
from .lzma_engine import LzmaCompressor
from .rle_delta_engine import RleDeltaCompressor

__all__ = [
    "BaseCompressor",
    "AlgorithmType",
    "CompressionResult",
    "ZlibCompressor",
    "GzipCompressor",
    "Bz2Compressor",
    "LzmaCompressor",
    "RleDeltaCompressor",
]
