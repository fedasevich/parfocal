import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import cast

IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp")
DEFAULT_LIMIT = 5
COUNTS = Path(tempfile.gettempdir()) / "parfocal-image-reads"


def advice(limit: int) -> str:
    return (
        f"This agent has already opened {limit} images, the limit per agent. Every image stays in "
        "context for the rest of the run. Compare by number instead with "
        "`pnpm --filter @parfocal/web shot APP_URL out.png --against URL_OR_PNG`, and leave the "
        "visual check to the owner's review. The owner can raise PARFOCAL_IMAGE_LIMIT."
    )


def image_path(event: dict[str, object]) -> str | None:
    raw_input = event.get("tool_input")
    if event.get("tool_name") != "Read" or not isinstance(raw_input, dict):
        return None
    path = str(cast("dict[str, object]", raw_input).get("file_path", ""))
    return path if path.lower().endswith(IMAGE_SUFFIXES) else None


def reader_key(event: dict[str, object]) -> str:
    reader = (
        event.get("agent_id")
        or event.get("transcript_path")
        or event.get("session_id")
        or "unknown"
    )
    return hashlib.sha256(str(reader).encode()).hexdigest()[:16]


def allow_image(event: dict[str, object], counts: Path, limit: int) -> bool:
    if image_path(event) is None:
        return True
    counts.mkdir(parents=True, exist_ok=True)
    counter = counts / reader_key(event)
    seen = int(counter.read_text() or "0") if counter.exists() else 0
    if seen >= limit:
        return False
    counter.write_text(str(seen + 1))
    return True


def main() -> int:
    limit = int(os.environ.get("PARFOCAL_IMAGE_LIMIT", DEFAULT_LIMIT))
    if allow_image(json.load(sys.stdin), COUNTS, limit):
        return 0
    print(advice(limit), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
