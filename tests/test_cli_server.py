"""
Unit tests for CLI commands and HTTP server request handling.
"""

import base64
import json
import os
import tempfile
import unittest
from io import BytesIO
from unittest.mock import MagicMock

from master_compressor.cli import main as cli_main
from master_compressor.server import MasterCompressorHandler
from master_compressor.core import MasterCompressor


class TestCliAndServer(unittest.TestCase):

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_cli_compress_and_decompress_file(self):
        """Test full file roundtrip via CLI commands."""
        src_file = os.path.join(self.tmp_dir.name, "sample.txt")
        comp_file = os.path.join(self.tmp_dir.name, "sample.txt.mc")
        restored_file = os.path.join(self.tmp_dir.name, "restored.txt")

        test_content = "Master Compressor File CLI Testing Payload\n" * 200
        with open(src_file, "w", encoding="utf-8") as f:
            f.write(test_content)

        # Compress via CLI
        code = cli_main(["compress", src_file, "-o", comp_file])
        self.assertEqual(code, 0)
        self.assertTrue(os.path.exists(comp_file))

        # Decompress via CLI
        code = cli_main(["decompress", comp_file, "-o", restored_file])
        self.assertEqual(code, 0)
        self.assertTrue(os.path.exists(restored_file))

        with open(restored_file, "r", encoding="utf-8") as f:
            self.assertEqual(f.read(), test_content)

    def test_cli_db_commands(self):
        """Test db-store, db-get, and db-stats via CLI."""
        db_file = os.path.join(self.tmp_dir.name, "cli_test.db")

        # db-store
        code = cli_main(["db-store", db_file, "user_key", "{\"name\": \"Dev\", \"role\": \"Lead\"}"])
        self.assertEqual(code, 0)

        # db-get
        code = cli_main(["db-get", db_file, "user_key"])
        self.assertEqual(code, 0)

        # db-stats
        code = cli_main(["db-stats", db_file])
        self.assertEqual(code, 0)

    def test_server_compress_and_decompress_endpoint(self):
        """Mock test HTTP handler endpoints for /api/compress and /api/decompress."""
        mc = MasterCompressor()
        raw_text = "Master Compressor Server Microservice API Test Payload"

        # 1. Test POST /api/compress
        handler = MasterCompressorHandler.__new__(MasterCompressorHandler)
        handler.headers = {"Content-Length": "0"}
        handler.path = "/api/compress"
        handler.wfile = BytesIO()

        # Send body
        req_body = json.dumps({"text": raw_text}).encode("utf-8")
        handler.rfile = BytesIO(req_body)
        handler.headers["Content-Length"] = str(len(req_body))

        sent_status = None
        sent_headers = {}

        def mock_send_response(code):
            nonlocal sent_status
            sent_status = code

        def mock_send_header(k, v):
            sent_headers[k] = v

        def mock_end_headers():
            pass

        handler.send_response = mock_send_response
        handler.send_header = mock_send_header
        handler.end_headers = mock_end_headers

        handler.do_POST()

        self.assertEqual(sent_status, 200)
        resp_json = json.loads(handler.wfile.getvalue().decode("utf-8"))
        self.assertTrue(resp_json["success"])
        compressed_b64 = resp_json["compressed_base64"]
        self.assertIsNotNone(compressed_b64)

        # 2. Test POST /api/decompress
        handler.wfile = BytesIO()
        handler.path = "/api/decompress"
        req_decomp = json.dumps({"compressed_base64": compressed_b64}).encode("utf-8")
        handler.rfile = BytesIO(req_decomp)
        handler.headers["Content-Length"] = str(len(req_decomp))

        handler.do_POST()
        self.assertEqual(sent_status, 200)
        decomp_resp = json.loads(handler.wfile.getvalue().decode("utf-8"))
        self.assertTrue(decomp_resp["success"])
        self.assertEqual(decomp_resp["text"], raw_text)


if __name__ == "__main__":
    unittest.main()
