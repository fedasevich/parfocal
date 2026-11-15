from dataclasses import replace
from datetime import date
from typing import Any

import pytest

from parfocal_api.model_catalogue import CATALOGUE, ModelHost, ModelMakes
from parfocal_api.model_registry import (
    LICENCE_ENFORCED,
    MODELS,
    REGISTRY,
    DatasetLicence,
    Licence,
    LicenceClass,
    ModelStatus,
    ModelTask,
    RegisteredModel,
    RegistrationError,
    catalogue_without_registry,
    licence_policy_kinds,
    register,
)
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
    assert len(REGISTRY) == len(MODELS) >= len(CATALOGUE)
    for model in MODELS:
        licence = model.licence
        assert licence.weights.strip()
        assert licence.code.strip()
        assert licence.source.startswith("docs/")
        assert licence.data
        assert all(dataset.licence.strip() for dataset in licence.data)


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
    assert all(licence_policy_kinds(model.licence) == () for model in MODELS)
