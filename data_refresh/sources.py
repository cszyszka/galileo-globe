"""Orbital-element sources, shared with the app through src/lib/sources.json."""

import json
from pathlib import Path

from .types import OrbitSource

ROOT = Path(__file__).resolve().parent.parent
ORBIT_SOURCES: dict[str, OrbitSource] = json.loads((ROOT / "src/lib/sources.json").read_text("utf-8"))
