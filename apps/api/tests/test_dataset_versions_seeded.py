import json
from typing import Any

from db_support import run_sql
from test_showcase import RESULTS
from test_showcase_annotation import example, in_layer

from parfocal_api.dataset_versions import frozen_zip, summary_of
from parfocal_api.tables import review_tasks
from parfocal_api.training_exports import DatasetFilters, DatasetOrigin, dataset

__all__ = ["example"]

MEASURED = "dataset-version-size"


async def frozen_size(connection: Any, task: Any, filters: DatasetFilters) -> dict[str, Any]:
    manifest, files = await dataset(connection, task, RESULTS, filters)  # type: ignore[arg-type]
    summary = await summary_of(connection, manifest, len(manifest.slides))
    content = frozen_zip(manifest, files, 1)
    return {
        "slides": len(manifest.slides),
        "objects": sum(summary.objects.values()),
        "unchecked": summary.objects[DatasetOrigin.AI_UNCHECKED],
        "geojson_bytes": sum(len(body) for body in files.values()),
        "zip_bytes": len(content),
    }


async def test_a_frozen_version_of_the_seeded_example_task_is_measured(example: str) -> None:
    await run_sql(
        example,
        "UPDATE review_task_slides SET signed_off_at = now() "
        "WHERE task_id IN (SELECT id FROM review_tasks WHERE kind = 'annotate')",
    )
    async for task_id, _, _, connection in in_layer(example):
        task = (
            await connection.execute(review_tasks.select().where(review_tasks.c.id == task_id))
        ).one()
        checked = await frozen_size(connection, task, DatasetFilters())
        everything = await frozen_size(connection, task, DatasetFilters(include_unchecked=True))
        print(MEASURED, json.dumps({"checked": checked, "with_unchecked": everything}))
        assert 0 < checked["zip_bytes"] <= everything["zip_bytes"]
        assert checked["objects"] <= everything["objects"]
