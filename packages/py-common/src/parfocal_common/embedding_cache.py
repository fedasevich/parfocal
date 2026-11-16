import base64
import json
import uuid
from dataclasses import dataclass

from parfocal_common.ingest import slide_prefix

EMBEDDING_DIMS = (1, 256, 64, 64)
EMBEDDING_VALUES = 256 * 64 * 64
EMBEDDING_BYTES = EMBEDDING_VALUES * 2
EMBEDDING_DTYPE = "float16-le"
SERVER_ENCODER = "pathosam-vit-b-histopathology-fp32"
TILE_MICRONS = 128
EMBEDDINGS_DIR = "embeddings/"
MANIFEST_NAME = "manifest.json"
EMBEDDING_CONTENT_TYPE = "application/octet-stream"


class ManifestUnreadableError(ValueError):
    pass


@dataclass(frozen=True)
class EmbeddingManifest:
    encoder: str
    level: int
    downsample: float
    tile: int
    level_width: int
    level_height: int
    columns: int
    rows: int
    tiles: bytes

    def has(self, column: int, row: int) -> bool:
        if not (0 <= column < self.columns and 0 <= row < self.rows):
            return False
        index = row * self.columns + column
        return bool(self.tiles[index >> 3] & (1 << (index & 7)))

    def count(self) -> int:
        return sum(bin(byte).count("1") for byte in self.tiles)

    def render(self) -> bytes:
        body = {
            "encoder": self.encoder,
            "dtype": EMBEDDING_DTYPE,
            "dims": list(EMBEDDING_DIMS),
            "level": self.level,
            "downsample": self.downsample,
            "tile": self.tile,
            "level_width": self.level_width,
            "level_height": self.level_height,
            "columns": self.columns,
            "rows": self.rows,
            "tiles": base64.b64encode(self.tiles).decode(),
        }
        return json.dumps(body, sort_keys=True).encode()


def grid_size(length: int, tile: int) -> int:
    return max(1, -(-length // tile))


def tile_origin(index: int, tile: int, length: int) -> int:
    return max(0, min(index * tile, length - tile))


def bitset(columns: int, rows: int, cells: set[tuple[int, int]]) -> bytes:
    bits = bytearray((columns * rows + 7) // 8)
    for column, row in cells:
        index = row * columns + column
        bits[index >> 3] |= 1 << (index & 7)
    return bytes(bits)


def read_manifest(data: bytes) -> EmbeddingManifest:
    try:
        body = json.loads(data)
        manifest = EmbeddingManifest(
            encoder=str(body["encoder"]),
            level=int(body["level"]),
            downsample=float(body["downsample"]),
            tile=int(body["tile"]),
            level_width=int(body["level_width"]),
            level_height=int(body["level_height"]),
            columns=int(body["columns"]),
            rows=int(body["rows"]),
            tiles=base64.b64decode(body["tiles"]),
        )
    except (ValueError, KeyError, TypeError) as error:
        raise ManifestUnreadableError(str(error)) from error
    if (
        body.get("dtype") != EMBEDDING_DTYPE
        or len(manifest.tiles) != (manifest.columns * manifest.rows + 7) // 8
    ):
        raise ManifestUnreadableError("the manifest does not match the embedding contract")
    return manifest


def embeddings_prefix(tenant_id: uuid.UUID, slide_id: uuid.UUID) -> str:
    return f"{slide_prefix(tenant_id, slide_id)}{EMBEDDINGS_DIR}"


def manifest_key(tenant_id: uuid.UUID, slide_id: uuid.UUID) -> str:
    return f"{embeddings_prefix(tenant_id, slide_id)}{MANIFEST_NAME}"


def tile_key(tenant_id: uuid.UUID, slide_id: uuid.UUID, column: int, row: int) -> str:
    return f"{embeddings_prefix(tenant_id, slide_id)}{column}_{row}.f16"
