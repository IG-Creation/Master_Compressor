"""
Compressed Key-Value Store with document indexing and metadata support.
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional
from .sqlite_adapter import SQLiteCompressedStore
from ..core import MasterCompressor


class CompressedKVStore:
    """
    User-friendly Key-Value Store that compresses everything under the hood.
    Can be used as an in-memory cache, persistent cache, or low-storage database.
    """

    def __init__(self, storage_path: str = ":memory:"):
        self.store = SQLiteCompressedStore(db_path=storage_path)

    def set(self, key: str, value: Any, metadata: Optional[Dict[str, Any]] = None) -> int:
        """Save a key-value pair with automatic compression."""
        return self.store.store(key, value, metadata)

    def get(self, key: str, default: Any = None) -> Any:
        """Retrieve a value by key with automatic decompression."""
        val = self.store.retrieve(key)
        return default if val is None else val

    def exists(self, key: str) -> bool:
        """Check if key exists."""
        return self.store.retrieve(key) is not None

    def delete(self, key: str) -> bool:
        """Delete key."""
        return self.store.delete(key)

    def keys(self) -> List[str]:
        """Return all keys."""
        return self.store.list_keys()

    def stats(self) -> Dict[str, Any]:
        """Return compression and storage savings statistics."""
        return self.store.get_stats()

    def close(self) -> None:
        """Close store."""
        self.store.close()
