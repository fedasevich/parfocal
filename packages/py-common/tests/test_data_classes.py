from sqlalchemy import Column, Integer, MetaData, String, Table

from parfocal_common.data_classes import (
    PERSONAL,
    DataClass,
    classification_of,
    unclassified_columns,
)
from parfocal_common.db import SoftDeletable, TenantOwned, Timestamped


def test_a_column_without_a_class_is_reported() -> None:
    scratch = MetaData()
    Table(
        "notes",
        scratch,
        Column("id", Integer, primary_key=True, info=PERSONAL),
        Column("body", String),
    )
    assert unclassified_columns(scratch) == ["notes.body"]


def test_shared_mixin_columns_are_operational() -> None:
    mixin_columns = [
        TenantOwned.tenant_id,
        Timestamped.created_at,
        Timestamped.updated_at,
        SoftDeletable.deleted_at,
    ]
    assert [classification_of(column.column.info) for column in mixin_columns] == [
        DataClass.OPERATIONAL
    ] * 4
