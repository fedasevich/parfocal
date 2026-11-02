import uuid
from dataclasses import dataclass
from enum import StrEnum
from typing import Annotated

from fastapi import APIRouter
from pydantic import AfterValidator, BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.case_creation import (
    CaseLabelTakenError,
    creator_of,
    not_the_loose_case,
    privacy_of,
    require_owner,
)
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import BadRequestError
from parfocal_api.projects import visible
from parfocal_api.result_pairing import (
    MAX_FILES,
    DroppedFile,
    PairedSlide,
    ResultPairing,
    existing_slides,
    slide_of,
)
from parfocal_api.result_sets import require_uploading
from parfocal_api.slide_ingest import label_of
from parfocal_api.tables import CaseSource, cases, slides
from parfocal_api.uploads import paired_slide
from parfocal_common.pairing import (
    Certainty,
    FileKind,
    Outcome,
    PairBy,
    ResultFile,
    Rule,
    SlideCandidate,
    embedded_hint,
    kind_of,
    pair_results,
)
from parfocal_common.sorting import CaseGuess, CaseRule, CasesFrom, sort_slides

type CaseLabel = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    AfterValidator(not_the_loose_case),
]


class SortedFile(DroppedFile):
    size: Annotated[int, Field(ge=1)] | None = None


class SlideDecision(BaseModel):
    path: str
    case: CaseLabel | None = None
    loose: bool = False
    keep: bool | None = None

    @model_validator(mode="after")
    def case_or_loose(self) -> SlideDecision:
        if self.case is not None and self.loose:
            raise ValueError("A slide goes to a case or stays loose, not both")
        return self


class ResultDecision(BaseModel):
    path: str
    slide_path: str | None = None
    slide_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def one_slide(self) -> ResultDecision:
        if self.slide_path is not None and self.slide_id is not None:
            raise ValueError("Name a dropped slide or a slide in the project, not both")
        return self


class SortingRequest(BaseModel):
    project_id: uuid.UUID
    cases: CasesFrom = CasesFrom.NAMES
    by: PairBy = PairBy.AUTO
    files: Annotated[list[SortedFile], Field(min_length=1, max_length=MAX_FILES)]
    slide_decisions: Annotated[list[SlideDecision], Field(max_length=MAX_FILES)] = []
    result_decisions: Annotated[list[ResultDecision], Field(max_length=MAX_FILES)] = []


class SlideOutcome(StrEnum):
    IN_CASE = "in-case"
    LOOSE = "loose"
    LEFT_OUT = "left-out"


class SortedCase(BaseModel):
    label: str
    case_id: uuid.UUID | None


class SortedSlide(BaseModel):
    path: str
    outcome: SlideOutcome
    case: SortedCase | None
    rule: CaseRule | None
    duplicate_of: uuid.UUID | None


class Sorting(BaseModel):
    slides: list[SortedSlide]
    results: list[ResultPairing]
    others: list[str]
    new_cases: list[str]


class NotADroppedSlideError(BadRequestError):
    code = "not-a-dropped-slide"
    title = "A result can only go to a slide in this drop that is kept, or to a project slide"


class NotADroppedFileError(BadRequestError):
    code = "not-a-dropped-file"
    title = "A decision names a file that is not in this drop"


@dataclass
class Draft:
    project_id: uuid.UUID
    tenant_id: uuid.UUID
    slides: list[SortedSlide]
    results: list[ResultPairing]
    others: list[str]


router = APIRouter(prefix="/api/uploads", tags=["uploads"])


def guesses_of(
    request: SortingRequest, slide_paths: list[str], all_paths: list[str]
) -> dict[str, CaseGuess | None]:
    guesses = sort_slides(slide_paths, all_paths, request.cases)
    for decision in request.slide_decisions:
        if decision.case is not None:
            guesses[decision.path] = CaseGuess(decision.case, CaseRule.PICKED)
        elif decision.loose:
            guesses[decision.path] = None
    return guesses


async def case_ids(
    connection: AsyncConnection, project_id: uuid.UUID, labels: set[str]
) -> dict[str, uuid.UUID]:
    if not labels:
        return {}
    rows = await connection.execute(
        select(cases.c.label, cases.c.id).where(
            cases.c.project_id == project_id,
            cases.c.label.in_(labels),
            cases.c.deleted_at.is_(None),
        )
    )
    return {row.label: row.id for row in rows}


