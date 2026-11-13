import sys
from pathlib import Path

from sqlalchemy import Table

from parfocal_api import tables
from parfocal_common.data_classes import DATA_CLASS_MEANINGS, DataClass, classification_of
from parfocal_common.repository import repository_root

DOC_PATH = repository_root(__file__) / "docs" / "reference" / "data-map.md"


def declared_tables() -> list[Table]:
    values: list[object] = list(vars(tables).values())
    found: list[Table] = [value for value in values if isinstance(value, Table)]
    return sorted(found, key=lambda table: table.name)


def classes_in_use() -> list[DataClass | None]:
    return [
        classification_of(column.info) for table in declared_tables() for column in table.columns
    ]


def class_of(info: dict[str, object]) -> str:
    return str(classification_of(info) or "TODO")


def note_of(info: dict[str, object]) -> str:
    note = info.get("note")
    return f". {note}" if isinstance(note, str) else ""


def render() -> str:
    classes = [
        f"| `{data_class.value}` | {DATA_CLASS_MEANINGS[data_class]} |" for data_class in DataClass
    ]
    sections: list[str] = []
    for table in declared_tables():
        sections += [f"## {table.name}", "", "| Column | Class |", "|---|---|"]
        sections += [
            f"| `{column.name}` | {class_of(column.info)}{note_of(column.info)} |"
            for column in table.columns
        ]
        sections.append("")
    in_use = classes_in_use()
    counts = [f"| `{data_class.value}` | {in_use.count(data_class)} |" for data_class in DataClass]
    return "\n".join(
        [
            "# Data map",
            "",
            "Generated from the table models in `apps/api/src/parfocal_api/tables.py` by "
            "`pnpm data-map:doc`. Classify a column where it is declared, never on this page. "
            "[ADR 0028](../adr/0028-data-classes-on-columns.md) explains the classes.",
            "",
            "| Class | Meaning |",
            "|---|---|",
            *classes,
            "",
            "| Class | Columns |",
            "|---|---|",
            *counts,
            "",
            *sections,
        ]
    )


def main() -> None:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else DOC_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render())


if __name__ == "__main__":
    main()
