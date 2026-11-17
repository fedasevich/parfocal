from dataclasses import replace
from datetime import date
from typing import Any

import pytest

from parfocal_api.model_catalogue import (
    BY_NAME,
    CATALOGUE,
    LicenceClass,
    ModelHost,
    ModelMakes,
    ModelStatus,
    ModelTask,
)
from parfocal_api.model_registry import (
    BUILT_INS,
    LICENCE_ENFORCED,
    MODELS,
    PARTS,
    REGISTRY,
    DatasetLicence,
    Licence,
    RegisteredModel,
    RegistrationError,
    catalogue_without_registry,
    licence_policy_kinds,
    register,
)
from parfocal_api.model_tiers import DEFAULTS, NEEDS
from parfocal_api.tables import TenantKind

OPEN = Licence(
    weights="Apache-2.0",
    weights_class=LicenceClass.PERMITTED,
    code="MIT",
    data=(DatasetLicence("TNBC", "CC BY 4.0", LicenceClass.PERMITTED),),
    source="docs/adr/0042-model-licensing-policy.md",
    read_on=date(2026, 10, 14),
)
SAMPLE = RegisteredModel(
    name="open-detector",
    family="open-detector",
    version="v1",
    title="Open detector",
    tasks=(ModelTask.DETECTOR,),
    makes=(ModelMakes.CELLS,),
    host=ModelHost.PARFOCAL,
    licence=OPEN,
    allowed_tenant_kinds=tuple(TenantKind),
    input_mpp=0.5,
    status=ModelStatus.CANDIDATE,
)


def test_every_catalogue_model_is_registered_with_its_licences() -> None:
    assert catalogue_without_registry() == []
    assert len(REGISTRY) == len(BUILT_INS) >= len(CATALOGUE)
    for model in BUILT_INS:
        licence = model.licence
        assert licence.weights.strip()
        assert licence.code.strip()
        assert licence.source.startswith("docs/")
        assert licence.data
        assert all(dataset.licence.strip() for dataset in licence.data)


def test_every_tier_default_names_a_model_of_the_v1_line_up() -> None:
    line_up = {"camelyon-tumor", "pathosam-hovernext"}
    assert set(DEFAULTS.values()) <= line_up
    for (task, _tier), name in DEFAULTS.items():
        model = BY_NAME[name]
        assert NEEDS[task] in model.makes
        registered_model = REGISTRY[(model.name, model.version)]
        assert registered_model.status is not ModelStatus.RETIRED
        assert registered_model.licence.weights.strip()


def test_the_typer_carries_its_fitted_temperatures() -> None:
    typer = REGISTRY[("pathosam-hovernext", "v1.2")]
    assert typer.calibration_temperatures == {1: 1.42, 8: 1.29}
    assert typer.evaluation_report == "docs/results/2026-11-04-typer-calibration-registry.md"
    assert typer.input_mpp == 0.25


def test_a_model_registers_once_per_name_and_version() -> None:
    assert register([SAMPLE, replace(SAMPLE, version="v2")]).keys() == {
        ("open-detector", "v1"),
        ("open-detector", "v2"),
    }
    with pytest.raises(RegistrationError, match="registered twice"):
        register([SAMPLE, replace(SAMPLE, title="Again")])


@pytest.mark.parametrize(
    "licence",
    [
        replace(OPEN, weights=" "),
        replace(OPEN, code=""),
        replace(OPEN, source=""),
        replace(OPEN, data=()),
        replace(OPEN, data=(DatasetLicence("TNBC", "", LicenceClass.PERMITTED),)),
    ],
)
def test_registration_refuses_a_missing_licence_field(licence: Licence) -> None:
    with pytest.raises(RegistrationError):
        register([replace(SAMPLE, licence=licence)])


@pytest.mark.parametrize(
    "changes",
    [
        {"tasks": ()},
        {"makes": ()},
        {"allowed_tenant_kinds": ()},
        {"input_mpp": 0.0},
        {"calibration_temperatures": {1: 1.2}},
        {"tasks": (ModelTask.TYPER,), "calibration_temperatures": {1: 0.0}},
    ],
)
def test_registration_refuses_an_inconsistent_model(changes: dict[str, Any]) -> None:
    with pytest.raises(RegistrationError):
        register([replace(SAMPLE, **changes)])


def test_a_non_commercial_model_registers_and_is_blocked_nowhere() -> None:
    restricted = replace(
        OPEN,
        weights="CC BY-NC-SA 4.0",
        weights_class=LicenceClass.RESTRICTED,
    )
    model = register([replace(SAMPLE, licence=restricted)])[("open-detector", "v1")]
    assert licence_policy_kinds(restricted) == ()
    assert model.allowed_tenant_kinds == tuple(TenantKind)
    assert LICENCE_ENFORCED is False


def test_the_licence_policy_opens_only_for_permitted_weights_and_data() -> None:
    assert licence_policy_kinds(OPEN) == tuple(TenantKind)
    unconfirmed = DatasetLicence("CAMELYON16", "unclear", LicenceClass.UNCONFIRMED)
    assert licence_policy_kinds(replace(OPEN, data=(unconfirmed,))) == ()
    assert all(licence_policy_kinds(model.licence) == () for model in BUILT_INS)


LINE_UP_PARTS = {
    "pathosam-vit-l-encoder",
    "pathosam-vit-b-encoder",
    "pathosam-vit-l-ais-decoder",
    "pathosam-vit-b-ais-decoder",
    "pathosam-vit-l-prompt-decoder",
    "pathosam-vit-b-prompt-decoder",
    "hovernext-pannuke",
}


def test_every_part_of_the_v1_line_up_is_registered_with_a_version() -> None:
    assert {model.name for model in PARTS} == LINE_UP_PARTS
    for model in PARTS:
        assert model.version
        assert model.part_of in REGISTRY
        assert REGISTRY[(model.name, model.version)] is model
    assert ("camelyon-tumor", "v1.0") in {(model.name, model.version) for model in MODELS}


def test_an_encoder_part_may_make_nothing_visible_but_a_decoder_may_not() -> None:
    encoder = replace(SAMPLE, tasks=(ModelTask.INTERACTIVE_ENCODER,), makes=())
    assert register([encoder])
    with pytest.raises(RegistrationError, match="makes nothing"):
        register([replace(encoder, tasks=(ModelTask.DECODER,))])


def test_a_part_names_a_model_registered_before_it() -> None:
    piece = replace(SAMPLE, name="open-encoder", part_of=("open-detector", "v1"))
    assert register([SAMPLE, piece])[("open-encoder", "v1")].part_of == ("open-detector", "v1")
    with pytest.raises(RegistrationError, match="unknown model"):
        register([piece])
    with pytest.raises(RegistrationError, match="part of itself"):
        register([replace(SAMPLE, part_of=("open-detector", "v1"))])
