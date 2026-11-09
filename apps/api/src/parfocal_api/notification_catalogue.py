from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from parfocal_api.tables import NotificationKind


@dataclass(frozen=True)
class Channels:
    in_app: bool
    email: bool
    realtime: bool


class TargetKind(StrEnum):
    SLIDE = "slide"
    THREAD = "thread"
    DECISION = "decision"
    TASK = "task"
    EVALUATION = "evaluation"
    JOB = "job"
    DELIVERY = "delivery"
    PROJECT = "project"
    ACCESS_REQUEST = "access-request"
    TEMPLATE_OFFER = "template-offer"


@dataclass(frozen=True)
class Entry:
    target: TargetKind
    subject: str
    line: str
    channels: Channels
    breaks_mute: bool = field(kw_only=True)


ALL = Channels(in_app=True, email=True, realtime=True)
QUIET = Channels(in_app=True, email=False, realtime=True)

CATALOGUE: Mapping[NotificationKind, Entry] = {
    NotificationKind.MENTION: Entry(
        TargetKind.THREAD,
        "You were mentioned",
        "Someone mentioned you in a thread.",
        ALL,
        breaks_mute=True,
    ),
    NotificationKind.REPLY: Entry(
        TargetKind.THREAD,
        "New reply",
        "There is a new reply in a thread you follow.",
        QUIET,
        breaks_mute=False,
    ),
    NotificationKind.TASK_ASSIGNED: Entry(
        TargetKind.TASK,
        "New review task",
        "A review task was handed to you.",
        ALL,
        breaks_mute=True,
    ),
    NotificationKind.TASK_DUE_SOON: Entry(
        TargetKind.TASK,
        "Review task due soon",
        "A review task of yours is due soon.",
        ALL,
        breaks_mute=True,
    ),
    NotificationKind.TASK_NUDGED: Entry(
        TargetKind.TASK,
        "A note about your review task",
        "The researcher sent you a note about a review task.",
        ALL,
        breaks_mute=True,
    ),
    NotificationKind.TASK_REASSIGNED: Entry(
        TargetKind.TASK,
        "Review slides moved",
        "Slides of a review task moved between reviewers.",
        ALL,
        breaks_mute=True,
    ),
    NotificationKind.TASK_DUE_CHANGED: Entry(
        TargetKind.TASK,
        "Review task due date changed",
        "The due date of a review task of yours changed.",
        ALL,
        breaks_mute=False,
    ),
    NotificationKind.MODEL_RUN_FINISHED: Entry(
        TargetKind.JOB,
        "Model run finished",
        "A model run you started has finished.",
        QUIET,
        breaks_mute=False,
    ),
    NotificationKind.MODEL_RUN_PAUSED: Entry(
        TargetKind.JOB,
        "Model run paused",
        "A model run you started is paused.",
        ALL,
        breaks_mute=False,
    ),
    NotificationKind.UPLOAD_DONE: Entry(
        TargetKind.JOB,
        "Upload done",
        "Your upload has been checked and is ready.",
        QUIET,
        breaks_mute=False,
    ),
    NotificationKind.UPLOAD_REFUSED: Entry(
        TargetKind.JOB,
        "Upload refused",
        "A file you uploaded was refused. Open it to see why.",
        QUIET,
        breaks_mute=False,
    ),
    NotificationKind.DISAGREEMENTS_READY: Entry(
        TargetKind.TASK,
        "Disagreements to decide",
        "Every reviewer has submitted and some objects need your decision.",
        ALL,
        breaks_mute=False,
    ),
    NotificationKind.TASK_SIGNED_OFF: Entry(
        TargetKind.EVALUATION,
        "Task signed off",
        "A review task was signed off.",
        ALL,
        breaks_mute=False,
    ),
    NotificationKind.RESULT_SET_ADDED: Entry(
        TargetKind.SLIDE,
        "Results added",
        "A pipeline added AI results to a slide.",
        QUIET,
        breaks_mute=False,
    ),
    NotificationKind.SLIDE_MOVED: Entry(
        TargetKind.SLIDE,
        "Slide moved",
        "A slide in one of your tasks moved to another case.",
        QUIET,
        breaks_mute=False,
    ),
    NotificationKind.ADJUDICATION_REQUESTED: Entry(
        TargetKind.TASK,
        "Objects to adjudicate",
        "A researcher asked you to decide some queued objects.",
        ALL,
        breaks_mute=True,
    ),
    NotificationKind.INTEGRATION_DOWN: Entry(
        TargetKind.DELIVERY,
        "Integration down",
        "Parfocal could not reach a connected service.",
        ALL,
        breaks_mute=False,
    ),
    NotificationKind.EMERGENCY_ACCESS: Entry(
        TargetKind.PROJECT,
        "Emergency access to your project",
        "Someone opened your clinical project with emergency access.",
        ALL,
        breaks_mute=True,
    ),
    NotificationKind.WORKSPACE_ACCESS_ASKED: Entry(
        TargetKind.ACCESS_REQUEST,
        "Someone asked to join your workspace",
        "A person asked to join a workspace where you hold admin rights.",
        ALL,
        breaks_mute=False,
    ),
    NotificationKind.TEMPLATE_OFFERED: Entry(
        TargetKind.TEMPLATE_OFFER,
        "A report layout was offered as a template",
        "A researcher offered a report layout to the template library for you to accept.",
        ALL,
        breaks_mute=False,
    ),
}
DEFAULTS: Mapping[NotificationKind, Channels] = {
    kind: entry.channels for kind, entry in CATALOGUE.items()
}
BREAKS_MUTES = frozenset(kind for kind, entry in CATALOGUE.items() if entry.breaks_mute)


def target_kind_of(row: Any) -> TargetKind:
    if row.target_type == TargetKind.DECISION:
        return TargetKind.DECISION
    return CATALOGUE[NotificationKind(row.kind)].target
