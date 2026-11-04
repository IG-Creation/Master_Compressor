"""
Unit tests for individual compression algorithms.
"""

import unittest
from master_compressor.algorithms import (
    ZlibCompressor,
    GzipCompressor,
    Bz2Compressor,
    LzmaCompressor,
    RleDeltaCompressor,
    AlgorithmType
)


class TestCompressionAlgorithms(unittest.TestCase):

    def setUp(self):
        self.sample_text = (
            "The quick brown fox jumps over the lazy dog. " * 50 +
            "Master Compressor reduces database storage costs by up to 90%! " * 50
        ).encode("utf-8")

        self.engines = [
            ZlibCompressor(),
            GzipCompressor(),
            Bz2Compressor(),
            LzmaCompressor(),
            RleDeltaCompressor(),
        ]

    def test_roundtrip_lossless_integrity(self):
        """Verify that every engine decompresses to exact original bytes."""
        for engine in self.engines:
            with self.subTest(engine=engine.name):
                res = engine.compress(self.sample_text)
                self.assertGreater(len(res.data), 0)
                self.assertLess(res.compressed_size, res.original_size)
                self.assertGreater(res.savings_ratio, 40.0)

                decompressed = engine.decompress(res.data)
                self.assertEqual(decompressed, self.sample_text)

    def test_compression_levels(self):
        """Test varied compression levels across engines."""
        zlib_engine = ZlibCompressor()
        fast = zlib_engine.compress(self.sample_text, level=1)
        best = zlib_engine.compress(self.sample_text, level=9)
        self.assertLessEqual(best.compressed_size, fast.compressed_size)
        self.assertEqual(zlib_engine.decompress(fast.data), self.sample_text)
        self.assertEqual(zlib_engine.decompress(best.data), self.sample_text)

    def test_rle_delta_on_numeric_and_sparse_series(self):
        """Test RLE + Delta engine on repetitive byte arrays."""
        rle_engine = RleDeltaCompressor()
        # Monotonically increasing bytes + repeating blocks
        sparse_data = bytes([0] * 200 + [1] * 100 + [2] * 300 + list(range(50)))
        res = rle_engine.compress(sparse_data)
        self.assertGreater(res.savings_ratio, 60.0)
        self.assertEqual(rle_engine.decompress(res.data), sparse_data)


if __name__ == "__main__":
    unittest.main()
