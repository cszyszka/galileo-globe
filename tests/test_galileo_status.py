from typing import Any

import pytest

from data_refresh.galileo_status import parse_galileo_status, safe_gsc_url, validate_galileo_status
from data_refresh.validation import DataError


def row(href: str) -> str:
    return f"""<table class="table table-striped"><tbody>
  <tr><td>GSAT0101</td><td>E11</td><td>PHM</td><td>USABLE</td>
      <td><a href="{href}">2026001</a></td><td>GENERAL</td><td>Info</td></tr>
</tbody></table>"""


def usable(svid: str) -> dict[str, Any]:
    return {"svid": svid, "clock": "PHM", "status": "USABLE", "nagu": None}


def status(satellites: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": "https://www.gsc-europa.eu/",
        "fetchedAt": "2026-10-03T00:00:00.000Z",
        "satellites": satellites,
    }


def test_safe_url_keeps_https_gsc_links_resolving_relative_ones() -> None:
    assert (
        safe_gsc_url("/notice-advisory-to-galileo-users-nagu-2026001")
        == "https://www.gsc-europa.eu/notice-advisory-to-galileo-users-nagu-2026001"
    )
    assert safe_gsc_url("https://www.gsc-europa.eu/a?x=1&amp;y=2") == "https://www.gsc-europa.eu/a?x=1&y=2"


@pytest.mark.parametrize(
    "href",
    [
        "javascript:alert(1)",
        "data:text/html,hi",
        "http://www.gsc-europa.eu/a",
        "https://evil.example/a",
        "https://gsc-europa.eu.evil.example/a",
    ],
)
def test_safe_url_drops_other_schemes_and_hosts(href: str) -> None:
    assert safe_gsc_url(href) is None


def test_parse_keeps_a_safe_notice_link() -> None:
    sats = parse_galileo_status(row("/nagu/2026001"))
    assert sats["GSAT0101"]["nagu"]["url"] == "https://www.gsc-europa.eu/nagu/2026001"


def test_parse_drops_an_unsafe_link_but_keeps_the_notice() -> None:
    nagu = parse_galileo_status(row("javascript:alert(1)"))["GSAT0101"]["nagu"]
    assert nagu["id"] == "2026001"
    assert nagu["url"] is None


def test_parse_fails_without_a_table_or_satellites() -> None:
    with pytest.raises(DataError, match="table not found"):
        parse_galileo_status("<p>nothing</p>")
    with pytest.raises(DataError, match="No satellites"):
        parse_galileo_status('<table class="table-striped"><tr><td>x</td></tr></table>')


def test_validate_counts_good_data() -> None:
    result = validate_galileo_status(status({"GSAT0101": usable("E11"), "GSAT0102": usable("E12")}))
    assert (result.count, result.warnings) == (2, [])


def test_validate_rejects_unexpected_names_svids_and_missing_status() -> None:
    with pytest.raises(DataError, match="satellite name"):
        validate_galileo_status(status({"GSAT 101": usable("E11")}))
    with pytest.raises(DataError, match="SV ID"):
        validate_galileo_status(status({"GSAT0101": usable("11")}))
    with pytest.raises(DataError, match="Missing status"):
        validate_galileo_status(status({"GSAT0101": {"svid": "E11"}}))


def test_validate_treats_a_missing_table_as_zero_satellites() -> None:
    with pytest.raises(DataError, match="Only 0 satellites"):
        validate_galileo_status({}, minimum=1)


def test_validate_rejects_a_big_drop() -> None:
    with pytest.raises(DataError, match="down from 28"):
        validate_galileo_status(status({"GSAT0101": usable("E11")}), previous=28)


def test_validate_warns_about_unknown_status_values() -> None:
    sat = {**usable("E11"), "status": "RETIRED"}
    assert validate_galileo_status(status({"GSAT0101": sat})).warnings == [
        "Unrecognised status values (GSAT0101: RETIRED)"
    ]
