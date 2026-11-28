from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from parfocal_api.problems import BadRequestError


class UnknownTimeZoneError(BadRequestError):
    code = "unknown-time-zone"
    title = "The time zone is not a known IANA time zone"


def zone_of(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError) as unknown:
        raise UnknownTimeZoneError from unknown
