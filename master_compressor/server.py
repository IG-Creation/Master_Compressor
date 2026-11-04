"""
Lightweight REST API microservice for Master Compressor.
Built with Python standard library http.server for zero external dependencies.
"""

from __future__ import annotations
import base64
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Any, Dict
from urllib.parse import urlparse

from .core import MasterCompressor
from .algorithms.base import AlgorithmType


class MasterCompressorHandler(BaseHTTPRequestHandler):
    compressor = MasterCompressor()

    def _send_json(self, status_code: int, data: Dict[str, Any]) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in ["/api/stats", "/api/health", "/"]:
            self._send_json(200, {
                "status": "healthy",
                "service": "Master Compressor API",
                "version": "1.0.0",
                "supported_algorithms": [
                    AlgorithmType.ZLIB.value,
                    AlgorithmType.GZIP.value,
                    AlgorithmType.BZ2.value,
                    AlgorithmType.LZMA.value,
                    AlgorithmType.RLE_DELTA.value,
                ],
                "envelope_magic": "MC01"
            })
        else:
            self._send_json(404, {"error": "Not Found"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len)

        try:
            req_data = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            self._send_json(400, {"error": "Invalid JSON body"})
            return

        if parsed.path == "/api/compress":
            raw_b64 = req_data.get("data")
            raw_text = req_data.get("text")
            algo = req_data.get("algorithm")

            if raw_b64 is not None:
                payload = base64.b64decode(raw_b64)
            elif raw_text is not None:
                payload = raw_text.encode("utf-8")
            else:
                self._send_json(400, {"error": "Missing 'data' (base64) or 'text' in request body"})
                return

            res = self.compressor.compress(payload, algorithm=algo)
            self._send_json(200, {
                "success": True,
                "compressed_base64": base64.b64encode(res.data).decode("ascii"),
                "original_size": res.original_size,
                "compressed_size": res.compressed_size,
                "savings_percentage": res.savings_ratio,
                "algorithm": res.algorithm,
                "checksum": res.checksum,
                "duration_ms": res.duration_ms
            })

        elif parsed.path == "/api/decompress":
            comp_b64 = req_data.get("compressed_base64")
            if not comp_b64:
                self._send_json(400, {"error": "Missing 'compressed_base64' in request body"})
                return

            try:
                comp_data = base64.b64decode(comp_b64)
                decomp = self.compressor.decompress(comp_data)
                # Try UTF-8 decode
                is_text = True
                try:
                    text_out = decomp.decode("utf-8")
                except UnicodeDecodeError:
                    is_text = False
                    text_out = None

                self._send_json(200, {
                    "success": True,
                    "decompressed_base64": base64.b64encode(decomp).decode("ascii"),
                    "text": text_out,
                    "is_text": is_text,
                    "size_bytes": len(decomp)
                })
            except Exception as e:
                self._send_json(400, {"error": f"Decompression failed: {str(e)}"})
        else:
            self._send_json(404, {"error": "Not Found"})


def start_server(port: int = 8080) -> None:
    server = HTTPServer(("0.0.0.0", port), MasterCompressorHandler)
    print(f"Master Compressor API server listening on http://localhost:{port}")
    server.serve_forever()
