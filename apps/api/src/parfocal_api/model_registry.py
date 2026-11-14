from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum

from fastapi import APIRouter
from pydantic import BaseModel

from parfocal_api.context import TenantConnection
from parfocal_api.model_catalogue import (
    CALIBRATIONS,
    CATALOGUE,
    ModelHost,
    ModelMakes,
    ModelName,
    ModelVersion,
)
from parfocal_api.problems import NotFoundError
from parfocal_api.tables import TenantKind

LICENCE_ENFORCED = False
PATHOSAM_MPP = 0.25
ADR_0042 = "docs/adr/0042-model-licensing-policy.md"
ADR_0202 = "docs/adr/0202-v1-model-line-up-per-tier.md"
TYPER_CALIBRATION = "docs/results/2026-11-04-typer-calibration-registry.md"


class ModelTask(StrEnum):
    TUMOR_MAP = "tumor-map"
    DETECTOR = "detector"
    TYPER = "typer"
    INTERACTIVE_ENCODER = "interactive-encoder"
    DECODER = "decoder"


class ModelStatus(StrEnum):
    CANDIDATE = "candidate"
    VALIDATED = "validated"
    RETIRED = "retired"


class LicenceClass(StrEnum):
    PERMITTED = "permitted"
    RESTRICTED = "restricted"
    UNCONFIRMED = "unconfirmed"
    OWN = "own"


@dataclass(frozen=True)
class DatasetLicence:
    dataset: str
    licence: str
    licence_class: LicenceClass


@dataclass(frozen=True)
class Licence:
    weights: str
    weights_class: LicenceClass
    code: str
    data: tuple[DatasetLicence, ...]
    source: str
    read_on: date


@dataclass(frozen=True)
class RegisteredModel:
    name: str
    family: str
    version: str
    title: str
    tasks: tuple[ModelTask, ...]
    makes: tuple[ModelMakes, ...]
    host: ModelHost
    licence: Licence
    allowed_tenant_kinds: tuple[TenantKind, ...]
    input_mpp: float | None
    status: ModelStatus
    evaluation_report: str | None = None
    calibration_temperatures: Mapping[int, float] = field(default_factory=dict)


class RegistrationError(ValueError):
    pass


def licence_policy_kinds(licence: Licence) -> tuple[TenantKind, ...]:
    usable = {LicenceClass.PERMITTED, LicenceClass.OWN}
    if licence.weights_class not in usable:
        return ()
    if any(dataset.licence_class not in usable for dataset in licence.data):
        return ()
    return tuple(TenantKind)


def refuse_blank(model: RegisteredModel) -> None:
    licence = model.licence
    texts = [licence.weights, licence.code, licence.source]
    texts += [text for dataset in licence.data for text in (dataset.dataset, dataset.licence)]
    if any(not text.strip() for text in texts):
        raise RegistrationError(f"{model.name} {model.version} has a blank licence field")
    if not licence.data:
        raise RegistrationError(f"{model.name} {model.version} names no training data")


def refuse_inconsistent(model: RegisteredModel) -> None:
    if not model.tasks:
        raise RegistrationError(f"{model.name} {model.version} has no task")
    if not model.makes:
        raise RegistrationError(f"{model.name} {model.version} makes nothing")
    if not model.allowed_tenant_kinds:
        raise RegistrationError(f"{model.name} {model.version} is allowed in no tenant kind")
    if model.input_mpp is not None and model.input_mpp <= 0:
        raise RegistrationError(f"{model.name} {model.version} has a bad input scale")
    if model.calibration_temperatures and ModelTask.TYPER not in model.tasks:
        raise RegistrationError(f"{model.name} {model.version} is calibrated but types nothing")
    if any(temperature <= 0 for temperature in model.calibration_temperatures.values()):
        raise RegistrationError(f"{model.name} {model.version} has a bad temperature")


def register(models: Iterable[RegisteredModel]) -> dict[tuple[str, str], RegisteredModel]:
    registry: dict[tuple[str, str], RegisteredModel] = {}
    for model in models:
        key = (model.name, model.version)
        if key in registry:
            raise RegistrationError(f"{model.name} {model.version} is registered twice")
        refuse_blank(model)
        refuse_inconsistent(model)
        registry[key] = model
    return registry


def temperatures_of(name: str, version: str) -> dict[int, float]:
    return {
        views: calibration.temperature
        for (calibrated, at, views), calibration in CALIBRATIONS.items()
        if (calibrated, at) == (name, version)
    }


PANNUKE = DatasetLicence("PanNuke", "CC BY-NC-SA 4.0", LicenceClass.RESTRICTED)
LIZARD = DatasetLicence("Lizard", "CC BY-NC-SA 4.0", LicenceClass.RESTRICTED)
MONUSEG = DatasetLicence("MoNuSeg", "CC BY-NC-SA 4.0", LicenceClass.RESTRICTED)
CAMELYON16 = DatasetLicence(
    "CAMELYON16",
    "Two primary pages disagree, CC0 and CC BY-NC-ND 4.0",
    LicenceClass.UNCONFIRMED,
)
IMAGENET = DatasetLicence(
    "ImageNet start weights", "For non-commercial use", LicenceClass.RESTRICTED
)
CONSEP = DatasetLicence("CoNSeP", "TODO", LicenceClass.UNCONFIRMED)

EVERY_KIND = tuple(TenantKind)

