import copy
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from data_refresh.omm import Record, dump_omm, validate_omm
from data_refresh.validation import DataError

# Four Galileo satellites with epochs on 1–2 October 2026.
FIXTURE = Path(__file__).parent.parent / "src/lib/__fixtures__/galileo.omm.json"
NOW = datetime(2026, 10, 3, tzinfo=UTC)


def records() -> list[Record]:
    data: list[Record] = json.loads(FIXTURE.read_text("utf-8"))
    return copy.deepcopy(data)


def with_field(field: str, value: Any, index: int = 0) -> list[Record]:
    recs = records()
    recs[index][field] = value
    return recs


def test_counts_the_satellites_in_a_good_file() -> None:
    result = validate_omm(records(), now=NOW)
    assert (result.count, result.warnings) == (4, [])


def test_accepts_an_empty_list_when_no_minimum() -> None:
    assert validate_omm([], now=NOW).count == 0


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("OBJECT_NAME", "", "OBJECT_NAME"),
        ("OBJECT_ID", None, "OBJECT_ID"),
        ("ECCENTRICITY", "0.1", "non-numeric ECCENTRICITY"),
        ("INCLINATION", float("nan"), "non-numeric INCLINATION"),
        ("ECCENTRICITY", 1.2, "ECCENTRICITY out of range"),
        ("INCLINATION", 200, "INCLINATION out of range"),
        ("MEAN_MOTION", 0, "MEAN_MOTION out of range"),
        ("EPHEMERIS_TYPE", 2, "EPHEMERIS_TYPE"),
        ("NORAD_CAT_ID", 12.5, "NORAD_CAT_ID"),
        ("EPOCH", "yesterday", "EPOCH"),
        ("EPOCH", None, "EPOCH"),
    ],
)
def test_rejects_a_bad_field(field: str, value: Any, message: str) -> None:
    with pytest.raises(DataError, match=message):
        validate_omm(with_field(field, value), now=NOW)


def test_rejects_a_missing_field() -> None:
    recs = records()
    del recs[1]["BSTAR"]
    with pytest.raises(DataError, match="BSTAR"):
        validate_omm(recs, now=NOW)


def test_rejects_a_duplicate_satellite() -> None:
    recs = records()
    with pytest.raises(DataError, match="Duplicate"):
        validate_omm([*recs, recs[0]], now=NOW)


def test_rejects_when_sgp4_cannot_initialise() -> None:
    # Missing CLASSIFICATION_TYPE is needed by SGP4's loader but not by our own checks.
    recs = records()
    del recs[0]["CLASSIFICATION_TYPE"]
    with pytest.raises(DataError, match="SGP4 rejects"):
        validate_omm(recs, now=NOW)


def test_enforces_the_minimum_count() -> None:
    with pytest.raises(DataError, match="expected at least 20"):
        validate_omm(records(), minimum=20, now=NOW)


def test_rejects_a_big_drop_unless_accepted() -> None:
    with pytest.raises(DataError, match="--accept-drop"):
        validate_omm(records(), previous=32, now=NOW)
    assert validate_omm(records(), previous=32, accept_drop=True, now=NOW).count == 4
    assert validate_omm(records(), previous=5, now=NOW).count == 4


def test_warns_when_even_the_newest_element_set_is_old() -> None:
    later = datetime(2026, 10, 20, tzinfo=UTC)
    assert validate_omm(records(), now=later).warnings == ["Newest element set is from 2026-10-02"]


def test_dump_round_trips() -> None:
    recs = records()
    text = dump_omm(recs)
    assert text.endswith("\n")
    assert json.loads(text) == recs
