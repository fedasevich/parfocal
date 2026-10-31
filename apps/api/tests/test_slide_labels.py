import uuid

import pytest

from parfocal_api.slide_ingest import free_label, label_of
from parfocal_common.ingest import failure_message, original_key, original_suffix


@pytest.mark.parametrize(
    ("name", "label"),
    [
        ("CMU-1-Small-Region.svs", "CMU-1-Small-Region"),
        ("S26 1.2 block A.ndpi", "S26 1.2 block A"),
        ("scan.ome.tiff", "scan"),
        ("C:\\scans\\Biopsy.svs", "Biopsy"),
        (".svs", ".svs"),
        ("a" * 250 + ".tif", "a" * 180),
    ],
)
def test_a_slide_label_is_the_file_name_without_its_extension(name: str, label: str) -> None:
    assert label_of(name) == label


def test_a_taken_label_gets_the_next_free_number() -> None:
    assert free_label("Biopsy", set()) == "Biopsy"
    assert free_label("Biopsy", {"Biopsy"}) == "Biopsy (2)"
    assert free_label("Biopsy", {"Biopsy", "Biopsy (2)", "Biopsy (4)"}) == "Biopsy (3)"


def test_the_published_key_keeps_only_a_known_extension() -> None:
    tenant, slide = uuid.uuid4(), uuid.uuid4()
    assert original_suffix("Smith_J.NDPI") == ".ndpi"
    assert original_suffix("Smith_J.exe") == ""
    assert original_key(tenant, slide, "x.svs") == f"t/{tenant}/s/{slide}/original.svs"
    assert original_key(tenant, slide, "Smith_J.exe") == f"t/{tenant}/s/{slide}/original"


def test_every_failure_has_a_plain_message() -> None:
    assert failure_message("truncated").startswith("The file is cut short")
    assert failure_message("upload-expired").startswith("The upload stopped")
    assert failure_message("something-new") == "Parfocal could not take this file in."
