from dataclasses import dataclass

from parfocal_common.object_store import ObjectStore, child_text, children, parse

VERSIONING_ON = (
    b'<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
    b"<Status>Enabled</Status></VersioningConfiguration>"
)


@dataclass(frozen=True)
class Version:
    version_id: str
    latest: bool
    deleted: bool


class NoPreviousVersionError(Exception):
    def __init__(self, key: str) -> None:
        super().__init__(f"{key} has no earlier version to restore")


async def enable_versioning(store: ObjectStore) -> None:
    await store.send("PUT", "", {"versioning": ""}, VERSIONING_ON)


async def versions(store: ObjectStore, key: str) -> list[Version]:
    listing = parse((await store.send("GET", "", {"versions": "", "prefix": key})).content)
    found: list[Version] = []
    for kind, deleted in (("Version", False), ("DeleteMarker", True)):
        for entry in children(listing, kind):
            if child_text(entry, "Key") == key:
                found.append(
                    Version(
                        version_id=child_text(entry, "VersionId") or "",
                        latest=child_text(entry, "IsLatest") == "true",
                        deleted=deleted,
                    )
                )
    return found


async def restore_previous(store: ObjectStore, key: str) -> str:
    listed = await versions(store, key)
    earlier = [version for version in listed if not version.deleted and not version.latest]
    if not earlier:
        raise NoPreviousVersionError(key)
    chosen = earlier[0]
    response = await store.send("GET", key, {"versionId": chosen.version_id})
    content_type = response.headers.get("content-type", "application/octet-stream")
    await store.put_object(key, response.content, content_type)
    return chosen.version_id
