import asyncio
import importlib
import re
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from functools import cache
from typing import Any

import httpx2
import pytest
from db_support import OWNER_URL, ApiAs, query, with_database
from test_tenant_isolation import (
    GET_ROUTES,
    LINK_SITE,
    SQUARE,
    TENANT_ID_TABLES,
    Seeded,
    link_site_serving,
    seed_both,
    upload_key,
)

from parfocal_api.openapi import openapi_schema
from parfocal_common.object_store import StorageLocation

pytestmark = pytest.mark.db

OK = frozenset({200, 201, 202, 204})

type Value = Callable[[Seeded], str]
type Body = Callable[[Seeded], object]

PATH_IDS: dict[str, str] = {
    "slide_id": "slide",
    "case_id": "case",
    "annotation_id": "annotation",
    "project_id": "project",
    "task_id": "task",
    "thread_id": "thread",
    "user_id": "user",
    "tenant_id": "tenant",
    "upload_id": "upload",
    "run_id": "model_run",
    "template_id": "study_template",
    "account_id": "service_account",
    "preset_id": "display_preset",
    "request_id": "access_request",
    "adjudication_id": "adjudication",
    "model_id": "lab_model",
    "result_set_id": "result_set",
    "patient_id": "patient",
    "announcement_id": "announcement",
    "hold_id": "hold",
    "invitation_id": "invitation",
    "token_id": "token",
    "link_id": "link",
    "offer_id": "offer",
    "deposit_id": "deposit",
    "nudge_id": "nudge",
    "reassignment_id": "reassignment",
}

ROW_IDS: dict[str, str] = {
    "announcement": "announcements",
    "hold": "legal_holds",
    "invitation": "invitations",
    "token": "api_tokens",
    "link": "report_links",
    "offer": "template_offers",
    "deposit": "clinical_deposits",
    "nudge": "task_nudges",
    "reassignment": "task_reassignments",
    "class": "project_classes",
}

PROBED_ELSEWHERE: dict[str, tuple[str, str]] = {
    "endSession": ("test_sessions", "test_nobody_ends_someone_elses_session"),
    "joinWorkspace": (
        "test_workspace_access",
        "test_a_person_from_another_domain_cannot_join_or_ask",
    ),
    "askToJoinWorkspace": (
        "test_workspace_access",
        "test_a_person_from_another_domain_cannot_join_or_ask",
    ),
}

CONFLICT = frozenset({409})
FORBIDDEN = frozenset({403})
BAD_REQUEST = frozenset({400})
NO_BROWSER_SESSION = frozenset({401})
REASON = "A second look at the slide"
SHARED_FOLDER = "/shared/"
SHARED_FILE = "scan.svs"
POINT = {"type": "Point", "coordinates": [4, 4]}
LINE = {"type": "LineString", "coordinates": [[0, 0], [5, 5]]}
BLOCKS = [{"title": "Headline", "kind": "headline-numbers", "metrics": ["sensitivity"]}]
DISPLAY = {"draw_as": "fill"}


@dataclass(frozen=True)
class Write:
    body: Body | None = None
    query: Callable[[Seeded], dict[str, str]] | None = None
    path: Mapping[str, Value] = field(default_factory=dict[str, Value])
    admin_rights: bool = False
    refused: int = 404
    owner: frozenset[int] | None = OK
    accepted_because: str = ""
    linked: bool = False


@dataclass(frozen=True)
class Operation:
    method: str
    template: str
    takes_ids: bool


def named(schema: dict[str, Any], components: dict[str, Any]) -> dict[str, Any]:
    reference = schema.get("$ref")
    return components[reference.rsplit("/", 1)[-1]] if isinstance(reference, str) else schema


def holds_an_id(schema: dict[str, Any], components: dict[str, Any], seen: frozenset[str]) -> bool:
    reference = schema.get("$ref")
    if isinstance(reference, str):
        if reference in seen:
            return False
        seen = seen | {reference}
    resolved = named(schema, components)
    if resolved.get("format") == "uuid":
        return True
    parts = [
        *resolved.get("properties", {}).values(),
        *resolved.get("anyOf", []),
        *resolved.get("oneOf", []),
        *resolved.get("allOf", []),
    ]
    for key in ("items", "additionalProperties"):
        if isinstance(resolved.get(key), dict):
            parts.append(resolved[key])
    named_ids = any(name.endswith(("_id", "_ids")) for name in resolved.get("properties", {}))
    return named_ids or any(holds_an_id(part, components, seen) for part in parts)


