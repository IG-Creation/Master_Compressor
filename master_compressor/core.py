"""
Core MasterCompressor engine with self-describing envelope, checksum validation,
and auto-detection of optimal algorithms.
"""

from __future__ import annotations
import json
import os
import struct
import time
import zlib
from typing import Any, Dict, Optional, Union, Tuple

from .algorithms.base import BaseCompressor, AlgorithmType, CompressionResult
from .algorithms.zlib_engine import ZlibCompressor
from .algorithms.gzip_engine import GzipCompressor
from .algorithms.bz2_engine import Bz2Compressor
from .algorithms.lzma_engine import LzmaCompressor
from .algorithms.rle_delta_engine import RleDeltaCompressor


# Magic header: "MC" + version byte 0x01
MAGIC_HEADER = b"MC\x01"

# Algorithm flag mappings
ALGO_CODE_MAP = {
    AlgorithmType.RAW: 0x00,
    AlgorithmType.ZLIB: 0x01,
    AlgorithmType.GZIP: 0x02,
    AlgorithmType.BZ2: 0x03,
    AlgorithmType.LZMA: 0x04,
    AlgorithmType.RLE_DELTA: 0x05,
}
CODE_ALGO_MAP = {v: k for k, v in ALGO_CODE_MAP.items()}

# Data type tags
TYPE_BINARY = 0x01
TYPE_TEXT = 0x02
TYPE_JSON = 0x03


