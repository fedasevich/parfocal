import uuid

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.tables import project_classes
from parfocal_common.taxonomies import TEMPLATES as TEMPLATES
from parfocal_common.taxonomies import TaxonomyTemplate as TaxonomyTemplate


async def insert_template(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    template: TaxonomyTemplate,
) -> None:
    await connection.execute(
        insert(project_classes),
        [
            {
                "tenant_id": tenant_id,
                "project_id": project_id,
                "key": key,
                "name": name,
                "colour": colour,
            }
            for key, (name, colour) in enumerate(TEMPLATES[template], start=1)
        ],
    )
