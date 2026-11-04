import asyncio

import httpx2

from parfocal_common.object_store import ObjectStore
from parfocal_common.settings import AppEnv, StorageSettings, load_settings

LOCAL_ENVIRONMENTS = frozenset({AppEnv.DEV, AppEnv.TEST})


class NotLocalError(RuntimeError):
    pass


async def ensure_local_bucket(settings: StorageSettings) -> str:
    if settings.app_env not in LOCAL_ENVIRONMENTS:
        raise NotLocalError(
            f"Buckets are made by hand outside dev and test, not in {settings.app_env}"
        )
    location = settings.storage()
    async with httpx2.AsyncClient(timeout=30) as http:
        await ObjectStore(location, http).create_bucket()
    return location.bucket


def main() -> None:
    print(asyncio.run(ensure_local_bucket(load_settings(StorageSettings))))


if __name__ == "__main__":
    main()
