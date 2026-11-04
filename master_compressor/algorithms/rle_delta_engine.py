"""
Run-Length Encoding (RLE) and Delta Encoding Engine.
Optimized for repeating byte streams, numerical series, sensor readings, and sparse database columns.
"""

from __future__ import annotations
import time
import struct
import zlib
from typing import Optional
from .base import BaseCompressor, AlgorithmType, CompressionResult


class RleDeltaCompressor(BaseCompressor):
    """
    Combines Delta Difference Encoding with Run-Length Compression.
    Particularly effective on monotonically increasing integers, timestamps,
    and large sequences of repeating bytes or zeros.
    """

    @property
    def name(self) -> str:
        return "rle_delta"

    @property
    def algorithm_type(self) -> AlgorithmType:
        return AlgorithmType.RLE_DELTA

    @staticmethod
    def _encode_rle(data: bytes) -> bytes:
        if not data:
            return b""
        out = bytearray()
        i = 0
        n = len(data)
        while i < n:
            byte = data[i]
            count = 1
            while i + 1 < n and data[i + 1] == byte and count < 255:
                count += 1
                i += 1
            out.append(count)
            out.append(byte)
            i += 1
        return bytes(out)

    @staticmethod
    def _decode_rle(data: bytes) -> bytes:
        if not data:
            return b""
        if len(data) % 2 != 0:
            raise ValueError("Corrupted RLE payload: odd byte length")
        out = bytearray()
        for i in range(0, len(data), 2):
            count = data[i]
            byte = data[i + 1]
            out.extend([byte] * count)
        return bytes(out)

    @staticmethod
    def _delta_encode(data: bytes) -> bytes:
        if not data:
            return b""
        out = bytearray(len(data))
        out[0] = data[0]
        for i in range(1, len(data)):
            out[i] = (data[i] - data[i - 1]) & 0xFF
        return bytes(out)

    @staticmethod
    def _delta_decode(data: bytes) -> bytes:
        if not data:
            return b""
        out = bytearray(len(data))
        out[0] = data[0]
        for i in range(1, len(data)):
            out[i] = (out[i - 1] + data[i]) & 0xFF
        return bytes(out)

    def compress(self, data: bytes, level: Optional[int] = None) -> CompressionResult:
        t0 = time.perf_counter()
        # Step 1: Delta encode
        delta = self._delta_encode(data)
        # Step 2: RLE encode
        rle = self._encode_rle(delta)
        # Step 3: Optional light Deflate pass for secondary entropy reduction
        compressed = zlib.compress(rle, level=1)
        duration_ms = (time.perf_counter() - t0) * 1000.0

        return CompressionResult(
            data=compressed,
            original_size=len(data),
            compressed_size=len(compressed),
            algorithm=self.name,
            duration_ms=duration_ms,
            checksum=self.compute_checksum(data),
            level=1
        )

    def decompress(self, data: bytes) -> bytes:
        rle = zlib.decompress(data)
        delta = self._decode_rle(rle)
        return self._delta_decode(delta)
