from parfocal_api.result_sets import RegionRow
from parfocal_api.tables import ResultObjectKind
from parfocal_common.chunk_store import Cell

CELL_CLASSES = ("Tumor cell", "Lymphocyte", "Stroma cell")
DEMO_CELLS = 24


def box(left: int, top: int, size: int) -> str:
    right, bottom = left + size, top + size
    return f"POLYGON(({left} {top},{right} {top},{right} {bottom},{left} {bottom},{left} {top}))"


def demo_regions(width: int, height: int) -> list[RegionRow]:
    size = max(min(width, height) // 8, 16)
    top = height // 2 - size // 2
    return [
        RegionRow(
            kind=ResultObjectKind.REGION,
            number=index + 1,
            wkt=box(width * (index + 1) // 4 - size // 2, top, size),
            class_position=0,
            score=220 - index * 50,
        )
        for index in range(3)
    ]


def demo_cells(width: int, height: int) -> list[Cell]:
    size = max(min(width, height) // 60, 4)
    left, top = width // 2 - 3 * size * 2, height // 4
    cells: list[Cell] = []
    for index in range(DEMO_CELLS):
        x = left + (index % 6) * size * 2
        y = top + (index // 6) * size * 2
        cells.append(
            Cell(
                number=index + 1,
                ring=(x, y, x + size, y, x + size, y + size, x, y + size),
                class_index=index % len(CELL_CLASSES),
                score=250 - index * 9,
            )
        )
    return cells