class MasterCompressor:
    """
    Universal Data Compressor and Storage Engine.
    Compresses any data type (text, JSON, binary blobs, records)
    with self-describing envelope headers, integrity checksums,
    and fallback protections against negative compression.
    """

    def __init__(
        self,
        default_algorithm: Union[AlgorithmType, str] = AlgorithmType.ZLIB,
        adaptive: bool = True,
        max_decompressed_bytes: int = 256 * 1024 * 1024  # 256MB safety limit against zip bombs
    ):
        self.default_algorithm = (
            default_algorithm if isinstance(default_algorithm, AlgorithmType)
            else AlgorithmType(str(default_algorithm).lower())
        )
        self.adaptive = adaptive
        self.max_decompressed_bytes = max_decompressed_bytes

        # Registered compressor engines
        self.compressors: Dict[AlgorithmType, BaseCompressor] = {
            AlgorithmType.ZLIB: ZlibCompressor(),
            AlgorithmType.GZIP: GzipCompressor(),
            AlgorithmType.BZ2: Bz2Compressor(),
            AlgorithmType.LZMA: LzmaCompressor(),
            AlgorithmType.RLE_DELTA: RleDeltaCompressor(),
        }

    def _select_adaptive_algorithm(self, data: bytes, data_type: int) -> AlgorithmType:
        """
        Heuristically chooses the best algorithm based on data size, entropy, and type.
        """
        n = len(data)
        if n < 48:
            # For extremely small payloads, overhead of headers can exceed savings
            return AlgorithmType.ZLIB

        # Check for repetitive sequences (good candidate for RLE / BZ2)
        unique_bytes = len(set(data[:min(1024, n)]))
        if unique_bytes < 10:
            return AlgorithmType.RLE_DELTA

        if data_type == TYPE_JSON:
            # JSON has high lexical repetition, zlib/brotli/gzip excels
            return AlgorithmType.ZLIB

        if n > 500_000:
            # Large files benefit heavily from LZMA or high-ratio Deflate
            return AlgorithmType.LZMA if n < 10_000_000 else AlgorithmType.ZLIB

        return self.default_algorithm

    def _create_envelope(
        self,
        compressed_payload: bytes,
        algo_code: int,
        data_type: int,
        original_size: int,
        crc32_val: int
    ) -> bytes:
        """
        Format:
        [0..2]: Magic (b'MC\x01')
        [3]: Algo Code (uint8)
        [4]: Data Type (uint8)
        [5..8]: CRC32 (uint32 big-endian)
        [9..16]: Original Size (uint64 big-endian)
        [17..]: Compressed payload
        Total header size: 17 bytes
        """
        header = struct.pack(
            ">3sBBIQ",
            MAGIC_HEADER,
            algo_code,
            data_type,
            crc32_val & 0xFFFFFFFF,
            original_size
        )
        return header + compressed_payload

    def _parse_envelope(self, envelope: bytes) -> Tuple[int, int, int, int, bytes]:
        """
        Parses envelope header and returns (algo_code, data_type, crc32_val, original_size, payload).
        """
        if len(envelope) < 17:
            raise ValueError(f"Payload too short for MasterCompressor envelope ({len(envelope)} bytes)")

        magic, algo_code, data_type, crc32_val, orig_size = struct.unpack(">3sBBIQ", envelope[:17])
        if magic != MAGIC_HEADER:
            raise ValueError(f"Invalid MasterCompressor envelope magic: {magic!r}")

        if orig_size > self.max_decompressed_bytes:
            raise ValueError(
                f"Decompressed size {orig_size} exceeds safety limit {self.max_decompressed_bytes}"
            )

        payload = envelope[17:]
        return algo_code, data_type, crc32_val, orig_size, payload

    def is_compressed(self, data: bytes) -> bool:
        """Checks if a byte array begins with the Master Compressor envelope magic."""
        return len(data) >= 3 and data[:3] == MAGIC_HEADER

    def compress(
        self,
        data: bytes,
        algorithm: Optional[Union[AlgorithmType, str]] = None,
        level: Optional[int] = None,
        data_type: int = TYPE_BINARY
    ) -> CompressionResult:
        """
        Compress arbitrary byte payload into a self-describing MasterCompressor envelope.
        """
        orig_size = len(data)
        crc32_val = zlib.crc32(data) & 0xFFFFFFFF
        t0 = time.perf_counter()

        if algorithm is not None:
            chosen_algo = (
                algorithm if isinstance(algorithm, AlgorithmType)
                else AlgorithmType(str(algorithm).lower())
            )
        elif self.adaptive:
            chosen_algo = self._select_adaptive_algorithm(data, data_type)
        else:
            chosen_algo = self.default_algorithm

        compressor = self.compressors.get(chosen_algo, self.compressors[AlgorithmType.ZLIB])
        res = compressor.compress(data, level=level)

        # Fallback to RAW if compressed output plus header is larger than raw data
        envelope_compressed = self._create_envelope(
            res.data,
            ALGO_CODE_MAP[chosen_algo],
            data_type,
            orig_size,
            crc32_val
        )

        if len(envelope_compressed) >= orig_size + 17 and orig_size > 0:
            # Compression caused expansion; store as RAW
            final_data = self._create_envelope(
                data,
                ALGO_CODE_MAP[AlgorithmType.RAW],
                data_type,
                orig_size,
                crc32_val
            )
            algo_used = "raw"
        else:
            final_data = envelope_compressed
            algo_used = compressor.name

        duration_ms = (time.perf_counter() - t0) * 1000.0

        return CompressionResult(
            data=final_data,
            original_size=orig_size,
            compressed_size=len(final_data),
            algorithm=algo_used,
            duration_ms=duration_ms,
            checksum=f"{crc32_val:08x}",
            level=res.level
        )

    def decompress(self, envelope: bytes) -> bytes:
        """
        Decompress a MasterCompressor envelope back to the original byte payload.
        Verifies checksum and ensures zero data loss.
        """
        algo_code, _, expected_crc, orig_size, payload = self._parse_envelope(envelope)

        if algo_code == ALGO_CODE_MAP[AlgorithmType.RAW]:
            raw_bytes = payload
        else:
            algo_type = CODE_ALGO_MAP.get(algo_code)
            if not algo_type or algo_type not in self.compressors:
                raise ValueError(f"Unknown or unsupported algorithm code: {algo_code}")
            compressor = self.compressors[algo_type]
            raw_bytes = compressor.decompress(payload)

        # Verify size
        if len(raw_bytes) != orig_size:
            raise ValueError(
                f"Size mismatch during decompression: expected {orig_size}, got {len(raw_bytes)}"
            )

        # Verify CRC32 checksum
        actual_crc = zlib.crc32(raw_bytes) & 0xFFFFFFFF
        if actual_crc != expected_crc:
            raise ValueError(
                f"Checksum mismatch: expected {expected_crc:08x}, got {actual_crc:08x}. Data corrupted!"
            )

        return raw_bytes

    # --- High-level convenience methods ---

    def compress_text(self, text: str, algorithm: Optional[Union[AlgorithmType, str]] = None) -> CompressionResult:
        """Compress a string (encoded as UTF-8)."""
        data = text.encode("utf-8")
        return self.compress(data, algorithm=algorithm, data_type=TYPE_TEXT)

    def decompress_text(self, envelope: bytes) -> str:
        """Decompress envelope back to a UTF-8 string."""
        raw = self.decompress(envelope)
        return raw.decode("utf-8")

    def compress_json(self, obj: Any, algorithm: Optional[Union[AlgorithmType, str]] = None) -> CompressionResult:
        """Serialize an object to JSON and compress."""
        raw_json = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        return self.compress(raw_json, algorithm=algorithm, data_type=TYPE_JSON)

    def decompress_json(self, envelope: bytes) -> Any:
        """Decompress envelope and parse JSON object."""
        raw = self.decompress(envelope)
        return json.loads(raw.decode("utf-8"))

    def compress_file(self, src_path: str, dst_path: Optional[str] = None) -> CompressionResult:
        """Compress an entire file from disk."""
        with open(src_path, "rb") as f:
            data = f.read()
        res = self.compress(data)
        out_path = dst_path or f"{src_path}.mc"
        with open(out_path, "wb") as f:
            f.write(res.data)
        return res

    def decompress_file(self, src_path: str, dst_path: str) -> int:
        """Decompress a file from disk."""
        with open(src_path, "rb") as f:
            envelope = f.read()
        raw = self.decompress(envelope)
        with open(dst_path, "wb") as f:
            f.write(raw)
        return len(raw)
