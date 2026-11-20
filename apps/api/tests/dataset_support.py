from typing import Any

from parfocal_api.check_options import check_of
from parfocal_api.dataset_versions import DatasetSummary
from parfocal_api.training_exports import DatasetOrigin, applied_filters

SEEDED_FILTERS = applied_filters(None, check_of(None)).model_dump(mode="json")


def seeded_counts() -> dict[str, Any]:
    return DatasetSummary.model_validate(
        {
            "filters": SEEDED_FILTERS,
            "signed_off_slides": 1,
            "objects": dict.fromkeys(DatasetOrigin, 0),
            "classes": {},
            "unchecked_left_out": 0,
            "filtered_out": 0,
            "slides": [],
        }
    ).model_dump(mode="json")
