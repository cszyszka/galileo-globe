"""Fetching and validating CelesTrak orbit mean-elements messages (OMM, JSON format)."""

import json
import math
import re
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sgp4.api import Satrec
from sgp4.omm import initialize

from .validation import DataError, Validated, check_count

# Warn when even the newest element set is this old: the source has probably stopped updating.
STALE_EPOCH_DAYS = 7

# Numeric fields and their allowed range (inclusive), as SGP4 and the app need them.
_RANGES: dict[str, tuple[float, float]] = {
    "MEAN_MOTION": (1e-6, 20),  # revolutions per day
    "ECCENTRICITY": (0, 1 - 1e-9),
    "INCLINATION": (0, 180),
    "RA_OF_ASC_NODE": (0, 360),
    "ARG_OF_PERICENTER": (0, 360),
    "MEAN_ANOMALY": (0, 360),
}
# Numeric fields with no range check.
_UNBOUNDED = ("BSTAR", "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT", "ELEMENT_SET_NO", "REV_AT_EPOCH")

Record = dict[str, Any]


def fetch_omm(url: str, *, user_agent: str) -> list[Record]:
    res = httpx.get(url, headers={"user-agent": user_agent}, follow_redirects=True, timeout=30)
    # CelesTrak answers an empty query with a plain-text message (and a 404 for JSON), not an empty list.
    if re.search(r"No GP data found", res.text, re.IGNORECASE):
        return []
    if not res.is_success:
        raise DataError(f"CelesTrak responded {res.status_code}")
    try:
        data = res.json()
    except ValueError as err:
        raise DataError("Response is not valid JSON") from err
    if not isinstance(data, list) or not all(isinstance(r, dict) for r in data):
        raise DataError("Response is not a list of OMM records")
    return data


def dump_omm(records: list[Record]) -> str:
    return json.dumps(records, indent=2, ensure_ascii=False) + "\n"


def _number(record: Record, field: str, label: str) -> float:
    value = record.get(field)
    # bool is an int in Python, but never a valid element.
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        raise DataError(f'Missing or non-numeric {field} for "{label}"')
    return float(value)


def _epoch(record: Record, label: str) -> datetime:
    value = record.get("EPOCH")
    try:
        # CelesTrak gives UTC without a zone suffix.
        epoch = datetime.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        epoch = None
    if epoch is None:
        raise DataError(f'Missing or malformed EPOCH for "{label}"')
    return epoch if epoch.tzinfo else epoch.replace(tzinfo=UTC)


def validate_omm(
    records: list[Record],
    *,
    minimum: int = 0,
    previous: int = 0,
    accept_drop: bool = False,
    now: datetime | None = None,
) -> Validated:
    """Validates a list of CelesTrak OMM records."""
    now = now or datetime.now(UTC)
    ids: set[int] = set()
    newest: datetime | None = None
    for record in records:
        name = record.get("OBJECT_NAME")
        if not isinstance(name, str) or not name.strip():
            raise DataError("Record without OBJECT_NAME")
        label = name.strip()
        if not isinstance(record.get("OBJECT_ID"), str):
            raise DataError(f'Missing OBJECT_ID for "{label}"')
        for field, (low, high) in _RANGES.items():
            if not low <= _number(record, field, label) <= high:
                raise DataError(f'{field} out of range for "{label}"')
        for field in _UNBOUNDED:
            _number(record, field, label)
        if _number(record, "EPHEMERIS_TYPE", label) != 0:
            raise DataError(f'Unsupported EPHEMERIS_TYPE for "{label}"')
        catalog = _number(record, "NORAD_CAT_ID", label)
        if catalog != int(catalog) or catalog <= 0:
            raise DataError(f'Invalid NORAD_CAT_ID for "{label}"')
        epoch = _epoch(record, label)

        satrec = Satrec()
        try:
            initialize(satrec, record)
        except (KeyError, ValueError, TypeError) as err:
            raise DataError(f'SGP4 rejects OMM for "{label}" ({err})') from err
        if satrec.error:
            raise DataError(f'SGP4 rejects OMM for "{label}" (error {satrec.error})')
        if int(catalog) in ids:
            raise DataError(f"Duplicate satellite {int(catalog)}")
        ids.add(int(catalog))
        if newest is None or epoch > newest:
            newest = epoch

    check_count(len(ids), minimum=minimum, previous=previous, accept_drop=accept_drop)
    warnings: list[str] = []
    if newest and (now - newest) > timedelta(days=STALE_EPOCH_DAYS):
        warnings.append(f"Newest element set is from {newest.date().isoformat()}")
    return Validated(len(ids), warnings)
