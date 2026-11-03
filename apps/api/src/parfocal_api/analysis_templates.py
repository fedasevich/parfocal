from enum import StrEnum

from parfocal_api.tables import AnalysisTemplate


class ViewerPart(StrEnum):
    OBJECTS = "objects"
    LAYERS = "layers"
    DECISIONS = "decisions"
    OPINION = "opinion"
    STAGING_HERO = "staging-hero"
    AREA_LIST = "area-list"
    MEASURE_STEP = "measure-step"
    UNSURE_ZONES = "unsure-zones"
    CELL_TYPING = "cell-typing"


BASE_PARTS = (ViewerPart.OBJECTS, ViewerPart.LAYERS, ViewerPart.DECISIONS, ViewerPart.OPINION)

TEMPLATE_PARTS: dict[AnalysisTemplate, tuple[ViewerPart, ...]] = {
    AnalysisTemplate.NONE: (),
    AnalysisTemplate.SENTINEL_NODE: (
        ViewerPart.STAGING_HERO,
        ViewerPart.AREA_LIST,
        ViewerPart.MEASURE_STEP,
    ),
    AnalysisTemplate.CELL_REVIEW: (ViewerPart.UNSURE_ZONES, ViewerPart.CELL_TYPING),
}


def viewer_parts(template: AnalysisTemplate) -> list[ViewerPart]:
    return [*BASE_PARTS, *TEMPLATE_PARTS[template]]