@cache
def operations() -> dict[str, Operation]:
    schema = openapi_schema()
    components: dict[str, Any] = schema["components"]["schemas"]
    found: dict[str, Operation] = {}
    for template, item in schema["paths"].items():
        for method, operation in item.items():
            parameters = operation.get("parameters", [])
            bodies = [
                content["schema"]
                for content in operation.get("requestBody", {}).get("content", {}).values()
            ]
            takes_ids = any(
                parameter["name"].endswith(("_id", "_ids"))
                or holds_an_id(parameter["schema"], components, frozenset())
                for parameter in parameters
            ) or any(holds_an_id(body, components, frozenset()) for body in bodies)
            found[operation["operationId"]] = Operation(method.upper(), template, takes_ids)
    return found


def seeded(name: str) -> Value:
    return lambda a: str(a.ids[name])


def fixed(value: str) -> Value:
    return lambda _: value


def serve_shared_files() -> None:
    LINK_SITE.index(SHARED_FOLDER, [SHARED_FILE])
    LINK_SITE.file(f"{SHARED_FOLDER}{SHARED_FILE}", b"slide-bytes")


def constant(value: object) -> Body:
    return lambda _: value


def constant_query(**values: str) -> Callable[[Seeded], dict[str, str]]:
    return lambda _: values


def case_slides(a: Seeded) -> list[str]:
    return [str(value) for name, value in sorted(a.ids.items()) if name.startswith("case_slide_")]


PRESETS = {
    "objects_to_check": {"kind": "random-cells", "count": 150},
    "opinion_form": None,
    "blinding": False,
    "first_read": False,
    "start_mode": "viewer",
    "split": "even",
}
LAYOUT = {"paper": "letter", "decimals": 3, "downloads": ["pdf"]}


def template(_: Seeded) -> object:
    return {
        "name": "Second template",
        "study_kind": "regions",
        "blocks": BLOCKS,
        "format": LAYOUT,
        "presets": PRESETS,
    }


def naming(a: Seeded) -> list[object]:
    return [
        {"kind": "slide-figure", "title": "Figure", "slide_id": str(a.ids["slide"])},
        {
            "kind": "comparison",
            "title": "Comparison",
            "metrics": ["sensitivity"],
            "task_id": str(a.ids["task"]),
        },
    ]


def template_naming(a: Seeded) -> object:
    return {
        "name": f"Template of {a.subject}"[:60],
        "study_kind": "regions",
        "blocks": naming(a),
        "format": LAYOUT,
        "presets": PRESETS,
    }


def lab_model(a: Seeded) -> object:
    return {
        "address": LINK_SITE.url("/infer"),
        "sign_in": "none",
        "name": "Second model",
        "version": "1.0",
        "taxonomy": "pannuke",
        "class_map": [],
        "who_can_run": "admins",
        "project_ids": [str(a.ids["project"])],
    }


STORED_AS_TEXT = "the block keeps the id as text and a report looks it up in the caller's workspace"
DRAWN_ON_SAMPLE_DATA = "the preview draws sample data and looks no id up"


def dropped(a: Seeded) -> object:
    return {"project_id": str(a.ids["project"]), "files": [{"path": "case-1/slide.svs"}]}


ON_SLIDE = {"thread_id": seeded("slide_thread")}
ON_ANNOTATE_TASK = {"task_id": seeded("annotate_task")}
SHARED_OBJECT = {**ON_ANNOTATE_TASK, "annotation_id": seeded("shared_object")}
OBJECT = {"object_id": fixed("T1")}
AI_OBJECT = {**ON_ANNOTATE_TASK, **OBJECT}
ANCHOR = {"kind": "point", "geometry": POINT}
THREAD = {"title": "A question", "body": "What is this?", "anchor": ANCHOR}

