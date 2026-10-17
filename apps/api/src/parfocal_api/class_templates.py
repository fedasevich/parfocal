import uuid
from enum import StrEnum

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.tables import project_classes


class TaxonomyTemplate(StrEnum):
    SENTINEL_NODE = "sentinel-node"
    PANNUKE = "pannuke"


TEMPLATES: dict[TaxonomyTemplate, tuple[tuple[str, str], ...]] = {
    TaxonomyTemplate.SENTINEL_NODE: (
        ("Tumor", "#f87171"),
        ("Stroma", "#6ee7b7"),
        ("Immune", "#c084fc"),
        ("Other", "#fbbf24"),
    ),
    TaxonomyTemplate.PANNUKE: (
        ("Neoplastic", "#f87171"),
        ("Inflammatory", "#c084fc"),
        ("Connective", "#6ee7b7"),
        ("Dead", "#fbbf24"),
        ("Epithelial", "#43999d"),
    ),
}


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
