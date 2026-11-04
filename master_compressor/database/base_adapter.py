"""
Base interface for compressed database storage adapters.
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Tuple


class BaseDatabaseAdapter(ABC):
    """Abstract interface for database engines supporting transparent compression."""

    @abstractmethod
    def store(self, key: str, value: Any, metadata: Optional[Dict[str, Any]] = None) -> int:
        """Store compressed payload. Returns stored compressed byte length."""
        pass

    @abstractmethod
    def retrieve(self, key: str) -> Any:
        """Retrieve and decompress payload."""
        pass

    @abstractmethod
    def delete(self, key: str) -> bool:
        """Delete stored record."""
        pass

    @abstractmethod
    def get_stats(self) -> Dict[str, Any]:
        """Return storage usage and compression savings statistics."""
        pass
