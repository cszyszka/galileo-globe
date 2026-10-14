from datetime import UTC, datetime
from pathlib import Path

import pytest

from data_refresh.tle import tle_checksum_ok, validate_tle
from data_refresh.validation import DataError

# Four Galileo satellites with epochs on 1–2 October 2026.
TLE = (Path(__file__).parent.parent / "src/lib/__fixtures__/galileo.tle").read_text("utf-8")
NOW = datetime(2026, 10, 3, tzinfo=UTC)


def lines() -> list[str]:
    return [line for line in TLE.split("\n") if line]


def with_checksum(line: str) -> str:
    """Recomputes a TLE line's checksum, so a test can change a field and keep the line valid."""
    total = sum(int(c) if c.isdigit() else 1 if c == "-" else 0 for c in line[:68])
    return line[:68] + str(total % 10)


def test_checksum_accepts_real_lines_and_rejects_changes() -> None:
    _, l1, l2 = lines()[:3]
    assert tle_checksum_ok(l1)
    assert tle_checksum_ok(l2)
    assert not tle_checksum_ok(l1[:20] + "9" + l1[21:])
    assert not tle_checksum_ok(l1[:60])


def test_counts_the_satellites_in_a_good_file() -> None:
    result = validate_tle(TLE, now=NOW)
    assert (result.count, result.warnings) == (4, [])


def test_rejects_text_that_is_not_triplets() -> None:
    with pytest.raises(DataError, match="triplets"):
        validate_tle("\n".join(lines()[:5]), now=NOW)


def test_rejects_a_malformed_line() -> None:
    ls = lines()
    ls[1] = "X" + ls[1][1:]
    with pytest.raises(DataError, match="Malformed"):
        validate_tle("\n".join(ls), now=NOW)


def test_rejects_a_bad_checksum() -> None:
    ls = lines()
    ls[2] = ls[2][:10] + ("2" if ls[2][10] == "1" else "1") + ls[2][11:]
    with pytest.raises(DataError, match="checksum"):
        validate_tle("\n".join(ls), now=NOW)


def test_rejects_different_catalog_numbers() -> None:
    ls = lines()
    ls[2] = with_checksum(ls[2][:2] + "99999" + ls[2][7:])
    with pytest.raises(DataError, match="catalog numbers differ"):
        validate_tle("\n".join(ls), now=NOW)


def test_rejects_a_duplicate_satellite() -> None:
    ls = lines()
    with pytest.raises(DataError, match="Duplicate"):
        validate_tle("\n".join([*ls, *ls[:3]]), now=NOW)


def test_enforces_the_minimum_count() -> None:
    with pytest.raises(DataError, match="expected at least 20"):
        validate_tle(TLE, minimum=20, now=NOW)


def test_rejects_a_big_drop_unless_accepted() -> None:
    with pytest.raises(DataError, match="--accept-drop"):
        validate_tle(TLE, previous=32, now=NOW)
    assert validate_tle(TLE, previous=32, accept_drop=True, now=NOW).count == 4
    assert validate_tle(TLE, previous=5, now=NOW).count == 4


def test_warns_when_even_the_newest_element_set_is_old() -> None:
    later = datetime(2026, 10, 20, tzinfo=UTC)
    assert validate_tle(TLE, now=later).warnings == ["Newest element set is from 2026-10-02"]
