from typing import Any, get_args

import pytest
from pydantic import ValidationError

from parfocal_common.report_blocks import BLOCKS, BlockKind, ReportBlock, ReportFormat


def kinds_in_the_union() -> set[str]:
    union = get_args(ReportBlock.__value__)[0]
    return {get_args(model.model_fields["kind"].annotation)[0] for model in get_args(union)}


def test_the_catalogue_is_the_closed_list_of_block_kinds() -> None:
    assert kinds_in_the_union() == {kind.value for kind in BlockKind}
    assert len(BlockKind) == 11


def test_a_block_takes_defaults_for_the_settings_it_leaves_out() -> None:
    [block] = BLOCKS.validate_python([{"kind": "worst-objects", "title": "Worst"}])
    assert block.model_dump() == {
        "title": "Worst",
        "show_title": True,
        "width": "full",
        "page_break": False,
        "kind": "worst-objects",
        "rows": 10,
        "thumbnails": True,
    }


@pytest.mark.parametrize(
    "block",
    [
        {"kind": "pie-chart", "title": "Pie"},
        {"kind": "text", "title": "Methods", "colour": "red"},
        {"kind": "worst-objects", "title": "Worst", "rows": "6"},
        {"kind": "worst-objects", "title": "Worst", "rows": 0},
        {"kind": "text", "title": "Methods", "page_break": 1},
        {"kind": "headline-numbers", "title": "Results", "metrics": []},
        {"kind": "headline-numbers", "title": "Results", "metrics": ["dice", "dice"]},
        {"kind": "slide-figure", "title": "Figure", "object_id": "X9"},
        {"kind": "text"},
    ],
    ids=[
        "unknown-kind",
        "unknown-setting",
        "number-as-text",
        "out-of-range",
        "flag-as-number",
        "no-metrics",
        "repeated-metric",
        "bad-object-id",
        "no-title",
    ],
)
def test_unknown_kinds_and_unknown_or_mistyped_settings_are_refused(block: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        BLOCKS.validate_python([block])


def test_the_format_refuses_unknown_settings() -> None:
    assert ReportFormat().paper == "a4"
    with pytest.raises(ValidationError):
        ReportFormat.model_validate({"paper": "a4", "colour": "red"})
    with pytest.raises(ValidationError):
        ReportFormat.model_validate({"downloads": ["pdf", "pdf"]})
