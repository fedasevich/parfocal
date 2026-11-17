import sys
from pathlib import Path

import numpy as np


def pack(chunk_dir: Path, out: Path) -> int:
    starts = [0]
    positions = []
    for chunk in sorted(chunk_dir.glob("chunk-*.npz")):
        data = np.load(chunk, allow_pickle=False)
        offsets = data["offsets"].astype(np.uint64)
        base = starts[-1]
        starts.extend(int(base + offset) for offset in offsets[1:])
        positions.append(data["points"].astype("<f4"))
    count = len(starts) - 1
    with out.open("wb") as file:
        file.write(np.array([count], dtype="<u4").tobytes())
        file.write(np.array(starts, dtype="<u4").tobytes())
        file.write(np.concatenate(positions).tobytes())
    return count


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: pack-poc-nuclei.py CHUNK_DIR OUT_FILE")
    print(pack(Path(sys.argv[1]), Path(sys.argv[2])))