WRITE_ROUTES: dict[str, Write] = {
    "reorderCaseSlides": Write(body=lambda a: {"slide_ids": case_slides(a)}),
    "changeSlideDetails": Write(body=constant({"stain": "HE"})),
    "createAnnotation": Write(body=constant({"kind": "measurement", "geometry": LINE})),
    "createAnnotations": Write(
        body=constant({"annotations": [{"kind": "measurement", "geometry": LINE}]})
    ),
    "changeAnnotation": Write(body=constant({"version": 1, "geometry": SQUARE})),
    "deleteAnnotation": Write(query=lambda _: {"version": "1"}),
    "restoreAnnotation": Write(body=constant({"version": 1}), owner=CONFLICT),
    "recordSlideCoverage": Write(
        body=constant({"grid": {"cell": 64, "columns": 64, "rows": 32}, "cells": [0, 1]})
    ),
    "moveSlide": Write(
        body=lambda a: {"case_id": str(a.ids["case"]), "reason": "Filed under the wrong case"},
        owner=CONFLICT,
    ),
    "createResultSet": Write(body=constant({"name": "Second run"})),
    "pairResultFiles": Write(body=dropped),
    "createUpload": Write(
        body=lambda a: {
            "filename": "slide.svs",
            "metadata": {"project_id": str(a.ids["project"]), "size": 1024},
        }
    ),
    "abortUpload": Write(query=lambda a: {"key": upload_key(a)}),
    "completeUpload": Write(
        query=lambda a: {"key": upload_key(a)},
        body=constant({"parts": [{"PartNumber": 1, "ETag": "etag"}]}),
        owner=CONFLICT,
    ),
    "sortDroppedFiles": Write(body=dropped),
    "applyDroppedFiles": Write(body=dropped),
    "chooseHowToImport": Write(body=constant({"score_default": "none"}), owner=CONFLICT),
    "leaveResultOut": Write(owner=CONFLICT),
    "pairUploadWithSlide": Write(body=lambda a: {"slide_id": str(a.ids["slide"])}, owner=CONFLICT),
    "updateProject": Write(body=constant({"name": "Renamed"})),
    "deleteProject": Write(body=constant({"name": "Renamed"}), owner=BAD_REQUEST),
    "archiveProject": Write(),
    "importCases": Write(body=constant({"csv": "case\nC-1\n", "dry_run": True})),
    "createCaseReport": Write(owner=CONFLICT),
    "updateCaseReport": Write(body=constant({"comment": "Checked"})),
    "amendCaseReport": Write(
        body=constant({"reason": "A wrong node count", "change": {"nodes_examined": 3}}),
        owner=CONFLICT,
    ),
    "addCaseReportDeposit": Write(
        body=lambda a: {"slide_id": str(a.ids["case_slide_0"])}, owner=CONFLICT
    ),
    "removeCaseReportDeposit": Write(),
    "returnCaseReport": Write(body=constant({"note": "Please look again"})),
    "sendCaseReportForCosign": Write(
        body=lambda a: {"cosigner_user_id": str(a.ids["user"])}, owner=CONFLICT
    ),
    "signCaseReport": Write(body=constant({}), owner=FORBIDDEN),
    "withdrawCaseReport": Write(),
    "rememberClassMappings": Write(
        body=lambda a: {"mappings": [{"source_name": "Tumour", "class_id": str(a.ids["class"])}]}
    ),
    "setProjectClasses": Write(
        body=constant({"classes": [{"key": 1, "name": "Tumour", "colour": "#0055ff"}]}),
        owner=CONFLICT,
    ),
    "requestEmergencyAccess": Write(
        body=constant({"reason": "An urgent second look"}), owner=CONFLICT
    ),
    "importFromLink": Write(
        body=constant({"address": LINK_SITE.url(SHARED_FOLDER), "names": [SHARED_FILE]}),
        linked=True,
    ),
    "setProjectMember": Write(body=constant({"role": "owner"})),
    "removeProjectMember": Write(owner=CONFLICT),
    "setProjectMemberSignOut": Write(body=constant({"sign_out": "own"})),
    "startModelRuns": Write(
        body=lambda a: {
            "slide_ids": [str(a.ids["slide"])],
            "scope": {"kind": "slide"},
            "parameters": {"tier": {"task": "tumor", "tier": "fast"}},
        },
        owner=BAD_REQUEST,
    ),
    "cancelModelRun": Write(),
    "resumeModelRun": Write(owner=CONFLICT),
    "retryModelRun": Write(owner=CONFLICT),
    "publishOpinionForm": Write(
        body=constant({"questions": [{"key": "quality", "label": "Quality", "kind": "scale"}]})
    ),
    "erasePatient": Write(owner=CONFLICT),
    "changeProjectPrivacy": Write(
        body=constant({"privacy_mode": "clinical", "reason": "A clinical study"}), admin_rights=True
    ),
    "restoreProject": Write(),
    "createReviewTask": Write(
        body=lambda a: {
            "name": "Second round",
            "slide_ids": [str(a.ids["slide"])],
            "result_sets": [
                {"slide_id": str(a.ids["slide"]), "result_set_id": str(a.ids["result_set"])}
            ],
            "reviewer_ids": [str(a.ids["user"])],
            "split": "everyone",
            "scope": {"kind": "all-regions"},
        }
    ),
    "createThreadOnSlide": Write(body=constant(THREAD)),
    "deleteThreadOnSlide": Write(path=ON_SLIDE),
    "moveThreadOnSlide": Write(path=ON_SLIDE, body=constant({"geometry": POINT})),
    "replyToThreadOnSlide": Write(path=ON_SLIDE, body=constant({"body": "A reply"})),
    "reopenThreadOnSlide": Write(path=ON_SLIDE),
    "resolveThreadOnSlide": Write(path=ON_SLIDE),
    "undeleteProject": Write(),
    "changeReviewTask": Write(body=constant({"name": "Renamed"})),
    "sendToAdjudicator": Write(
        body=lambda a: {
            "adjudicator_user_id": str(a.ids["user"]),
            "objects": [{"slide_id": str(a.ids["slide"]), "object": "T1"}],
        },
        owner=CONFLICT,
    ),
    "decideDisagreement": Write(path=OBJECT, body=constant({"answer": "agree"}), owner=CONFLICT),
    "clearDisagreementDecision": Write(path=OBJECT),
    "keepReviewerDecisions": Write(path=OBJECT, owner=CONFLICT),
    "leaveDisagreementOpen": Write(path=OBJECT, body=constant({}), owner=CONFLICT),
    "askReviewersToLookAgain": Write(path=OBJECT, body=constant({}), owner=CONFLICT),
    "startEvaluationVersion": Write(
        body=constant({"reason": "A corrected class list"}), owner=CONFLICT
    ),
    "createReportLink": Write(),
    "revokeReportLink": Write(),
    "inviteTaskReviewer": Write(body=constant({"email": "reviewer@example.test"})),
    "chooseMyDisplay": Write(body=constant({"settings": DISPLAY})),
    "nudgeReviewer": Write(
        body=lambda a: {"user_id": str(a.ids["user"]), "message": "Two slides are waiting"}
    ),
    "cancelNudge": Write(),
    "reassignSlides": Write(
        body=lambda a: {"from_user_id": str(a.ids["user"]), "to_user_id": str(a.ids["user"])},
        owner=BAD_REQUEST,
    ),
    "undoReassignment": Write(owner=CONFLICT),
    "reopenReviewTask": Write(body=constant({"reason": "One more slide to read"}), owner=CONFLICT),
    "setTaskReportLayout": Write(body=constant({"blocks": BLOCKS})),
    "addTaskReviewer": Write(body=lambda a: {"user_id": str(a.ids["user"])}, owner=CONFLICT),
    "signOffReviewTask": Write(body=constant({})),
    "addReviewObject": Write(body=constant({"kind": "cell", "geometry": POINT})),
    "checkAnnotateSlide": Write(path=ON_ANNOTATE_TASK, body=constant({}), owner=FORBIDDEN),
    "saveReviewEdit": Write(path=OBJECT, body=constant({"deleted": True})),
    "clearReviewEdit": Write(path=OBJECT),
    "splitReviewObject": Write(
        path=OBJECT,
        body=constant({"parts": [{"geometry": SQUARE}, {"geometry": SQUARE}]}),
        owner=CONFLICT,
    ),
    "submitFirstRead": Write(owner=CONFLICT),
    "mergeReviewObjects": Write(
        body=constant({"objects": ["T1", "T2"], "geometry": SQUARE}), owner=CONFLICT
    ),
    "saveOpinion": Write(body=constant({"answers": {}}), owner=CONFLICT),
    "reopenSlideReview": Write(),
    "addRunToTaskSlide": Write(
        path=ON_ANNOTATE_TASK,
        body=lambda a: {"result_set_id": str(a.ids["result_set"])},
        owner=BAD_REQUEST,
    ),
    "changeAiObject": Write(
        path=AI_OBJECT,
        body=constant({"deleted": True}),
        query=constant_query(reason=REASON),
        owner=BAD_REQUEST,
    ),
    "confirmAiObject": Write(
        path=AI_OBJECT, body=constant({}), query=constant_query(reason=REASON), owner=BAD_REQUEST
    ),
    "undoAiConfirm": Write(
        path=AI_OBJECT, query=constant_query(version="1", reason=REASON), owner=BAD_REQUEST
    ),
    "importSharedObjects": Write(
        path=ON_ANNOTATE_TASK,
        body=constant(
            {"file_name": "marks.geojson", "content": {"type": "FeatureCollection", "features": []}}
        ),
        query=constant_query(reason=REASON),
        owner=BAD_REQUEST,
    ),
    "createSharedObject": Write(
        path=ON_ANNOTATE_TASK,
        body=constant({"kind": "measurement", "geometry": LINE}),
        query=constant_query(reason=REASON),
    ),
    "changeSharedObject": Write(
        path=SHARED_OBJECT,
        body=constant({"version": 1, "geometry": SQUARE}),
        query=constant_query(reason=REASON),
    ),
    "deleteSharedObject": Write(
        path=SHARED_OBJECT, query=constant_query(version="1", reason=REASON)
    ),
    "signOffAnnotateSlide": Write(path=ON_ANNOTATE_TASK, owner=CONFLICT),
    "startPatchExport": Write(path=ON_ANNOTATE_TASK, body=constant({})),
    "skipObject": Write(path=OBJECT, body=constant({}), owner=CONFLICT),
    "clearSkip": Write(path=OBJECT),
    "submitSlideReview": Write(owner=CONFLICT),
    "createThread": Write(body=constant(THREAD)),
    "deleteThread": Write(),
    "moveThread": Write(body=constant({"geometry": POINT})),
    "replyToThread": Write(body=constant({"body": "A reply"})),
    "reopenThread": Write(),
    "resolveThread": Write(),
    "uncheckAnnotateSlide": Write(path=ON_ANNOTATE_TASK, owner=FORBIDDEN),
    "saveDecision": Write(path=OBJECT, body=constant({"answer": "1"})),
    "clearDecision": Write(path=OBJECT),
    "declineAdjudication": Write(body=constant({})),
    "decideAsAdjudicator": Write(path=OBJECT, body=constant({"answer": "1"})),
    "endAnnouncement": Write(admin_rights=True),
    "saveDisplayPreset": Write(
        body=lambda a: {"name": "Mine", "task_id": str(a.ids["task"]), "settings": DISPLAY},
        refused=400,
    ),
    "changeDisplayPreset": Write(body=constant({"name": "Renamed"})),
    "deleteDisplayPreset": Write(),
    "muteNotifications": Write(path={"subject": fixed("task"), "subject_id": seeded("task")}),
    "unmuteNotifications": Write(
        path={"subject": fixed("task"), "subject_id": seeded("muted")},
        refused=200,
        accepted_because="it takes away only a mute of the caller's own",
    ),
    "markNotificationsRead": Write(
        body=lambda a: {"ids": [str(a.ids["notification"])]},
        refused=200,
        accepted_because="an id of another workspace matches no row and is skipped",
    ),
    "setMyResume": Write(
        body=lambda a: {
            "task_id": str(a.ids["task"]),
            "slide_id": str(a.ids["slide"]),
            "mode": "viewer",
        }
    ),
    "switchWorkspace": Write(
        body=lambda a: {"tenant_id": str(a.tenant_id)}, refused=403, owner=NO_BROWSER_SESSION
    ),
    "createTenant": Write(
        body=lambda a: {
            "organisation_id": str(a.ids["organisation"]),
            "slug": "another-lab",
            "name": "Another lab",
            "kind": "research",
            "region": "eu",
        },
        refused=403,
        owner=None,
    ),
    "invitePlatformMember": Write(
        body=constant({"role": "reviewer", "email": "reviewer@example.test"}),
        refused=403,
        owner=None,
    ),
    "addMember": Write(
        body=lambda a: {"role": "reviewer", "user_id": str(a.ids["user"])},
        refused=403,
        owner=None,
    ),
    "reactivateTenant": Write(admin_rights=True, refused=403, owner=None),
    "suspendTenant": Write(admin_rights=True, refused=403, owner=None),
    "erasePerson": Write(admin_rights=True, refused=403, owner=None),
    "deleteResultSet": Write(query=constant_query(confirm="true")),
    "editStudyTemplate": Write(body=template, admin_rights=True),
    "restoreStudyTemplate": Write(admin_rights=True),
    "retireStudyTemplate": Write(admin_rights=True),
    "acceptTemplateOffer": Write(admin_rights=True),
    "declineTemplateOffer": Write(admin_rights=True),
    "declineWorkspaceAccessRequest": Write(admin_rights=True),
    "approveWorkspaceAccessRequest": Write(admin_rights=True),
    "revokeInvitation": Write(admin_rights=True),
    "resendInvitation": Write(admin_rights=True),
    "placeLegalHold": Write(
        body=lambda a: {"project_id": str(a.ids["project"]), "reason": "A dispute"},
        admin_rights=True,
    ),
    "releaseLegalHold": Write(admin_rights=True),
    "setMemberAdminRights": Write(body=constant({"admin_rights": True}), admin_rights=True),
    "changeMemberRole": Write(
        body=constant({"role": "reviewer"}), admin_rights=True, owner=CONFLICT
    ),
    "testConnectedLabModel": Write(admin_rights=True, owner=BAD_REQUEST),
    "disableServiceAccount": Write(admin_rights=True),
    "issueApiToken": Write(body=constant({}), admin_rights=True),
    "revokeApiToken": Write(admin_rights=True),
    "createCase": Write(body=lambda a: {"project_id": str(a.ids["project"]), "label": "C-2"}),
    "connectLabModel": Write(body=lab_model, admin_rights=True, refused=400, linked=True),
    "createStudyTemplate": Write(
        body=template_naming, admin_rights=True, refused=201, accepted_because=STORED_AS_TEXT
    ),
    "offerStudyTemplate": Write(
        body=template_naming,
        admin_rights=True,
        refused=201,
        owner=None,
        accepted_because=STORED_AS_TEXT,
    ),
    "previewStudyTemplate": Write(
        body=lambda a: {"name": "Preview", "blocks": naming(a)},
        admin_rights=True,
        refused=200,
        owner=None,
        accepted_because=DRAWN_ON_SAMPLE_DATA,
    ),
    "downloadStudyTemplatePreview": Write(
        body=lambda a: {"name": "Preview", "blocks": naming(a)},
        admin_rights=True,
        refused=200,
        owner=None,
        accepted_because=DRAWN_ON_SAMPLE_DATA,
    ),
}

