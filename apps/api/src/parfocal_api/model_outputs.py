from collections.abc import Mapping
from enum import StrEnum

from pydantic import BaseModel

from parfocal_api.model_catalogue import CALIBRATIONS, NUCLEI_SECONDS_PER_MM2
from parfocal_common.outline_types import SINGLE_VIEW


class ModelOutput(StrEnum):
    TUMOR_REGIONS = "tumor-regions"
    CELL_OUTLINES = "cell-outlines"
    CELL_TYPES = "cell-types"


class OutputEvidence(BaseModel):
    output: ModelOutput
    measured: str | None
    data: str | None
    result: str | None


PATHOSAM_TYPES = CALIBRATIONS[("pathosam-hovernext", "v1.2", SINGLE_VIEW)]

TUMOR_EVIDENCE = OutputEvidence(
    output=ModelOutput.TUMOR_REGIONS,
    measured="FROC 0.722 and Dice 0.899 at 0.5",
    data="Three annotated CAMELYON16 test slides and one normal slide",
    result="docs/results/2026-11-16-tumor-map-evaluation-on-three-test-slides.md",
)
OUTLINE_EVIDENCE = OutputEvidence(
    output=ModelOutput.CELL_OUTLINES,
    measured=(
        "Matches the PyTorch reference on 97.5% of 366 nuclei, "
        f"about {round(NUCLEI_SECONDS_PER_MM2)} s per mm² of tissue on one L4. "
        "Not yet compared with hand outlines"
    ),
    data="CMU-1-Small-Region for the match, CAMELYON16 test_001 for the time",
    result="docs/results/2026-11-16-nucleus-job-throughput-on-l4.md",
)
TYPE_EVIDENCE = OutputEvidence(
    output=ModelOutput.CELL_TYPES,
    measured=(
        f"{PATHOSAM_TYPES.test_set_accuracy:.1%} of nuclei typed right, "
        f"calibration error {PATHOSAM_TYPES.ece_after:.3f}"
    ),
    data=(
        f"PanNuke test split, 12,928 nuclei from {len(PATHOSAM_TYPES.validated_sites)} "
        "tissue sites, lung left out"
    ),
    result="docs/results/2026-11-04-typer-calibration-registry.md",
)


def not_measured(output: ModelOutput) -> OutputEvidence:
    return OutputEvidence(output=output, measured=None, data=None, result=None)


OUTPUTS: Mapping[str, tuple[OutputEvidence, ...]] = {
    "camelyon-tumor": (TUMOR_EVIDENCE,),
    "pathosam-hovernext": (OUTLINE_EVIDENCE, TYPE_EVIDENCE),
    "hovernet": (not_measured(ModelOutput.CELL_OUTLINES), not_measured(ModelOutput.CELL_TYPES)),
}


def outputs_of(name: str) -> list[OutputEvidence]:
    return list(OUTPUTS.get(name, ()))
