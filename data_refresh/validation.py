"""Checks shared by the TLE and GSC status validators."""

from dataclasses import dataclass, field

# Reject a download that suddenly has far fewer satellites than the last good one: that's far
# more likely a broken source than satellites disappearing. Override with --accept-drop.
MAX_DROP_RATIO = 0.75


class DataError(Exception):
    """A download or sanity check failed; the previous file is kept."""


@dataclass
class Validated:
    count: int
    warnings: list[str] = field(default_factory=list)


def check_count(count: int, *, minimum: int = 0, previous: int = 0, accept_drop: bool = False) -> None:
    if count < minimum:
        raise DataError(f"Only {count} satellites (expected at least {minimum})")
    # ceil(previous * ratio) in integer arithmetic: ratio is 3/4.
    if not accept_drop and previous > 0 and count < -(-previous * 3 // 4):
        raise DataError(
            f"Only {count} satellites, down from {previous} — rerun with --accept-drop if this is real"
        )
