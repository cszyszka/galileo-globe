import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from data_refresh.refresh import Job, Result, refresh
from data_refresh.validation import DataError, Validated

NOW = datetime(2026, 10, 14, 12, 0, tzinfo=UTC)


def ok_job(key: str = "tle-x", count: int = 3) -> Job:
    return Job(
        key, f"{key}.txt", "https://example.test/x", lambda _prev, _drop: Result("data\n", Validated(count))
    )


def failing_job(key: str = "tle-x") -> Job:
    def run(_prev: int, _drop: bool) -> Result:
        raise DataError("boom")

    return Job(key, f"{key}.txt", "https://example.test/x", run)


def meta_of(out: Path) -> Any:
    return json.loads((out / "meta.json").read_text("utf-8"))


def test_writes_the_file_and_meta(tmp_path: Path) -> None:
    assert refresh([ok_job()], tmp_path, clock=lambda: NOW) == 0
    assert (tmp_path / "tle-x.txt").read_text() == "data\n"
    source = meta_of(tmp_path)["sources"]["tle-x"]
    assert source["count"] == 3
    assert meta_of(tmp_path)["generatedAt"] == "2026-10-14T12:00:00.000Z"


def test_a_failure_keeps_the_previous_file_and_exits_non_zero(tmp_path: Path) -> None:
    refresh([ok_job()], tmp_path, clock=lambda: NOW)
    assert refresh([failing_job()], tmp_path, force=True, clock=lambda: NOW) == 1
    assert (tmp_path / "tle-x.txt").read_text() == "data\n"
    source = meta_of(tmp_path)["sources"]["tle-x"]
    assert source["error"] == "boom"
    assert "fetchedAt" in source


def test_a_recent_fetch_is_skipped_and_changes_nothing(tmp_path: Path) -> None:
    refresh([ok_job()], tmp_path, clock=lambda: NOW)
    before = (tmp_path / "meta.json").read_text()
    assert refresh([failing_job()], tmp_path, clock=lambda: NOW + timedelta(minutes=5)) == 0
    assert (tmp_path / "meta.json").read_text() == before


def test_if_stale_waits_twelve_hours(tmp_path: Path) -> None:
    refresh([ok_job()], tmp_path, clock=lambda: NOW)
    meta = meta_of(tmp_path)
    meta["sources"]["tle-x"]["fetchedAt"] = (NOW - timedelta(hours=5)).isoformat()
    (tmp_path / "meta.json").write_text(json.dumps(meta))
    assert refresh([failing_job()], tmp_path, if_stale=True, clock=lambda: NOW) == 0
    meta["sources"]["tle-x"]["fetchedAt"] = (NOW - timedelta(hours=13)).isoformat()
    (tmp_path / "meta.json").write_text(json.dumps(meta))
    assert refresh([failing_job()], tmp_path, if_stale=True, clock=lambda: NOW) == 1


def test_forgets_sources_that_no_longer_exist(tmp_path: Path) -> None:
    refresh([ok_job("tle-old")], tmp_path, clock=lambda: NOW)
    refresh([ok_job("omm-new")], tmp_path, clock=lambda: NOW)
    assert list(meta_of(tmp_path)["sources"]) == ["omm-new"]
