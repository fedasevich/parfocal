import uuid
from collections.abc import Mapping
from dataclasses import dataclass

from parfocal_common.embedding_cache import EMBEDDING_BYTES
from parfocal_common.ingest import SlideFolderError, slide_folder_in

KIND = "view-embedding"
ENCODER = "pathosam-vit-l-histopathology-fp32"
ENCODER_MODEL = "pathosam-vit-l-encoder"
ENCODER_WEIGHTS = "pathosam-vit-l"
ENCODER_VERSION = "v1"
MIN_VIEW_SIDE = 16
MAX_VIEW_SIDE = 4096


class ViewEmbeddingCallError(ValueError):
    pass


@dataclass(frozen=True)
class ViewEmbeddingCall:
    tenant_id: uuid.UUID
    slide_id: uuid.UUID
    x: int
    y: int
    width: int
    height: int
    folder: str | None = None

    def call(self) -> dict[str, object]:
        call: dict[str, object] = {
            "kind": KIND,
            "tenant_id": str(self.tenant_id),
            "slide_id": str(self.slide_id),
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
        }
        if self.folder is not None:
            call["folder"] = self.folder
        return call


def whole(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def fits(x: int, y: int, width: int, height: int) -> bool:
    return (
        x >= 0
        and y >= 0
        and MIN_VIEW_SIDE <= width <= MAX_VIEW_SIDE
        and MIN_VIEW_SIDE <= height <= MAX_VIEW_SIDE
    )


def view_embedding_call_of(call: Mapping[str, object]) -> ViewEmbeddingCall:
    x, y = whole(call.get("x")), whole(call.get("y"))
    width, height = whole(call.get("width")), whole(call.get("height"))
    if call.get("kind") != KIND or x is None or y is None or width is None or height is None:
        raise ViewEmbeddingCallError("A view embedding call names its kind and its view")
    if not fits(x, y, width, height):
        raise ViewEmbeddingCallError(
            f"A view is {MIN_VIEW_SIDE} to {MAX_VIEW_SIDE} slide pixels on each side"
        )
    try:
        folder = slide_folder_in(call.get("folder"))
    except SlideFolderError as error:
        raise ViewEmbeddingCallError(str(error)) from error
    return ViewEmbeddingCall(
        uuid.UUID(str(call.get("tenant_id"))),
        uuid.UUID(str(call.get("slide_id"))),
        x,
        y,
        width,
        height,
        folder,
    )


def reply_of(embedding: bytes) -> dict[str, object]:
    return {"embedding": embedding, "encoder": ENCODER}


def embedding_in(reply: Mapping[str, object]) -> bytes | None:
    embedding = reply.get("embedding")
    if not isinstance(embedding, bytes) or len(embedding) != EMBEDDING_BYTES:
        return None
    if reply.get("encoder") != ENCODER:
        return None
    return embedding
