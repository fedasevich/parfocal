import json
import sys
from pathlib import Path

from PIL import Image

STRIDE = 331
ROOT = Path(__file__).resolve().parents[3]
IMAGES = (
    ROOT / "docs/design/ux-mock/assets/mid-10x.jpg",
    ROOT / "docs/design/ux-mock/assets/hpf-40x.jpg",
)
TARGET = Path(__file__).resolve().parents[1] / "data/he-pixels.json"


def sample(path: Path) -> str:
    with Image.open(path) as image:
        data = image.convert("RGB").tobytes()
    offsets = range(0, len(data) - 2, 3 * STRIDE)
    return "".join(f"{data[i]:02x}{data[i + 1]:02x}{data[i + 2]:02x}" for i in offsets)


def main() -> int:
    pixels = "".join(sample(path) for path in IMAGES)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(
        json.dumps(
            {
                "sources": [str(path.relative_to(ROOT)) for path in IMAGES],
                "stride": STRIDE,
                "pixels": pixels,
            }
        )
        + "\n"
    )
    print(f"{len(pixels) // 6} pixels written to {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
