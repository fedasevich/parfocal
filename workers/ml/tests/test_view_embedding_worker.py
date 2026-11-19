import asyncio
import uuid
from collections.abc import Mapping
from contextlib import AsyncExitStack

import numpy as np
import pytest
from numpy.typing import NDArray
from test_tumor_map import ArraySlide

from parfocal_common.embedding_cache import EMBEDDING_BYTES, EMBEDDING_DIMS
from parfocal_common.view_embeddings import (
    ENCODER,
    MAX_VIEW_SIDE,
    ViewEmbeddingCall,
    ViewEmbeddingCallError,
    embedding_in,
    view_embedding_call_of,
)
from parfocal_common.view_maps import seconds_in
from parfocal_ml.embedding_service import EmbeddingShapeError
from parfocal_ml.gpu_pool import POOLS, Family
from parfocal_ml.modal_pool import default_runners, pool_entry
from parfocal_ml.priority_gate import Kind, WrongLaneError
from parfocal_ml.sam_contract import IMAGE_SIZE, pixel_values
from parfocal_ml.tumor_map_job import SlideImage
from parfocal_ml.view_embedding_worker import ViewEmbeddingService, answer_view_embedding

TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
SLIDE = uuid.UUID("00000000-0000-4000-8000-000000000002")
EMBEDDER = next(pool for pool in POOLS if pool.family is Family.EMBEDDER)
WIDTH, HEIGHT = 2048, 1536


def opener(slide: SlideImage, folders: list[str | None] | None = None):
    async def open_slide(tenant_id: uuid.UUID, slide_id: uuid.UUID, folder: str | None):
        if folders is not None:
            folders.append(folder)
        return slide

    return open_slide


def small_slide() -> tuple[SlideImage, ArraySlide]:
    red = np.full((HEIGHT, WIDTH), 255, np.uint8)
    red[600:700, 400:500] = 20
    source = ArraySlide(red)
    slide = SlideImage(
        reader=source,
        thumbnail=source.rgb[::16, ::16].copy(),
        downsample=16.0,
        width=WIDTH,
        height=HEIGHT,
        mpp=0.25,
    )
    return slide, source


class MeanEncoder:
    def __init__(self) -> None:
        self.seen: list[NDArray[np.float32]] = []

    def __call__(self, pixels: NDArray[np.float32]) -> NDArray[np.float32]:
        self.seen.append(pixels)
        return np.full(EMBEDDING_DIMS, float(pixels[0, 0].mean()), np.float32)


def call_for(
    x: int = 256, y: int = 512, width: int = 512, height: int = 512, folder: str | None = None
) -> dict[str, object]:
    return ViewEmbeddingCall(TENANT, SLIDE, x, y, width, height, folder).call()


def answered(call: Mapping[str, object], slide: SlideImage, encode: MeanEncoder):
    return asyncio.run(answer_view_embedding(call, opener(slide), encode))


def test_the_view_is_read_at_full_resolution_and_embedded_as_float16() -> None:
    slide, source = small_slide()
    encode = MeanEncoder()
    reply = answered(call_for(), slide, encode)
    assert source.reads == [(256, 512, 512, 512)]
    assert encode.seen[0].shape == (1, 3, IMAGE_SIZE, IMAGE_SIZE)
    expected = pixel_values(source.rgb[512:1024, 256:768])
    assert np.array_equal(encode.seen[0], expected)
    body = embedding_in(reply)
    assert body is not None
    assert len(body) == EMBEDDING_BYTES
    values = np.frombuffer(body, "<f2")
    assert values[0] == np.float16(expected[0, 0].mean())
    assert reply["encoder"] == ENCODER


