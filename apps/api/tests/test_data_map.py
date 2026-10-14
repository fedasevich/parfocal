from pathlib import Path

from parfocal_api.data_map import DOC_PATH, declared_tables, render
from parfocal_common.data_classes import unclassified_columns
from parfocal_common.db import metadata


def test_every_column_has_a_data_class() -> None:
    assert unclassified_columns(metadata) == []


def test_the_map_covers_every_table_in_the_schema() -> None:
    assert {table.name for table in declared_tables()} == set(metadata.tables)


def test_the_data_map_page_is_current() -> None:
    assert Path(DOC_PATH).read_text() == render()
