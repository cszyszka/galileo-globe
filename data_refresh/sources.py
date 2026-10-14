"""Orbital-element sources, shared with the app through src/lib/sources.json."""

import json
from pathlib import Path

from .types import TleSource

ROOT = Path(__file__).resolve().parent.parent
TLE_SOURCES: dict[str, TleSource] = json.loads((ROOT / "src/lib/sources.json").read_text("utf-8"))