MODELS: tuple[RegisteredModel, ...] = (
    RegisteredModel(
        name="camelyon-tumor",
        family="monai-pathology-tumor-detection",
        version="v1.0",
        title="CAMELYON tumor model",
        tasks=(ModelTask.TUMOR_MAP,),
        makes=(ModelMakes.REGIONS, ModelMakes.HEATMAP),
        host=ModelHost.PARFOCAL,
        licence=Licence(
            weights="MONAI bundle Apache-2.0, from ImageNet weights for non-commercial use",
            weights_class=LicenceClass.RESTRICTED,
            code="Apache-2.0",
            data=(CAMELYON16, IMAGENET),
            source=ADR_0202,
            read_on=date(2026, 10, 14),
        ),
        allowed_tenant_kinds=EVERY_KIND,
        input_mpp=None,
        status=ModelStatus.CANDIDATE,
    ),
    RegisteredModel(
        name="pathosam-hovernext",
        family="pathosam-hovernext",
        version="v1.2",
        title="PathoSAM + HoVer-NeXt",
        tasks=(ModelTask.DETECTOR, ModelTask.TYPER),
        makes=(ModelMakes.REGIONS, ModelMakes.CELLS),
        host=ModelHost.PARFOCAL,
        licence=Licence(
            weights="PathoSAM TODO, not stated on the repository. HoVer-NeXt CC BY-NC-SA 4.0",
            weights_class=LicenceClass.RESTRICTED,
            code="PathoSAM MIT, HoVer-NeXt GPL-3.0 and no code copied",
            data=(PANNUKE, LIZARD, MONUSEG),
            source=ADR_0202,
            read_on=date(2026, 11, 3),
        ),
        allowed_tenant_kinds=EVERY_KIND,
        input_mpp=PATHOSAM_MPP,
        status=ModelStatus.CANDIDATE,
        evaluation_report=TYPER_CALIBRATION,
        calibration_temperatures=temperatures_of("pathosam-hovernext", "v1.2"),
    ),
    RegisteredModel(
        name="hovernet",
        family="monai-pathology-nuclei-segmentation-classification",
        version="v0.9",
        title="HoVer-Net",
        tasks=(ModelTask.DETECTOR, ModelTask.TYPER),
        makes=(ModelMakes.CELLS,),
        host=ModelHost.PARFOCAL,
        licence=Licence(
            weights="MONAI bundle Apache-2.0, original HoVer-Net weights for non-commercial use",
            weights_class=LicenceClass.RESTRICTED,
            code="Apache-2.0",
            data=(CONSEP,),
            source=ADR_0042,
            read_on=date(2026, 10, 14),
        ),
        allowed_tenant_kinds=EVERY_KIND,
        input_mpp=None,
        status=ModelStatus.RETIRED,
    ),
)

REGISTRY: Mapping[tuple[str, str], RegisteredModel] = register(MODELS)


def registered(name: str, version: str) -> RegisteredModel | None:
    return REGISTRY.get((name, version))


def catalogue_without_registry() -> list[str]:
    return [
        f"{model.name} {model.version}"
        for model in CATALOGUE
        if registered(model.name, model.version) is None
    ]


class DatasetLicenceOut(BaseModel):
    dataset: str
    licence: str
    licence_class: LicenceClass


class LicenceOut(BaseModel):
    weights: str
    weights_class: LicenceClass
    code: str
    data: list[DatasetLicenceOut]
    source: str
    read_on: date
    policy_kinds: list[TenantKind]
    enforced: bool


class RegistryEntry(BaseModel):
    name: str
    family: str
    version: str
    title: str
    tasks: list[ModelTask]
    makes: list[ModelMakes]
    host: ModelHost
    licence: LicenceOut
    allowed_tenant_kinds: list[TenantKind]
    input_mpp: float | None
    calibration_temperatures: dict[int, float]
    evaluation_report: str | None
    status: ModelStatus


class RegisteredModelNotFoundError(NotFoundError):
    code = "registered-model-not-found"
    title = "No registered model has this name and version"


def entry_of(model: RegisteredModel) -> RegistryEntry:
    licence = model.licence
    return RegistryEntry(
        name=model.name,
        family=model.family,
        version=model.version,
        title=model.title,
        tasks=list(model.tasks),
        makes=list(model.makes),
        host=model.host,
        licence=LicenceOut(
            weights=licence.weights,
            weights_class=licence.weights_class,
            code=licence.code,
            data=[
                DatasetLicenceOut(
                    dataset=dataset.dataset,
                    licence=dataset.licence,
                    licence_class=dataset.licence_class,
                )
                for dataset in licence.data
            ],
            source=licence.source,
            read_on=licence.read_on,
            policy_kinds=list(licence_policy_kinds(licence)),
            enforced=LICENCE_ENFORCED,
        ),
        allowed_tenant_kinds=list(model.allowed_tenant_kinds),
        input_mpp=model.input_mpp,
        calibration_temperatures=dict(model.calibration_temperatures),
        evaluation_report=model.evaluation_report,
        status=model.status,
    )


router = APIRouter(prefix="/api/model-registry", tags=["models"])


@router.get("", operation_id="listRegisteredModels")
async def list_registered_models(connection: TenantConnection) -> list[RegistryEntry]:
    return [entry_of(model) for model in REGISTRY.values()]


@router.get("/{name}/{version}", operation_id="getRegisteredModel")
async def get_registered_model(
    name: ModelName, version: ModelVersion, connection: TenantConnection
) -> RegistryEntry:
    model = registered(name, version)
    if model is None:
        raise RegisteredModelNotFoundError(f"{name} {version} is not registered")
    return entry_of(model)
