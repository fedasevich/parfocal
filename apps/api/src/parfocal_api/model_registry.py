import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field, replace
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import insert, select, update
from sqlalchemy.engine import Row
from sqlalchemy.exc import IntegrityError

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, PlatformConnection, TenantConnection
from parfocal_api.model_catalogue import (
    CALIBRATIONS,
    CATALOGUE,
    LicenceClass,
    ModelHost,
    ModelMakes,
    ModelName,
    ModelStatus,
    ModelTask,
    ModelVersion,
)
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.tables import TenantKind, registered_models
from parfocal_common.promotion_gate import gate_model, passed

LICENCE_ENFORCED = False
PATHOSAM_MPP = 0.25
ADR_0042 = "docs/adr/0042-model-licensing-policy.md"
ADR_0202 = "docs/adr/0202-v1-model-line-up-per-tier.md"
TYPER_CALIBRATION = "docs/results/2026-11-04-typer-calibration-registry.md"

type LicenceText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=400)
]
type ModelText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


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
    calibration_temperatures: Mapping[int, float] = field(default_factory=dict[int, float])
    part_of: tuple[str, str] | None = None
    evaluation: Mapping[str, Any] | None = None


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


def makes_nothing_visible(model: RegisteredModel) -> bool:
    return set(model.tasks) == {ModelTask.INTERACTIVE_ENCODER}


def refuse_inconsistent(model: RegisteredModel) -> None:
    if not model.tasks:
        raise RegistrationError(f"{model.name} {model.version} has no task")
    if not model.makes and not makes_nothing_visible(model):
        raise RegistrationError(f"{model.name} {model.version} makes nothing")
    if not model.allowed_tenant_kinds:
        raise RegistrationError(f"{model.name} {model.version} is allowed in no tenant kind")
    if model.input_mpp is not None and model.input_mpp <= 0:
        raise RegistrationError(f"{model.name} {model.version} has a bad input scale")
    if model.calibration_temperatures and ModelTask.TYPER not in model.tasks:
        raise RegistrationError(f"{model.name} {model.version} is calibrated but types nothing")
    if any(temperature <= 0 for temperature in model.calibration_temperatures.values()):
        raise RegistrationError(f"{model.name} {model.version} has a bad temperature")
    if model.part_of == (model.name, model.version):
        raise RegistrationError(f"{model.name} {model.version} is a part of itself")


def register(models: Iterable[RegisteredModel]) -> dict[tuple[str, str], RegisteredModel]:
    registry: dict[tuple[str, str], RegisteredModel] = {}
    for model in models:
        key = (model.name, model.version)
        if key in registry:
            raise RegistrationError(f"{model.name} {model.version} is registered twice")
        refuse_blank(model)
        refuse_inconsistent(model)
        if model.part_of is not None and model.part_of not in registry:
            raise RegistrationError(f"{model.name} {model.version} is a part of an unknown model")
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

PATHOSAM_LICENCE = Licence(
    weights="PathoSAM TODO, not stated on the repository. Non-commercial in practice",
    weights_class=LicenceClass.RESTRICTED,
    code="PathoSAM MIT",
    data=(PANNUKE, LIZARD, MONUSEG),
    source=ADR_0202,
    read_on=date(2026, 11, 3),
)
HOVERNEXT_LICENCE = Licence(
    weights="HoVer-NeXt PanNuke weights CC BY-NC-SA 4.0, Zenodo 10635618, not re-read",
    weights_class=LicenceClass.RESTRICTED,
    code="HoVer-NeXt GPL-3.0 and no code copied",
    data=(PANNUKE,),
    source=ADR_0202,
    read_on=date(2026, 11, 3),
)

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

SHIPPED_IN = ("pathosam-hovernext", "v1.2")


def part(
    name: str,
    title: str,
    tasks: tuple[ModelTask, ...],
    makes: tuple[ModelMakes, ...],
    family: str = "pathosam",
    licence: Licence = PATHOSAM_LICENCE,
) -> RegisteredModel:
    return RegisteredModel(
        name=name,
        family=family,
        version=SHIPPED_IN[1],
        title=title,
        tasks=tasks,
        makes=makes,
        host=ModelHost.PARFOCAL,
        licence=licence,
        allowed_tenant_kinds=EVERY_KIND,
        input_mpp=PATHOSAM_MPP,
        status=ModelStatus.CANDIDATE,
        part_of=SHIPPED_IN,
    )


