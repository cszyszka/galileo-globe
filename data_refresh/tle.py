"""Fetching and validating CelesTrak three-line element sets."""

import re
from datetime import UTC, datetime, timedelta

import httpx
from sgp4.api import Satrec

from .validation import DataError, Validated, check_count

# Warn when even the newest element set is this old: the source has probably stopped updating.
STALE_EPOCH_DAYS = 7


def fetch_tle(url: str, *, user_agent: str) -> str:
    res = httpx.get(url, headers={"user-agent": user_agent}, follow_redirects=True, timeout=30)
    if not res.is_success:
        raise DataError(f"CelesTrak responded {res.status_code}")
    text = res.text
    # CelesTrak answers an empty query with a plain-text message rather than an error.
    if re.search(r"No GP data found", text, re.IGNORECASE):
        return ""
    if not re.search(r"^1 \d{5}", text, re.MULTILINE):
        raise DataError("Response contains no TLEs")
    return text.strip() + "\n"


def tle_checksum_ok(line: str) -> bool:
    """TLE line checksum: sum of digits, minus signs count as 1, modulo 10."""
    if len(line) < 69:
        return False
    total = 0
    for ch in line[:68]:
        if "0" <= ch <= "9":
            total += int(ch)
        elif ch == "-":
            total += 1
    return line[68].isascii() and line[68].isdigit() and total % 10 == int(line[68])


def _epoch_of(epoch_year: int, epoch_days: float) -> datetime:
    year = 2000 + epoch_year if epoch_year < 57 else 1900 + epoch_year
    return datetime(year, 1, 1, tzinfo=UTC) + timedelta(days=epoch_days - 1)


def validate_tle(
    text: str,
    *,
    minimum: int = 0,
    previous: int = 0,
    accept_drop: bool = False,
    now: datetime | None = None,
) -> Validated:
    """Validates CelesTrak 3-line TLE text."""
    now = now or datetime.now(UTC)
    lines = [line.rstrip() for line in re.split(r"\r?\n", text) if line.rstrip()]
    if len(lines) % 3 != 0:
        raise DataError(f"Expected name/line1/line2 triplets, got {len(lines)} lines")

    ids: set[int] = set()
    newest: datetime | None = None
    for i in range(0, len(lines), 3):
        name, l1, l2 = lines[i : i + 3]
        label = name.strip()
        if not l1.startswith("1 ") or not l2.startswith("2 "):
            raise DataError(f'Malformed TLE for "{label}"')
        if not tle_checksum_ok(l1) or not tle_checksum_ok(l2):
            raise DataError(f'Bad checksum in TLE for "{label}"')
        if l1[2:7] != l2[2:7]:
            raise DataError(f'Line 1/2 catalog numbers differ for "{label}"')
        try:
            satrec = Satrec.twoline2rv(l1, l2)
        except ValueError as err:
            raise DataError(f'SGP4 rejects TLE for "{label}" ({err})') from err
        if satrec.error:
            raise DataError(f'SGP4 rejects TLE for "{label}" (error {satrec.error})')
        if satrec.satnum in ids:
            raise DataError(f"Duplicate satellite {satrec.satnum}")
        ids.add(satrec.satnum)
        epoch = _epoch_of(satrec.epochyr, satrec.epochdays)
        if newest is None or epoch > newest:
            newest = epoch

    check_count(len(ids), minimum=minimum, previous=previous, accept_drop=accept_drop)
    warnings: list[str] = []
    if newest and (now - newest) > timedelta(days=STALE_EPOCH_DAYS):
        warnings.append(f"Newest element set is from {newest.date().isoformat()}")
    return Validated(len(ids), warnings)
