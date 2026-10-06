from parfocal_api import PACKAGE_NAME
from parfocal_common import PACKAGE_NAME as COMMON_PACKAGE_NAME


def test_package_loads() -> None:
    assert PACKAGE_NAME == "parfocal-api"


def test_shared_package_resolves() -> None:
    assert COMMON_PACKAGE_NAME == "parfocal-common"