UNAIMED_WRITES: dict[str, str] = {
    "createProject": "makes a project in the caller's workspace",
    "createSampleProject": "makes the sample project in the caller's workspace",
    **dict.fromkeys(
        ("createAccount", "confirmEmail", "resendEmailCode", "signInWithPassword"),
        "answers the anonymous caller about their own account and names no other row",
    ),
    "recordActivity": "stamps the caller's own session",
    "endOtherSessions": "ends the caller's own other sessions",
    "sendFeedback": "files feedback under the caller's workspace",
    "acceptInvitation": "takes a secret token, which is the invitation itself",
    "updateMe": "changes the caller's own profile",
    "setMyAvailability": "changes the caller's own availability",
    "setMyEmailSchedule": "changes the caller's own mail schedule",
    "setNotificationPreferences": "changes the caller's own preferences",
    "setMySettingLayers": "changes the caller's own settings",
    "createMyWorkspace": "makes a workspace for the caller",
    "createOrganisation": "makes an organisation and names no other row",
    "validateResultsFile": "checks a file and stores nothing",
    "recordSiteValidation": "stores a validation in the caller's workspace",
    "createAnnouncement": "posts in the caller's workspace",
    "createInvitation": "invites into the caller's workspace",
    "setJoinSettings": "changes the caller's workspace",
    "setRetentionPolicy": "changes the caller's workspace",
    "setSecurityContact": "changes the caller's workspace",
    "createServiceAccount": "makes an account in the caller's workspace",
    "updateSessionPolicy": "changes the caller's workspace",
    "setWorkspaceSettings": "changes the caller's workspace",
    "testLabModel": "calls an address and stores nothing",
    "hideModel": "hides a model name in the caller's workspace",
    "showModel": "shows a model name in the caller's workspace",
    "setModelTier": "sets a tier in the caller's workspace",
    "resetModelTier": "resets a tier in the caller's workspace",
}