PARTS: tuple[RegisteredModel, ...] = (
    part(
        "pathosam-vit-l-encoder",
        "PathoSAM ViT-L encoder",
        (ModelTask.INTERACTIVE_ENCODER,),
        (),
    ),
    part(
        "pathosam-vit-b-encoder",
        "PathoSAM ViT-B encoder",
        (ModelTask.INTERACTIVE_ENCODER,),
        (),
    ),
    part(
        "pathosam-vit-l-ais-decoder",
        "PathoSAM ViT-L AIS decoder",
        (ModelTask.DECODER, ModelTask.DETECTOR),
        (ModelMakes.CELLS,),
    ),
    part(
        "pathosam-vit-b-ais-decoder",
        "PathoSAM ViT-B AIS decoder",
        (ModelTask.DECODER, ModelTask.DETECTOR),
        (ModelMakes.CELLS,),
    ),
    part(
        "pathosam-vit-l-prompt-decoder",
        "PathoSAM ViT-L click and box decoder",
        (ModelTask.DECODER,),
        (ModelMakes.REGIONS,),
    ),
    part(
        "pathosam-vit-b-prompt-decoder",
        "PathoSAM ViT-B click and box decoder",
        (ModelTask.DECODER,),
        (ModelMakes.REGIONS,),
    ),
    part(
        "hovernext-pannuke",
        "HoVer-NeXt typer, PanNuke weights",
        (ModelTask.TYPER,),
        (ModelMakes.CELLS,),
        family="hovernext",
        licence=HOVERNEXT_LICENCE,
    ),
)

BUILT_INS: tuple[RegisteredModel, ...] = MODELS + PARTS

REGISTRY: Mapping[tuple[str, str], RegisteredModel] = register(BUILT_INS)


def registered(name: str, version: str) -> RegisteredModel | None:
    return REGISTRY.get((name, version))


def catalogue_without_registry() -> list[str]:
    return [
        f"{model.name} {model.version}"
        for model in CATALOGUE
        if registered(model.name, model.version) is None
    ]


def licence_values(licence: Licence) -> dict[str, Any]:
    return {
        "licence_weights": licence.weights,
        "licence_weights_class": licence.weights_class.value,
        "licence_code": licence.code,
        "licence_data": [
            {
                "dataset": dataset.dataset,
                "licence": dataset.licence,
                "licence_class": dataset.licence_class.value,
            }
            for dataset in licence.data
        ],
        "licence_source": licence.source,
        "licence_read_on": licence.read_on,
    }


def row_of(model: RegisteredModel) -> dict[str, Any]:
    return {
        "name": model.name,
        "version": model.version,
        "family": model.family,
        "title": model.title,
        "tasks": [task.value for task in model.tasks],
        "makes": [made.value for made in model.makes],
        "host": model.host.value,
        **licence_values(model.licence),
        "allowed_tenant_kinds": [kind.value for kind in model.allowed_tenant_kinds],
        "input_mpp": model.input_mpp,
        "status": model.status.value,
        "evaluation_report": model.evaluation_report,
        "calibration_temperatures": {
            str(views): temperature for views, temperature in model.calibration_temperatures.items()
        },
        "part_of_name": model.part_of[0] if model.part_of else None,
        "part_of_version": model.part_of[1] if model.part_of else None,
    }


def seed_rows() -> list[dict[str, Any]]:
    return [row_of(model) for model in BUILT_INS]


def licence_of(row: Row[Any]) -> Licence | None:
    if row.licence_weights is None:
        return None
    return Licence(
        weights=row.licence_weights,
        weights_class=LicenceClass(row.licence_weights_class),
        code=row.licence_code,
        data=tuple(
            DatasetLicence(
                dataset["dataset"], dataset["licence"], LicenceClass(dataset["licence_class"])
            )
            for dataset in row.licence_data
        ),
        source=row.licence_source,
        read_on=row.licence_read_on,
    )


def model_of(row: Row[Any]) -> RegisteredModel:
    licence = licence_of(row)
    assert licence is not None
    return RegisteredModel(
        name=row.name,
        family=row.family,
        version=row.version,
        title=row.title,
        tasks=tuple(ModelTask(task) for task in row.tasks),
        makes=tuple(ModelMakes(made) for made in row.makes),
        host=ModelHost(row.host),
        licence=licence,
        allowed_tenant_kinds=tuple(TenantKind(kind) for kind in row.allowed_tenant_kinds),
        input_mpp=row.input_mpp,
        status=ModelStatus(row.status),
        evaluation_report=row.evaluation_report,
        calibration_temperatures={
            int(views): float(temperature)
            for views, temperature in row.calibration_temperatures.items()
        },
        part_of=(row.part_of_name, row.part_of_version) if row.part_of_name else None,
        evaluation=row.evaluation,
    )


