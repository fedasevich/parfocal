from enum import StrEnum
from typing import Any

from sqlalchemy import MetaData

CLASSIFICATION = "classification"


class DataClass(StrEnum):
    PHI = "phi"
    PERSONAL = "personal"
    SECRET = "secret"
    OPERATIONAL = "operational"
    PUBLIC = "public"


DATA_CLASS_MEANINGS = {
    DataClass.PHI: "Identifies a patient or describes their health. Encrypted or kept out of logs.",
    DataClass.PERSONAL: "Identifies or describes a staff member, including pseudonymous ids.",
    DataClass.SECRET: "A credential, token or hash of one. Never logged or exported.",
    DataClass.OPERATIONAL: "Internal ids, codes, settings and times with no person in them.",
    DataClass.PUBLIC: "Safe to publish.",
}


def classified(data_class: DataClass) -> dict[str, Any]:
    return {CLASSIFICATION: data_class}


PHI = classified(DataClass.PHI)
PERSONAL = classified(DataClass.PERSONAL)
SECRET = classified(DataClass.SECRET)
OPERATIONAL = classified(DataClass.OPERATIONAL)
PUBLIC = classified(DataClass.PUBLIC)


def classification_of(info: dict[Any, Any]) -> DataClass | None:
    value = info.get(CLASSIFICATION)
    return value if isinstance(value, DataClass) else None


def unclassified_columns(metadata: MetaData) -> list[str]:
    return [
        f"{table.name}.{column.name}"
        for table in metadata.sorted_tables
        for column in table.columns
        if classification_of(column.info) is None
    ]