async def duplicates(
    connection: AsyncConnection,
    project_id: uuid.UUID,
    places: dict[str, uuid.UUID | None],
    sizes: dict[str, int | None],
) -> dict[str, uuid.UUID]:
    labels = {label_of(path) for path in places}
    if not labels:
        return {}
    rows = await connection.execute(
        select(slides.c.id, slides.c.case_id, slides.c.label, slides.c.file_bytes).where(
            slides.c.project_id == project_id,
            slides.c.label.in_(labels),
            slides.c.deleted_at.is_(None),
        )
    )
    held = {(row.case_id, row.label): row for row in rows}
    found: dict[str, uuid.UUID] = {}
    for path, case_id in places.items():
        row = held.get((case_id, label_of(path)))
        if row is None:
            continue
        size = sizes.get(path)
        if size is not None and row.file_bytes is not None and size != row.file_bytes:
            continue
        found[path] = row.id
    return found


def sorted_slide(
    path: str, guess: CaseGuess | None, known: dict[str, uuid.UUID], copy: uuid.UUID | None
) -> SortedSlide:
    case = SortedCase(label=guess.label, case_id=known.get(guess.label)) if guess else None
    return SortedSlide(
        path=path,
        outcome=SlideOutcome.IN_CASE if guess else SlideOutcome.LOOSE,
        case=case,
        rule=guess.rule if guess else None,
        duplicate_of=copy,
    )


async def draft_of(
    connection: AsyncConnection, principal: Principal, request: SortingRequest
) -> Draft:
    project = await visible(connection, principal, request.project_id)
    await require_uploading(connection, principal, project.id, project.archived_at is not None)
    kinds = {item.path: item.kind or kind_of(item.path) for item in request.files}
    slide_paths = [path for path, kind in kinds.items() if kind is FileKind.SLIDE]
    named = {decision.path for decision in request.slide_decisions} | {
        decision.path for decision in request.result_decisions
    }
    if not named <= kinds.keys():
        raise NotADroppedFileError
    guesses = guesses_of(request, slide_paths, list(kinds))
    known = await case_ids(
        connection, project.id, {guess.label for guess in guesses.values() if guess is not None}
    )
    places = {
        path: known.get(guess.label) if guess is not None else None
        for path, guess in guesses.items()
        if guess is None or guess.label in known
    }
    sizes = {item.path: item.size for item in request.files}
    copies = await duplicates(connection, project.id, places, sizes)
    keep = {decision.path: decision.keep for decision in request.slide_decisions}
    sorted_slides: list[SortedSlide] = []
    for path in slide_paths:
        entry = sorted_slide(path, guesses[path], known, copies.get(path))
        wanted = keep.get(path)
        if wanted is False or (wanted is None and entry.duplicate_of is not None):
            entry.outcome = SlideOutcome.LEFT_OUT
        sorted_slides.append(entry)
    kept = [entry.path for entry in sorted_slides if entry.outcome is not SlideOutcome.LEFT_OUT]
    candidates = [
        *(SlideCandidate(key=path, name=path, path=path) for path in kept),
        *await existing_slides(connection, project.id, None),
    ]
    results = [
        ResultFile(item.path, embedded_hint(item.head, item.path) if item.head else None)
        for item in request.files
        if kinds[item.path] is FileKind.RESULT
    ]
    pairings = [
        ResultPairing(
            path=pairing.path,
            outcome=pairing.outcome,
            slide=slide_of(pairing.slide) if pairing.slide is not None else None,
            rule=pairing.rule,
            certainty=pairing.certainty,
            candidates=[slide_of(key) for key in pairing.candidates],
        )
        for pairing in pair_results(results, candidates, request.by)
    ]
    return Draft(
        project_id=project.id,
        tenant_id=project.tenant_id,
        slides=sorted_slides,
        results=pairings,
        others=[path for path, kind in kinds.items() if kind is FileKind.OTHER],
    )


