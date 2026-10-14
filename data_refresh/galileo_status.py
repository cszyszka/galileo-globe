"""Fetches the official Galileo per-satellite status from the European GNSS Service Centre.

The GSC page doesn't send CORS headers, so this runs server-side, not in the browser.
"""

import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup, Tag

from .validation import DataError, Validated, check_count

GSC_URL = "https://www.gsc-europa.eu/system-service-status/constellation-information"
USER_AGENT = "globe-visualization (Galileo status viewer)"

_SAT_NAME = re.compile(r"GSAT\d{4}")
_SVID = re.compile(r"E\d{2}")
_KNOWN_STATUS = ("USABLE", "NOT USABLE", "NOT AVAILABLE", "TESTING", "UNDER COMMISSIONING")


def _cell_text(cell: Tag) -> str:
    return re.sub(r"\s+", " ", cell.get_text(" ")).strip()


def safe_gsc_url(href: str) -> str | None:
    """Notice links come from scraped HTML and end up as link targets in the page, so only https
    links on the GSC site are kept (never javascript: or other schemes)."""
    try:
        url = urljoin(GSC_URL, href.replace("&amp;", "&"))
        parts = urlsplit(url)
        host = parts.hostname or ""
    except ValueError:
        return None
    on_gsc = host == "gsc-europa.eu" or host.endswith(".gsc-europa.eu")
    return url if parts.scheme == "https" and on_gsc else None


def parse_galileo_status(html: str) -> dict[str, dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table.table-striped")
    if table is None:
        raise DataError("GSC status table not found")
    body = table.find("tbody") or table
    assert isinstance(body, Tag)

    satellites: dict[str, dict[str, Any]] = {}
    for row in body.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 4:
            continue
        texts = [_cell_text(c) for c in cells] + [""] * 7
        name, svid, clock, status, nagu, nagu_type, nagu_subject = texts[:7]
        if not _SAT_NAME.fullmatch(name):
            continue
        link = cells[4].find("a", href=True) if len(cells) > 4 else None
        nagu_url = safe_gsc_url(str(link["href"])) if isinstance(link, Tag) else None
        satellites[name] = {
            "svid": svid,
            "clock": clock,
            "status": status.upper(),
            "nagu": {"id": nagu, "type": nagu_type or None, "subject": nagu_subject or None, "url": nagu_url}
            if nagu
            else None,
        }
    if not satellites:
        raise DataError("No satellites parsed from GSC status table")
    return satellites


def fetch_galileo_status() -> dict[str, Any]:
    res = httpx.get(GSC_URL, headers={"user-agent": USER_AGENT}, follow_redirects=True, timeout=30)
    if not res.is_success:
        raise DataError(f"GSC responded {res.status_code}")
    fetched_at = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return {"source": GSC_URL, "fetchedAt": fetched_at, "satellites": parse_galileo_status(res.text)}


def validate_galileo_status(
    data: dict[str, Any], *, minimum: int = 0, previous: int = 0, accept_drop: bool = False
) -> Validated:
    entries: list[tuple[str, dict[str, Any]]] = list((data.get("satellites") or {}).items())
    for name, sat in entries:
        if not _SAT_NAME.fullmatch(name):
            raise DataError(f'Unexpected satellite name "{name}"')
        if not _SVID.fullmatch(sat.get("svid") or ""):
            raise DataError(f'Unexpected SV ID "{sat.get("svid")}" for {name}')
        if not sat.get("status"):
            raise DataError(f"Missing status for {name}")
    check_count(len(entries), minimum=minimum, previous=previous, accept_drop=accept_drop)

    warnings: list[str] = []
    odd = [f"{name}: {sat['status']}" for name, sat in entries if sat["status"] not in _KNOWN_STATUS]
    if odd:
        warnings.append(f"Unrecognised status values ({', '.join(odd)})")
    return Validated(len(entries), warnings)
