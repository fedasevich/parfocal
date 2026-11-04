import asyncio

import pytest

from parfocal_common.local_bucket import NotLocalError, ensure_local_bucket
from parfocal_common.settings import AppEnv, StorageSettings


@pytest.mark.parametrize("app_env", [AppEnv.PREVIEW, AppEnv.STAGING, AppEnv.PROD])
def test_no_bucket_is_made_outside_dev_and_test(app_env: AppEnv) -> None:
    settings = StorageSettings(app_env=app_env, storage_endpoint="http://127.0.0.1:1")
    with pytest.raises(NotLocalError):
        asyncio.run(ensure_local_bucket(settings))
