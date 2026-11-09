import hashlib
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from parfocal_api.training_examples import TrainingExample

HELD_OUT_SHARE = 0.2
BUCKETS = 2**64


@dataclass(frozen=True)
class ValidationSplit:
    training: tuple[TrainingExample, ...]
    validation: tuple[TrainingExample, ...]


def slide_bucket(tenant_id: uuid.UUID, slide_id: uuid.UUID) -> int:
    digest = hashlib.sha256(b"parfocal.validation-split:" + tenant_id.bytes + slide_id.bytes)
    return int.from_bytes(digest.digest()[:8], "big")


def is_held_out(tenant_id: uuid.UUID, slide_id: uuid.UUID, share: float = HELD_OUT_SHARE) -> bool:
    if not 0.0 <= share <= 1.0:
        raise ValueError("share must be between 0 and 1")
    return slide_bucket(tenant_id, slide_id) < share * BUCKETS


def split_examples(
    examples: Sequence[TrainingExample], share: float = HELD_OUT_SHARE
) -> ValidationSplit:
    training: list[TrainingExample] = []
    validation: list[TrainingExample] = []
    for example in examples:
        side = validation if is_held_out(example.tenant_id, example.slide_id, share) else training
        side.append(example)
    return ValidationSplit(training=tuple(training), validation=tuple(validation))