async def picked_slide(
    connection: AsyncConnection, draft: Draft, decision: ResultDecision
) -> PairedSlide | None:
    if decision.slide_id is not None:
        await paired_slide(connection, draft.project_id, decision.slide_id)
        return PairedSlide(path=None, slide_id=decision.slide_id)
    if decision.slide_path is None:
        return None
    kept = {entry.path for entry in draft.slides if entry.outcome is not SlideOutcome.LEFT_OUT}
    if decision.slide_path not in kept:
        raise NotADroppedSlideError
    return PairedSlide(path=decision.slide_path, slide_id=None)


async def decide_results(
    connection: AsyncConnection, draft: Draft, decisions: list[ResultDecision]
) -> list[ResultPairing]:
    chosen = {decision.path: decision for decision in decisions}
    decided: list[ResultPairing] = []
    for pairing in draft.results:
        decision = chosen.get(pairing.path)
        if decision is None:
            decided.append(pairing)
            continue
        slide = await picked_slide(connection, draft, decision)
        decided.append(
            ResultPairing(
                path=pairing.path,
                outcome=Outcome.PAIRED if slide else Outcome.UNMATCHED,
                slide=slide,
                rule=Rule.PICKED if slide else None,
                certainty=Certainty.SURE if slide else None,
                candidates=[],
            )
        )
    return decided


def missing_cases(draft: Draft) -> list[str]:
    return sorted(
        {
            entry.case.label
            for entry in draft.slides
            if entry.case is not None
            and entry.case.case_id is None
            and entry.outcome is not SlideOutcome.LEFT_OUT
        }
    )


async def sorting_of(connection: AsyncConnection, draft: Draft, request: SortingRequest) -> Sorting:
    return Sorting(
        slides=draft.slides,
        results=await decide_results(connection, draft, request.result_decisions),
        others=draft.others,
        new_cases=missing_cases(draft),
    )


async def create_cases(
    connection: AsyncConnection, principal: Principal, draft: Draft, labels: list[str]
) -> dict[str, uuid.UUID]:
    creator = creator_of(principal)
    await require_owner(connection, principal, draft.project_id)
    mode = await privacy_of(connection, draft.project_id)
    created = {label: uuid.uuid4() for label in labels}
    try:
        async with connection.begin_nested():
            await connection.execute(
                insert(cases),
                [
                    {
                        "id": case_id,
                        "tenant_id": draft.tenant_id,
                        "project_id": draft.project_id,
                        "label": label,
                        "source": CaseSource.UPLOAD,
                        "created_by_user_id": creator.user_id,
                    }
                    for label, case_id in created.items()
                ],
            )
    except IntegrityError as error:
        raise CaseLabelTakenError from error
    for case_id in created.values():
        await record(
            connection,
            actor_of(principal),
            AuditAction.CASE_CREATED,
            AuditTarget.CASE,
            case_id,
            tenant_id=draft.tenant_id,
            details={
                "source": CaseSource.UPLOAD,
                "privacy_mode": mode,
                "new_patient": False,
                "specimens": 0,
            },
        )
    return created


def placed(draft: Draft, created: dict[str, uuid.UUID]) -> None:
    for entry in draft.slides:
        if entry.case is not None and entry.case.case_id is None:
            entry.case.case_id = created.get(entry.case.label)


@router.post(
    "/sorting",
    operation_id="sortDroppedFiles",
    **require(Permission.UPLOAD_SLIDES, write=True),
)
async def sort_dropped_files(
    request: SortingRequest, principal: CurrentPrincipal, connection: TenantConnection
) -> Sorting:
    draft = await draft_of(connection, principal, request)
    return await sorting_of(connection, draft, request)


@router.post(
    "/sorting/apply",
    operation_id="applyDroppedFiles",
    **require(Permission.UPLOAD_SLIDES, write=True),
)
async def apply_dropped_files(
    request: SortingRequest, principal: CurrentPrincipal, connection: TenantConnection
) -> Sorting:
    draft = await draft_of(connection, principal, request)
    labels = missing_cases(draft)
    created: dict[str, uuid.UUID] = (
        await create_cases(connection, principal, draft, labels) if labels else {}
    )
    placed(draft, created)
    sorting = await sorting_of(connection, draft, request)
    return sorting.model_copy(update={"new_cases": labels})
