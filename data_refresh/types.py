from typing import NotRequired, TypedDict


class OrbitSource(TypedDict):
    label: str
    url: str
    file: str


class Nagu(TypedDict):
    id: str
    type: str | None
    subject: str | None
    url: str | None


class SatelliteStatus(TypedDict):
    svid: str
    clock: str
    status: str
    nagu: Nagu | None


class GalileoStatus(TypedDict):
    source: str
    fetchedAt: str
    satellites: dict[str, SatelliteStatus]


class SourceMeta(TypedDict):
    file: str
    url: str
    fetchedAt: NotRequired[str]
    count: NotRequired[int]
    warnings: NotRequired[list[str]]
    error: NotRequired[str]
    failedAt: NotRequired[str]


class Meta(TypedDict):
    sources: dict[str, SourceMeta]
    generatedAt: NotRequired[str]
