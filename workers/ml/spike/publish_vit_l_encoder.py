import modal

from parfocal_ml.modal_pool import STORAGE_SECRET, pool_image
from parfocal_ml.sam_contract import VIT_L_GRAPHS, onnx_dir

APP_NAME = "parfocal-publish-vit-l-encoder"
REMOTE_WEIGHTS = "/weights/encoder.onnx"
EXPECTED_SIZE = 1_234_257_496


def publish_image() -> modal.Image:
    image = pool_image()
    if not modal.is_local():
        return image
    return image.add_local_file(str(onnx_dir() / VIT_L_GRAPHS.encoder), REMOTE_WEIGHTS)


app = modal.App(APP_NAME, image=publish_image())


@app.function(
    secrets=[modal.Secret.from_name(STORAGE_SECRET)],
    memory=(4096, 6144),
    timeout=1200,
    region="eu",
    serialized=True,
)
def publish(remote_weights: str, expected_size: int) -> dict[str, object]:
    import asyncio
    import os
    from pathlib import Path

    async def published() -> dict[str, object]:
        import httpx2

        from parfocal_common.model_artifacts import (
            ArtifactExistsError,
            ArtifactFile,
            ArtifactKind,
            ModelArtifacts,
            Upload,
            sha256_of_file,
        )
        from parfocal_common.object_store import ObjectStore
        from parfocal_common.settings import StorageSettings, load_settings
        from parfocal_common.view_embeddings import ENCODER_VERSION, ENCODER_WEIGHTS
        from parfocal_ml.view_embedding_worker import WEIGHTS_NAME

        weights = Path(remote_weights)
        size = await asyncio.to_thread(os.path.getsize, weights)
        if size != expected_size:
            raise SystemExit(f"{weights} is {size} bytes, not the measured export")
        sha256 = await asyncio.to_thread(sha256_of_file, weights)
        file = ArtifactFile(WEIGHTS_NAME, ArtifactKind.ONNX, sha256, size)
        location = load_settings(StorageSettings).storage()
        async with httpx2.AsyncClient(timeout=900) as http:
            artifacts = ModelArtifacts(ObjectStore(location, http))
            try:
                await artifacts.publish(ENCODER_WEIGHTS, ENCODER_VERSION, [Upload(file, weights)])
                state = "published"
            except ArtifactExistsError:
                state = "already published"
            manifest = await artifacts.manifest(ENCODER_WEIGHTS, ENCODER_VERSION)
        stored = manifest.file(WEIGHTS_NAME)
        return {
            "state": state,
            "bucket": location.bucket,
            "family": ENCODER_WEIGHTS,
            "version": ENCODER_VERSION,
            "sha256": stored.sha256,
            "size": stored.size,
            "matches": stored.sha256 == sha256,
        }

    return asyncio.run(published())


@app.local_entrypoint()
def main() -> None:
    print(publish.remote(REMOTE_WEIGHTS, EXPECTED_SIZE))
