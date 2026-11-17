import uuid
from collections.abc import Mapping, Sequence

from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import actor_of
from parfocal_api.import_sources import Reach
from parfocal_api.link_imports import Planned, StartedFile, start_file
from parfocal_api.principals import Principal
from parfocal_api.uploads import Settings, creator_values
from parfocal_common.object_store import ObjectStore
from parfocal_common.result_imports import UploadKind


async def start_side_results(
    connection: AsyncConnection,
    principal: Principal,
    settings: Settings,
    store: ObjectStore,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    planned: Sequence[Planned],
    opened: Mapping[str, uuid.UUID],
    reach: Reach,
) -> list[StartedFile]:
    return [
        await start_file(
            connection,
            actor_of(principal),
            creator_values(principal),
            settings,
            store,
            tenant_id,
            project_id,
            item,
            {},
            reach,
            opened,
        )
        for item in planned
        if item.kind is UploadKind.RESULT and item.paired_with in opened
    ]
