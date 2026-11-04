"""
SQLite database storage adapter with transparent compression,
UDF registration, and storage analytics.
"""

from __future__ import annotations
import json
import os
import sqlite3
import time
from typing import Any, Dict, List, Optional, Tuple, Union

from ..core import MasterCompressor, TYPE_JSON, TYPE_TEXT, TYPE_BINARY
from .base_adapter import BaseDatabaseAdapter


class SQLiteCompressedStore(BaseDatabaseAdapter):
    """
    High-performance SQLite database storage engine with transparent payload compression.
    Payloads are compressed before writing to disk, reducing database storage size by 60% - 90%.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        table_name: str = "mc_records",
        compressor: Optional[MasterCompressor] = None
    ):
        self.db_path = db_path
        self.table_name = table_name
        self.compressor = compressor or MasterCompressor()
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self._register_functions()
        self._init_db()

    def _register_functions(self) -> None:
        """Register custom SQLite UDFs: mc_compress and mc_decompress."""
        def _sql_compress(data: Any) -> Optional[bytes]:
            if data is None:
                return None
            if isinstance(data, str):
                b = data.encode("utf-8")
                res = self.compressor.compress(b, data_type=TYPE_TEXT)
            elif isinstance(data, (bytes, bytearray)):
                res = self.compressor.compress(bytes(data), data_type=TYPE_BINARY)
            else:
                b = json.dumps(data).encode("utf-8")
                res = self.compressor.compress(b, data_type=TYPE_JSON)
            return res.data

        def _sql_decompress(data: Optional[bytes]) -> Optional[str]:
            if data is None:
                return None
            try:
                raw = self.compressor.decompress(data)
                return raw.decode("utf-8", errors="replace")
            except Exception:
                return None

        self.conn.create_function("mc_compress", 1, _sql_compress)
        self.conn.create_function("mc_decompress", 1, _sql_decompress)

    def _init_db(self) -> None:
        """Create storage table and indexes."""
        cursor = self.conn.cursor()
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS {self.table_name} (
                id TEXT PRIMARY KEY,
                data_type TEXT NOT NULL,
                payload BLOB NOT NULL,
                original_size INTEGER NOT NULL,
                compressed_size INTEGER NOT NULL,
                algorithm TEXT NOT NULL,
                checksum TEXT NOT NULL,
                metadata TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
        """)
        cursor.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_{self.table_name}_type ON {self.table_name} (data_type);
        """)
        self.conn.commit()

    def store(
        self,
        key: str,
        value: Any,
        metadata: Optional[Dict[str, Any]] = None
    ) -> int:
        """
        Store any value (dict, list, string, bytes) compressed into SQLite.
        Returns the number of compressed bytes written.
        """
        now = time.time()
        meta_json = json.dumps(metadata or {})

        if isinstance(value, (dict, list)):
            data_type = "json"
            raw_bytes = json.dumps(value, separators=(",", ":")).encode("utf-8")
            res = self.compressor.compress(raw_bytes, data_type=TYPE_JSON)
        elif isinstance(value, str):
            data_type = "text"
            raw_bytes = value.encode("utf-8")
            res = self.compressor.compress(raw_bytes, data_type=TYPE_TEXT)
        elif isinstance(value, (bytes, bytearray)):
            data_type = "binary"
            raw_bytes = bytes(value)
            res = self.compressor.compress(raw_bytes, data_type=TYPE_BINARY)
        else:
            data_type = "json"
            raw_bytes = json.dumps(value).encode("utf-8")
            res = self.compressor.compress(raw_bytes, data_type=TYPE_JSON)

        cursor = self.conn.cursor()
        cursor.execute(f"""
            INSERT INTO {self.table_name}
            (id, data_type, payload, original_size, compressed_size, algorithm, checksum, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                data_type = excluded.data_type,
                payload = excluded.payload,
                original_size = excluded.original_size,
                compressed_size = excluded.compressed_size,
                algorithm = excluded.algorithm,
                checksum = excluded.checksum,
                metadata = excluded.metadata,
                updated_at = excluded.updated_at;
        """, (
            key,
            data_type,
            res.data,
            res.original_size,
            res.compressed_size,
            res.algorithm,
            res.checksum,
            meta_json,
            now,
            now
        ))
        self.conn.commit()
        return res.compressed_size

    def retrieve(self, key: str) -> Any:
        """
        Retrieve record by key, automatically decompressing the payload.
        Returns deserialized JSON object, str, or bytes according to original type.
        """
        cursor = self.conn.cursor()
        cursor.execute(f"""
            SELECT data_type, payload FROM {self.table_name} WHERE id = ?;
        """, (key,))
        row = cursor.fetchone()
        if not row:
            return None

        data_type = row["data_type"]
        raw = self.compressor.decompress(row["payload"])

        if data_type == "json":
            return json.loads(raw.decode("utf-8"))
        elif data_type == "text":
            return raw.decode("utf-8")
        else:
            return raw

    def delete(self, key: str) -> bool:
        """Delete record by key."""
        cursor = self.conn.cursor()
        cursor.execute(f"DELETE FROM {self.table_name} WHERE id = ?;", (key,))
        self.conn.commit()
        return cursor.rowcount > 0

    def list_keys(self) -> List[str]:
        """List all stored keys."""
        cursor = self.conn.cursor()
        cursor.execute(f"SELECT id FROM {self.table_name} ORDER BY id ASC;")
        return [r["id"] for r in cursor.fetchall()]

    def get_stats(self) -> Dict[str, Any]:
        """
        Compute total storage statistics, compression efficiency, and space saved.
        """
        cursor = self.conn.cursor()
        cursor.execute(f"""
            SELECT 
                COUNT(*) as count,
                TOTAL(original_size) as total_orig,
                TOTAL(compressed_size) as total_comp
            FROM {self.table_name};
        """)
        row = cursor.fetchone()
        count = row["count"]
        orig_bytes = int(row["total_orig"])
        comp_bytes = int(row["total_comp"])

        file_size = 0
        if self.db_path != ":memory:" and os.path.exists(self.db_path):
            file_size = os.path.getsize(self.db_path)

        saved_bytes = max(0, orig_bytes - comp_bytes)
        savings_pct = (saved_bytes / orig_bytes * 100.0) if orig_bytes > 0 else 0.0

        return {
            "record_count": count,
            "total_original_bytes": orig_bytes,
            "total_compressed_bytes": comp_bytes,
            "total_saved_bytes": saved_bytes,
            "savings_percentage": round(savings_pct, 2),
            "compression_ratio": round(comp_bytes / orig_bytes, 4) if orig_bytes > 0 else 1.0,
            "disk_file_size_bytes": file_size
        }

    def close(self) -> None:
        """Close database connection."""
        self.conn.close()