def path_of(operation: str, route: Write, a: Seeded) -> str:
    def value(match: re.Match[str]) -> str:
        name = match.group(1)
        if name in route.path:
            return route.path[name](a)
        return str(a.ids[PATH_IDS[name]])

    return re.sub(r"\{(\w+)\}", value, operations()[operation].template)


def sent(client: httpx2.Client, operation: str, route: Write, a: Seeded) -> httpx2.Response:
    return client.request(
        operations()[operation].method,
        path_of(operation, route, a),
        params=route.query(a) if route.query else None,
        json=route.body(a) if route.body else None,
    )


def with_row_ids(database: str, a: Seeded) -> Seeded:
    select = "(SELECT '{name}', id::text FROM {table} WHERE tenant_id = '{tenant}' LIMIT 1)"
    selects = [
        select.format(name=name, table=table, tenant=a.tenant_id) for name, table in ROW_IDS.items()
    ]
    selects.append(
        "(SELECT 'case_slide_' || (row_number() OVER (ORDER BY id) - 1), id::text "
        f"FROM slides WHERE case_id = '{a.ids['case']}')"
    )
    selects.append(
        "(SELECT 'muted', subject_id::text FROM notification_mutes "
        f"WHERE tenant_id = '{a.tenant_id}' LIMIT 1)"
    )
    rows = query(with_database(OWNER_URL, database), " UNION ALL ".join(selects))
    a.ids.update({str(name): uuid.UUID(str(value)) for name, value in rows})
    return a


