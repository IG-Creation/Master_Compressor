"""
Unit tests for envelope serialization, CRC32 checksums, tamper resistance, and security bounds.
"""

import unittest
from master_compressor.core import MasterCompressor, MAGIC_HEADER
from master_compressor.algorithms.base import AlgorithmType


class TestCoreEnvelope(unittest.TestCase):

    def setUp(self):
        self.mc = MasterCompressor()

    def test_magic_header_present(self):
        """Compressed output starts with MAGIC_HEADER."""
        res = self.mc.compress(b"Hello world!")
        self.assertTrue(self.mc.is_compressed(res.data))
        self.assertTrue(res.data.startswith(MAGIC_HEADER))

    def test_tamper_detection(self):
        """Mutating a single byte in the payload triggers checksum verification failure."""
        res = self.mc.compress(b"Sensitive financial or database record payload.")
        corrupted = bytearray(res.data)
        # Flip bit in the payload region (after 17-byte header)
        corrupted[-1] ^= 0xFF
        with self.assertRaises(ValueError) as ctx:
            self.mc.decompress(bytes(corrupted))
        self.assertIn("Checksum mismatch", str(ctx.exception))

    def test_invalid_magic_header(self):
        """Payload lacking magic header raises ValueError."""
        bogus_data = b"NOT_A_VALID_ENVELOPE_DATA"
        with self.assertRaises(ValueError) as ctx:
            self.mc.decompress(bogus_data)
        self.assertIn("Invalid MasterCompressor envelope magic", str(ctx.exception))

    def test_zip_bomb_memory_limit(self):
        """Configured safety limit prevents unbounded memory allocation."""
        strict_mc = MasterCompressor(max_decompressed_bytes=100)
        # 500 bytes payload exceeds 100 bytes limit
        res = self.mc.compress(b"A" * 500)
        with self.assertRaises(ValueError) as ctx:
            strict_mc.decompress(res.data)
        self.assertIn("exceeds safety limit", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
