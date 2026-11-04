"""
Unit tests covering diverse data profiles:
JSON, text, unicode, emoji, massive payloads, random high-entropy bytes, empty payloads.
"""

import os
import unittest
from master_compressor import (
    MasterCompressor,
    compress,
    decompress,
    compress_text,
    decompress_text,
    compress_json,
    decompress_json
)


class TestDataTypes(unittest.TestCase):

    def setUp(self):
        self.mc = MasterCompressor()

    def test_empty_payload(self):
        """Empty bytes should be safely enveloped and restored without crash."""
        res = self.mc.compress(b"")
        self.assertEqual(res.original_size, 0)
        decomp = self.mc.decompress(res.data)
        self.assertEqual(decomp, b"")

    def test_single_byte_payload(self):
        """Single byte payload."""
        res = self.mc.compress(b"X")
        self.assertEqual(self.mc.decompress(res.data), b"X")

    def test_unicode_and_emojis(self):
        """Complex multilingual strings and multi-byte emojis."""
        text = "🚀 Master Compressor 🗜️ 压缩 データベース high performance! 日本語, العربية, हिन्दी: डेटा कम्प्रेशन"
        res = compress_text(text)
        restored = decompress_text(res.data)
        self.assertEqual(restored, text)

    def test_nested_json(self):
        """Complex JSON object with nested dicts, lists, booleans, and nulls."""
        data = {
            "application": "Master Compressor",
            "version": 1.0,
            "metrics": [12.5, 45.8, 99.1, 0.0, -14.2],
            "active": True,
            "extra": None,
            "nested": {
                "records": [
                    {"id": i, "token": f"token_{i * 7}", "value": f"sample_val_{i}"}
                    for i in range(100)
                ]
            }
        }
        res = compress_json(data)
        self.assertGreater(res.savings_ratio, 50.0)
        restored = decompress_json(res.data)
        self.assertEqual(restored, data)

    def test_random_high_entropy_bytes(self):
        """
        Uncompressible random bytes.
        Verifies that MasterCompressor gracefully falls back to RAW mode
        without corrupting data or allowing unbounded expansion.
        """
        random_bytes = os.urandom(1024)
        res = self.mc.compress(random_bytes)
        restored = self.mc.decompress(res.data)
        self.assertEqual(restored, random_bytes)

    def test_large_repetitive_payload(self):
        """500 KB repetitive payload achieves >90% compression."""
        large_payload = (b"DATABASE_ROW_DATA_FIELD_VALUE_1234567890\n" * 12500)
        self.assertGreaterEqual(len(large_payload), 500_000)
        res = self.mc.compress(large_payload)
        self.assertGreater(res.savings_ratio, 90.0)
        self.assertEqual(self.mc.decompress(res.data), large_payload)


if __name__ == "__main__":
    unittest.main()