@cache
def tenant_tables(database: str) -> tuple[str, ...]:
    return tuple(str(row[0]) for row in query(with_database(OWNER_URL, database), TENANT_ID_TABLES))


def rows_of(database: str, a: Seeded) -> dict[str, str]:
    digest = (
        "SELECT '{table}', count(*) || ' rows ' || "
        "md5(coalesce(string_agg(md5(r::text), '' ORDER BY md5(r::text)), '')) "
        "FROM {table} r WHERE {column} = '{value}'"
    )
    selects = [
        digest.format(table=table, column="tenant_id", value=a.tenant_id)
        for table in tenant_tables(database)
    ]
    selects.append(digest.format(table="tenants", column="id", value=a.tenant_id))
    selects.append(digest.format(table="users", column="id", value=a.ids["user"]))
    rows = query(with_database(OWNER_URL, database), " UNION ALL ".join(selects))
    return {str(table): str(state) for table, state in rows}


def test_every_operation_of_every_method_is_in_the_suite() -> None:
    assert set(GET_ROUTES).isdisjoint(WRITE_ROUTES)
    assert set(WRITE_ROUTES).isdisjoint(UNAIMED_WRITES)
    assert set(PROBED_ELSEWHERE).isdisjoint(set(WRITE_ROUTES) | set(UNAIMED_WRITES))
    assert set(operations()) == (
        set(GET_ROUTES) | set(WRITE_ROUTES) | set(UNAIMED_WRITES) | set(PROBED_ELSEWHERE)
    )


