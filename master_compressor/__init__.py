"""
Master Compressor - Universal Data Compression & Database Storage Engine.
Compress any type of data and store it in your database using minimal storage.
"""

from .core import (
    MasterCompressor,
    MAGIC_HEADER,
    TYPE_BINARY,
    TYPE_TEXT,
    TYPE_JSON,
)
from .algorithms.base import (
    AlgorithmType,
    BaseCompressor,
    CompressionResult,
)
from .algorithms import (
    ZlibCompressor,
    GzipCompressor,
    Bz2Compressor,
    LzmaCompressor,
    RleDeltaCompressor,
)
from .database import (
    BaseDatabaseAdapter,
    SQLiteCompressedStore,
    CompressedKVStore,
)

__version__ = "1.0.0"
__author__ = "IG-Creation"

# Quick convenience functions
_default_compressor = MasterCompressor()

def compress(data: bytes, algorithm: str = None) -> CompressionResult:
    """Quick compress bytes."""
    return _default_compressor.compress(data, algorithm=algorithm)

def decompress(envelope: bytes) -> bytes:
    """Quick decompress bytes."""
    return _default_compressor.decompress(envelope)

def compress_text(text: str, algorithm: str = None) -> CompressionResult:
    """Quick compress string."""
    return _default_compressor.compress_text(text, algorithm=algorithm)

def decompress_text(envelope: bytes) -> str:
    """Quick decompress string."""
    return _default_compressor.decompress_text(envelope)

def compress_json(obj, algorithm: str = None) -> CompressionResult:
    """Quick compress JSON serializable object."""
    return _default_compressor.compress_json(obj, algorithm=algorithm)

def decompress_json(envelope: bytes):
    """Quick decompress JSON serializable object."""
    return _default_compressor.decompress_json(envelope)

__all__ = [
    "MasterCompressor",
    "MAGIC_HEADER",
    "TYPE_BINARY",
    "TYPE_TEXT",
    "TYPE_JSON",
    "AlgorithmType",
    "BaseCompressor",
    "CompressionResult",
    "ZlibCompressor",
    "GzipCompressor",
    "Bz2Compressor",
    "LzmaCompressor",
    "RleDeltaCompressor",
    "BaseDatabaseAdapter",
    "SQLiteCompressedStore",
    "CompressedKVStore",
    "compress",
    "decompress",
    "compress_text",
    "decompress_text",
    "compress_json",
    "decompress_json",
]
