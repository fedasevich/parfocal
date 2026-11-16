from urllib.parse import parse_qsl, urlsplit

TLS_DATABASE_MODES = frozenset({"require", "verify-ca", "verify-full"})


class PlainTransportError(ValueError):
    def __init__(self, name: str, wanted: str) -> None:
        super().__init__(f"{name} must use {wanted} in staging and prod")


def require_https(name: str, url: object | None) -> None:
    if url is not None and urlsplit(str(url)).scheme != "https":
        raise PlainTransportError(name, "https")


def require_tls_database(name: str, url: object) -> None:
    query = dict(parse_qsl(urlsplit(str(url)).query))
    if query.get("ssl", query.get("sslmode")) not in TLS_DATABASE_MODES:
        raise PlainTransportError(name, "ssl=require or a verify mode")
