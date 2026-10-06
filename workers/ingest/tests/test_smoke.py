from parfocal_ingest import PACKAGE_NAME


def test_package_loads() -> None:
    assert PACKAGE_NAME == "parfocal-ingest"
