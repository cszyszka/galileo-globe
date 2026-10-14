"""Downloads everything the app needs at runtime into public/data/, so the published site
serves it as static files and visitors never hit CelesTrak or the GSC directly.

    pixi run refresh             # skips sources fetched in the last hour
    pixi run refresh --force     # fetch everything now
    pixi run refresh --if-stale  # only sources older than 12 hours (used by `npm run dev`, so the
                                 # committed files, which CI refreshes, normally stay untouched)
    pixi run refresh --accept-drop  # accept a big drop in satellite count (see validation.py)

Output (public/data/):
    tle-galileo.txt, tle-leopnt.txt   orbital elements from CelesTrak
    galileo-status.json               per-satellite service status from the GSC
    meta.json                         when each file was fetched, and any errors

Each source is independent: if a download fails or doesn't pass validation, its previous file
is left in place, the error is recorded in meta.json, and the exit code is non-zero so a
scheduled job reports it.
"""

import argparse
import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

from .galileo_status import GSC_URL, fetch_galileo_status, validate_galileo_status
from .sources import ROOT, TLE_SOURCES
from .tle import fetch_tle, validate_tle
from .types import Meta, SourceMeta
from .validation import DataError, Validated

OUT_DIR = ROOT / "public" / "data"
META_FILE = "meta.json"
# CelesTrak asks clients not to download data more often than it changes (a few times a day).
MIN_INTERVAL = timedelta(hours=1)
# With --if-stale: the age at which the app starts warning that data is out of date.
STALE_INTERVAL = timedelta(hours=12)
USER_AGENT = "globe-visualization data refresh (Galileo / LEO-PNT viewer)"

# Fewer satellites than this means the source is broken (Galileo has ~30 in orbit).
# LEO-PNT may legitimately be empty, e.g. if CelesTrak renames the objects.
MIN_COUNT = {"galileo": 20, "leopnt": 0}


@dataclass
class Result:
    contents: str
    validated: Validated


@dataclass
class Job:
    key: str
    file: str
    url: str
    run: Callable[[int, bool], Result]  # (previous count, accept_drop)


def _now_iso(now: datetime) -> str:
    return now.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _tle_job(key: str, url: str, file: str) -> Job:
    def run(previous: int, accept_drop: bool) -> Result:
        text = fetch_tle(url, user_agent=USER_AGENT)
        validated = validate_tle(text, minimum=MIN_COUNT[key], previous=previous, accept_drop=accept_drop)
        return Result(text, validated)

    return Job(f"tle-{key}", file, url, run)


def _status_job() -> Job:
    def run(previous: int, accept_drop: bool) -> Result:
        data = fetch_galileo_status()
        validated = validate_galileo_status(
            data, minimum=MIN_COUNT["galileo"], previous=previous, accept_drop=accept_drop
        )
        return Result(json.dumps(data, indent=2, ensure_ascii=False) + "\n", validated)

    return Job("galileo-status", "galileo-status.json", GSC_URL, run)


def build_jobs() -> list[Job]:
    return [*(_tle_job(key, src["url"], src["file"]) for key, src in TLE_SOURCES.items()), _status_job()]


def read_meta(out_dir: Path) -> Meta:
    try:
        meta: Meta = json.loads((out_dir / META_FILE).read_text("utf-8"))
        meta.setdefault("sources", {})
        return meta
    except (OSError, ValueError):
        return {"sources": {}}


def write_atomic(out_dir: Path, name: str, contents: str) -> None:
    """Write via a temp file so a crash never leaves a half-written file behind."""
    tmp = out_dir / f".{name}.tmp"
    tmp.write_text(contents, "utf-8")
    os.replace(tmp, out_dir / name)


def refresh(
    jobs: list[Job],
    out_dir: Path,
    *,
    force: bool = False,
    accept_drop: bool = False,
    if_stale: bool = False,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> int:
    """Runs the jobs; returns the process exit code."""
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = read_meta(out_dir)
    now = clock()
    min_interval = STALE_INTERVAL if if_stale else MIN_INTERVAL
    failures = 0
    ran = 0

    for job in jobs:
        prev: SourceMeta | None = meta["sources"].get(job.key)
        fetched_at = prev.get("fetchedAt") if prev else None
        age = now - datetime.fromisoformat(fetched_at) if fetched_at else None
        if not force and not (prev and prev.get("error")) and age is not None and age < min_interval:
            print(f"skip  {job.file:<20} fetched {int(age.total_seconds() / 60 + 0.5)} min ago")
            continue
        ran += 1
        try:
            result = job.run(prev.get("count", 0) if prev else 0, accept_drop)
            write_atomic(out_dir, job.file, result.contents)
            entry: SourceMeta = {
                "file": job.file,
                "url": job.url,
                "fetchedAt": _now_iso(clock()),
                "count": result.validated.count,
            }
            if result.validated.warnings:
                entry["warnings"] = result.validated.warnings
            meta["sources"][job.key] = entry
            print(f"ok    {job.file:<20} {result.validated.count} satellites")
            for warning in result.validated.warnings:
                print(f"      warning: {warning}", file=sys.stderr)
        except (DataError, OSError, ValueError, httpx.HTTPError) as err:
            failures += 1
            # Keep the last good file and its timestamp; just record what went wrong.
            failed: SourceMeta = {
                **(prev or {}),  # type: ignore[typeddict-item]
                "file": job.file,
                "url": job.url,
                "error": str(err),
                "failedAt": _now_iso(clock()),
            }
            meta["sources"][job.key] = failed
            kept = " (keeping previous file)" if prev and prev.get("fetchedAt") else ""
            print(f"FAIL  {job.file:<20} {err}{kept}", file=sys.stderr)

    # Nothing fetched: leave meta.json as it is, so a skipped run changes no files.
    if not ran:
        return 0
    meta["generatedAt"] = _now_iso(now)
    write_atomic(out_dir, META_FILE, json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    return 1 if failures else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="data_refresh", description="Refresh the data in public/data/.")
    parser.add_argument("--force", action="store_true", help="fetch everything now")
    parser.add_argument("--if-stale", action="store_true", help="only sources older than 12 hours")
    parser.add_argument("--accept-drop", action="store_true", help="accept a big drop in satellite count")
    args = parser.parse_args(argv)
    return refresh(
        build_jobs(), OUT_DIR, force=args.force, accept_drop=args.accept_drop, if_stale=args.if_stale
    )
