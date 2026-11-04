"""
Unit tests for database storage adapters and SQLite compression integration.
"""

import os
import tempfile
import unittest
from master_compressor.database import SQLiteCompressedStore, CompressedKVStore


class TestDatabaseStorage(unittest.TestCase):

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp_dir.name, "test_compressed.db")
        self.store = SQLiteCompressedStore(self.db_path)

    def tearDown(self):
        self.store.close()
        self.tmp_dir.cleanup()

    def test_store_and_retrieve_json(self):
        """Store complex JSON document, retrieve and verify equality."""
        doc = {
            "session_id": "sess_89123891",
            "user": "Alice",
            "roles": ["admin", "viewer"],
            "logs": ["action_1", "action_2", "action_3"] * 20
        }
        written = self.store.store("doc_1", doc)
        self.assertGreater(written, 0)

        retrieved = self.store.retrieve("doc_1")
        self.assertEqual(retrieved, doc)

    def test_store_and_retrieve_text_and_binary(self):
        """Store plain text and raw binary blobs."""
        text_val = "Sample database row string value. " * 30
        self.store.store("text_key", text_val)
        self.assertEqual(self.store.retrieve("text_key"), text_val)

        blob_val = b"\x00\x01\x02\x03\xFF\xFE\xFD" * 50
        self.store.store("blob_key", blob_val)
        self.assertEqual(self.store.retrieve("blob_key"), blob_val)

    def test_upsert_and_delete(self):
        """Update existing key and delete key."""
        self.store.store("key_a", "Initial")
        self.assertEqual(self.store.retrieve("key_a"), "Initial")

        self.store.store("key_a", "Updated value")
        self.assertEqual(self.store.retrieve("key_a"), "Updated value")

        deleted = self.store.delete("key_a")
        self.assertTrue(deleted)
        self.assertIsNone(self.store.retrieve("key_a"))
        self.assertFalse(self.store.delete("key_a"))

    def test_storage_savings_stats(self):
        """Verify that get_stats accurately measures space saved on database records."""
        # Insert 100 realistic telemetry / audit records (~1KB each)
        for i in range(100):
            payload = {
                "id": i,
                "company": "Enterprise Tech Solutions Inc",
                "department": "Engineering Operations & Infrastructure",
                "description": "Standard recurring telemetry log message for field unit cluster alpha." * 5,
                "status": "HEALTHY",
                "audit_trail": [
                    {"step": j, "status": "PASSED", "detail": "Validated schema and authorization tokens successfully"}
                    for j in range(5)
                ]
            }
            self.store.store(f"row_{i}", payload)

        stats = self.store.get_stats()
        self.assertEqual(stats["record_count"], 100)
        self.assertGreater(stats["total_original_bytes"], stats["total_compressed_bytes"])
        self.assertGreater(stats["savings_percentage"], 50.0)
        self.assertGreater(stats["total_saved_bytes"], 0)

    def test_sqlite_udf_functions(self):
        """Test custom SQL UDF functions mc_compress and mc_decompress directly in SQL query."""
        cursor = self.store.conn.cursor()
        cursor.execute("SELECT mc_compress('SQL Direct Test String');")
        compressed_blob = cursor.fetchone()[0]
        self.assertIsInstance(compressed_blob, bytes)

        cursor.execute("SELECT mc_decompress(?);", (compressed_blob,))
        restored_str = cursor.fetchone()[0]
        self.assertEqual(restored_str, "SQL Direct Test String")

    def test_kv_store_convenience(self):
        """Test CompressedKVStore helper."""
        kv = CompressedKVStore(":memory:")
        kv.set("metric", {"cpu": 42.1, "mem": 68.4})
        self.assertTrue(kv.exists("metric"))
        self.assertEqual(kv.get("metric"), {"cpu": 42.1, "mem": 68.4})
        self.assertIn("metric", kv.keys())
        self.assertGreater(kv.stats()["record_count"], 0)
        kv.close()


if __name__ == "__main__":
    unittest.main()