class DatasetLicenceOut(BaseModel):
    dataset: str
    licence: str
    licence_class: LicenceClass


class DatasetLicenceIn(BaseModel):
    dataset: LicenceText
    licence: LicenceText
    licence_class: LicenceClass


class LicenceIn(BaseModel):
    weights: LicenceText
    weights_class: LicenceClass
    code: LicenceText
    data: list[DatasetLicenceIn] = Field(min_length=1, max_length=20)
    source: LicenceText
    read_on: date

    def as_licence(self) -> Licence:
        return Licence(
            weights=self.weights,
            weights_class=self.weights_class,
            code=self.code,
            data=tuple(
                DatasetLicence(dataset.dataset, dataset.licence, dataset.licence_class)
                for dataset in self.data
            ),
            source=self.source,
            read_on=self.read_on,
        )


def licence_in_of(licence: Licence) -> LicenceIn:
    return LicenceIn(
        weights=licence.weights,
        weights_class=licence.weights_class,
        code=licence.code,
        data=[
            DatasetLicenceIn(
                dataset=dataset.dataset,
                licence=dataset.licence,
                licence_class=dataset.licence_class,
            )
            for dataset in licence.data
        ],
        source=licence.source,
        read_on=licence.read_on,
    )


class LicenceOut(BaseModel):
    weights: str
    weights_class: LicenceClass
    code: str
    data: list[DatasetLicenceOut]
    source: str
    read_on: date
    policy_kinds: list[TenantKind]
    enforced: bool


class ModelRef(BaseModel):
    name: ModelName
    version: ModelVersion


class GateReportOut(BaseModel):
    task: str
    benchmark: str
    source: str
    measured: dict[str, float]
    reference: dict[str, float]
    allowed_drop: dict[str, float]
    ceilings: dict[str, float]
    refused: list[str]
    passed: bool


class EvaluationOut(BaseModel):
    passed: bool
    reports: list[GateReportOut]


type MetricName = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,40}$")]
type Metrics = dict[MetricName, float]


class PromotionRequest(BaseModel):
    measured: dict[ModelTask, Metrics] = Field(max_length=len(ModelTask))
    reference: dict[ModelTask, Metrics] | None = Field(default=None, max_length=len(ModelTask))


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
    part_of: ModelRef | None
    evaluation: EvaluationOut | None = None


class RegistrationDraft(BaseModel):
    name: ModelName
    version: ModelVersion
    family: ModelText
    title: ModelText
    tasks: list[ModelTask] = Field(min_length=1, max_length=len(ModelTask))
    makes: list[ModelMakes] = Field(max_length=len(ModelMakes))
    host: ModelHost
    licence: LicenceIn
    allowed_tenant_kinds: list[TenantKind] = Field(min_length=1, max_length=len(TenantKind))
    input_mpp: float | None = None
    calibration_temperatures: dict[int, float] = Field(default_factory=dict[int, float])
    evaluation_report: LicenceText | None = None
    status: ModelStatus = ModelStatus.CANDIDATE
    part_of: ModelRef | None = None

    def as_model(self) -> RegisteredModel:
        return RegisteredModel(
            name=self.name,
            family=self.family,
            version=self.version,
            title=self.title,
            tasks=tuple(dict.fromkeys(self.tasks)),
            makes=tuple(dict.fromkeys(self.makes)),
            host=self.host,
            licence=self.licence.as_licence(),
            allowed_tenant_kinds=tuple(dict.fromkeys(self.allowed_tenant_kinds)),
            input_mpp=self.input_mpp,
            status=self.status,
            evaluation_report=self.evaluation_report,
            calibration_temperatures=dict(self.calibration_temperatures),
            part_of=(self.part_of.name, self.part_of.version) if self.part_of else None,
        )


class RegisteredModelNotFoundError(NotFoundError):
    code = "registered-model-not-found"
    title = "No registered model has this name and version"


class RegistrationRefusedError(BadRequestError):
    code = "registration-refused"
    title = "This model cannot be registered as given"


class OnlyCandidatesPromoteError(ConflictError):
    code = "only-candidates-promote"
    title = "Only a candidate model is promoted through the gate"


class RegisteredModelExistsError(ConflictError):
    code = "registered-model-exists"
    title = "A model with this name and version is already registered"


def licence_out_of(licence: Licence) -> LicenceOut:
    return LicenceOut(
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
    )