@pytest.mark.parametrize("operation", sorted(PROBED_ELSEWHERE))
def test_a_write_probed_in_another_file_names_a_test_that_exists(operation: str) -> None:
    module, name = PROBED_ELSEWHERE[operation]
    assert callable(getattr(importlib.import_module(module), name))


def test_a_write_the_other_workspace_may_send_says_why() -> None:
    accepted = {name for name, route in WRITE_ROUTES.items() if route.refused in OK}
    assert accepted == {name for name, route in WRITE_ROUTES.items() if route.accepted_because}


def test_only_a_write_that_takes_no_id_goes_unprobed() -> None:
    assert [name for name in UNAIMED_WRITES if operations()[name].takes_ids] == []


@pytest.mark.parametrize("operation", sorted(WRITE_ROUTES))
def test_a_write_aimed_at_another_workspace_is_refused_and_its_owner_is_not(
    api: ApiAs,
    database: str,
    storage: StorageLocation,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    assert storage.bucket
    a, b = asyncio.run(seed_both(database))
    a = with_row_ids(database, a)
    route = WRITE_ROUTES[operation]
    if route.linked:
        link_site_serving()
        serve_shared_files()
        trusted = api.app.settings.model_copy(update={"link_trusted_origins": [LINK_SITE.origin]})
        monkeypatch.setattr(api.app, "settings", trusted)
    before = rows_of(database, a)
    refused = sent(api(b.member(route.admin_rights)), operation, route, a)
    assert refused.status_code == route.refused, f"other {refused.status_code} {refused.text[:200]}"
    after = rows_of(database, a)
    assert {table: state for table, state in after.items() if before[table] != state} == {}
    if route.owner is None:
        return
    accepted = sent(api(a.member(route.admin_rights)), operation, route, a)
    assert accepted.status_code in route.owner, (
        f"owner {accepted.status_code} {accepted.text[:200]}"
    )
    if accepted.status_code == refused.status_code:
        assert rows_of(database, a) != before


def carried(route: Write, of: Seeded) -> tuple[object, object]:
    return (route.body(of) if route.body else None, route.query(of) if route.query else None)


def tail_of(operation: str, route: Write, a: Seeded, b: Seeded) -> str:
    kept = operations()[operation].template.split("}", 1)[0].count("/") + 1
    mine = path_of(operation, route, b).split("/")
    theirs = path_of(operation, route, a).split("/")
    return "/".join([*mine[:kept], *theirs[kept:]])


MIXES = ("body", "tail")


@pytest.mark.parametrize("mix", MIXES)
@pytest.mark.parametrize("operation", sorted(WRITE_ROUTES))
def test_a_write_on_my_own_path_that_carries_an_id_of_another_workspace_is_refused(
    api: ApiAs,
    database: str,
    storage: StorageLocation,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
    mix: str,
) -> None:
    assert storage.bucket
    route = WRITE_ROUTES[operation]
    template = operations()[operation].template
    if template.count("{") < (1 if mix == "body" else 2) or route.accepted_because:
        pytest.skip("has no path of its own to mix")
    a, b = asyncio.run(seed_both(database))
    a, b = with_row_ids(database, a), with_row_ids(database, b)
    if mix == "body" and carried(route, a) == carried(route, b):
        pytest.skip("carries no id")
    if route.linked:
        link_site_serving()
        serve_shared_files()
        trusted = api.app.settings.model_copy(update={"link_trusted_origins": [LINK_SITE.origin]})
        monkeypatch.setattr(api.app, "settings", trusted)
    before = rows_of(database, a), rows_of(database, b)
    of_body = a if mix == "body" else b
    path = path_of(operation, route, b) if mix == "body" else tail_of(operation, route, a, b)
    answer = api(b.member(route.admin_rights)).request(
        operations()[operation].method,
        path,
        params=route.query(of_body) if route.query else None,
        json=route.body(of_body) if route.body else None,
    )
    changed_a = rows_of(database, a) != before[0]
    changed_b = rows_of(database, b) != before[1]
    assert (400 <= answer.status_code < 500, changed_a, changed_b) == (True, False, False), (
        f"{mix} {answer.status_code} a={changed_a} b={changed_b} {path} {answer.text[:160]}"
    )