def test_a_view_wider_than_tall_keeps_its_shape_in_the_model_frame() -> None:
    slide, _ = small_slide()
    encode = MeanEncoder()
    answered(call_for(0, 0, 1024, 512), slide, encode)
    pixels = encode.seen[0]
    assert not np.all(pixels[0, :, : IMAGE_SIZE // 2] == 0)
    assert np.all(pixels[0, :, IMAGE_SIZE // 2 :] == 0)


def test_a_view_past_the_slide_or_out_of_bounds_is_refused() -> None:
    slide, source = small_slide()
    encode = MeanEncoder()
    with pytest.raises(ViewEmbeddingCallError):
        answered(call_for(WIDTH - 100, 0), slide, encode)
    with pytest.raises(ViewEmbeddingCallError):
        answered(call_for(0, HEIGHT - 511), slide, encode)
    for broken in (
        call_for(width=MAX_VIEW_SIDE + 1),
        call_for(height=8),
        call_for(x=-1),
        {**call_for(), "kind": "outline-types"},
        {**call_for(), "x": 1.5},
        {**call_for(), "y": True},
        {**call_for(), "folder": "../other-tenant/"},
    ):
        with pytest.raises(ViewEmbeddingCallError):
            view_embedding_call_of(broken)
    assert source.reads == []
    assert encode.seen == []


def test_the_call_carries_the_folder_beside_the_original() -> None:
    slide, _ = small_slide()
    folders: list[str | None] = []
    asyncio.run(
        answer_view_embedding(
            call_for(folder="samples/tnbc/one/"), opener(slide, folders), MeanEncoder()
        )
    )
    assert folders == ["samples/tnbc/one/"]
    assert view_embedding_call_of(call_for()).folder is None


def test_an_encoder_with_the_wrong_shape_is_an_error_not_an_embedding() -> None:
    slide, _ = small_slide()

    def flat(pixels: NDArray[np.float32]) -> NDArray[np.float32]:
        return np.zeros((1, 256, 32, 32), np.float32)

    with pytest.raises(EmbeddingShapeError):
        asyncio.run(answer_view_embedding(call_for(), opener(slide), flat))


def test_a_reply_that_is_short_or_from_another_encoder_is_not_an_embedding() -> None:
    body = bytes(EMBEDDING_BYTES)
    assert embedding_in({"embedding": body, "encoder": ENCODER}) == body
    assert embedding_in({"embedding": body[:-2], "encoder": ENCODER}) is None
    assert embedding_in({"embedding": body, "encoder": "pathosam-vit-b"}) is None
    assert embedding_in({"embedding": "text", "encoder": ENCODER}) is None
    assert embedding_in({}) is None


def test_the_service_sets_up_once_and_reports_its_seconds() -> None:
    slide, _ = small_slide()
    setups: list[int] = []

    async def setup(stack: AsyncExitStack):
        setups.append(1)
        return opener(slide), MeanEncoder()

    service = ViewEmbeddingService(setup)
    try:
        first = service.answer(call_for())
        service.answer(call_for(0, 0))
    finally:
        service.close()
    assert setups == [1]
    assert embedding_in(first) is not None
    assert seconds_in(first) is not None


def test_a_failed_setup_closes_what_it_opened_and_is_tried_again() -> None:
    slide, _ = small_slide()
    closed: list[int] = []

    async def setup(stack: AsyncExitStack):
        stack.callback(closed.append, 1)
        if not closed:
            raise FileNotFoundError("no encoder weights yet")
        return opener(slide), MeanEncoder()

    service = ViewEmbeddingService(setup)
    try:
        with pytest.raises(FileNotFoundError):
            service.answer(call_for())
        assert closed == [1]
        assert embedding_in(service.answer(call_for())) is not None
        assert closed == [1]
    finally:
        service.close()
    assert closed == [1, 1]


def test_only_the_interactive_pool_embeds_views() -> None:
    families = {pool.family for pool in POOLS if Kind.VIEW_EMBEDDING in default_runners(pool)}
    assert families == {Family.EMBEDDER}
    calls: list[Mapping[str, object]] = []

    def runner(call: Mapping[str, object]) -> Mapping[str, object]:
        calls.append(call)
        return {"embedding": b""}

    reply = pool_entry(EMBEDDER, {Kind.VIEW_EMBEDDING: runner})(call_for())
    assert reply["kind"] == Kind.VIEW_EMBEDDING
    assert calls[0]["kind"] == "view-embedding"
    job_pool = next(pool for pool in POOLS if pool.family is not Family.EMBEDDER)
    with pytest.raises(WrongLaneError):
        pool_entry(job_pool)(call_for())