def entry_of(model: RegisteredModel) -> RegistryEntry:
    return RegistryEntry(
        name=model.name,
        family=model.family,
        version=model.version,
        title=model.title,
        tasks=list(model.tasks),
        makes=list(model.makes),
        host=model.host,
        licence=licence_out_of(model.licence),
        allowed_tenant_kinds=list(model.allowed_tenant_kinds),
        input_mpp=model.input_mpp,
        calibration_temperatures=dict(model.calibration_temperatures),
        evaluation_report=model.evaluation_report,
        status=model.status,
        part_of=ModelRef(name=model.part_of[0], version=model.part_of[1])
        if model.part_of
        else None,
        evaluation=EvaluationOut.model_validate(model.evaluation) if model.evaluation else None,
    )


router = APIRouter(prefix="/api/model-registry", tags=["models"])
platform_router = APIRouter(prefix="/api/platform/model-registry", tags=["platform"])


@router.get("", operation_id="listRegisteredModels")
async def list_registered_models(connection: TenantConnection) -> list[RegistryEntry]:
    rows = await connection.execute(
        select(registered_models).order_by(registered_models.c.created_at, registered_models.c.name)
    )
    return [entry_of(model_of(row)) for row in rows]


@router.get("/{name}/{version}", operation_id="getRegisteredModel")
async def get_registered_model(
    name: ModelName, version: ModelVersion, connection: TenantConnection
) -> RegistryEntry:
    row = (
        await connection.execute(
            select(registered_models).where(
                registered_models.c.name == name, registered_models.c.version == version
            )
        )
    ).first()
    if row is None:
        raise RegisteredModelNotFoundError(f"{name} {version} is not registered")
    return entry_of(model_of(row))


@platform_router.post("", operation_id="registerModel", status_code=201)
async def register_model(
    draft: RegistrationDraft, principal: CurrentPrincipal, connection: PlatformConnection
) -> RegistryEntry:
    model = draft.as_model()
    try:
        refuse_blank(model)
        refuse_inconsistent(model)
    except RegistrationError as error:
        raise RegistrationRefusedError(str(error)) from error
    if model.part_of is not None:
        parent = await connection.scalar(
            select(registered_models.c.id).where(
                registered_models.c.name == model.part_of[0],
                registered_models.c.version == model.part_of[1],
            )
        )
        if parent is None:
            raise RegistrationRefusedError(
                f"{model.name} {model.version} is a part of an unknown model"
            )
    try:
        async with connection.begin_nested():
            model_id = await connection.scalar(
                insert(registered_models).values(**row_of(model)).returning(registered_models.c.id)
            )
    except IntegrityError as error:
        raise RegisteredModelExistsError from error
    assert isinstance(model_id, uuid.UUID)
    await record(
        connection,
        actor_of(principal),
        AuditAction.MODEL_REGISTERED,
        AuditTarget.REGISTERED_MODEL,
        model_id,
        details={"name": model.name, "version": model.version},
    )
    return entry_of(model)


def metrics_of(
    given: Mapping[ModelTask, Mapping[str, float]],
) -> dict[str, Mapping[str, float]]:
    return {task.value: metrics for task, metrics in given.items()}


@platform_router.post("/{name}/{version}/promotion", operation_id="promoteRegisteredModel")
async def promote_registered_model(
    name: ModelName,
    version: ModelVersion,
    request: PromotionRequest,
    principal: CurrentPrincipal,
    connection: PlatformConnection,
) -> RegistryEntry:
    row = (
        await connection.execute(
            select(registered_models)
            .where(registered_models.c.name == name, registered_models.c.version == version)
            .with_for_update()
        )
    ).first()
    if row is None:
        raise RegisteredModelNotFoundError(f"{name} {version} is not registered")
    model = model_of(row)
    if model.status != ModelStatus.CANDIDATE:
        raise OnlyCandidatesPromoteError(f"{name} {version} is {model.status.value}")
    reports = gate_model(
        [task.value for task in model.tasks],
        metrics_of(request.measured),
        None if request.reference is None else metrics_of(request.reference),
    )
    promoted = passed(reports)
    evaluation = {"passed": promoted, "reports": [report.as_json() for report in reports]}
    status = ModelStatus.VALIDATED if promoted else ModelStatus.CANDIDATE
    await connection.execute(
        update(registered_models)
        .where(registered_models.c.id == row.id)
        .values(evaluation=evaluation, status=status.value)
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.MODEL_EVALUATED,
        AuditTarget.REGISTERED_MODEL,
        row.id,
        details={"name": name, "version": version, "passed": promoted},
    )
    return entry_of(replace(model, status=status, evaluation=evaluation))
