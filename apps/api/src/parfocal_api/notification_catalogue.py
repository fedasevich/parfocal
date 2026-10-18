from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from parfocal_api.tables import NotificationKind


@dataclass(frozen=True)
class Channels:
    in_app: bool
    email: bool
    realtime: bool


class TargetKind(StrEnum):
    SLIDE = "slide"
    THREAD = "thread"
    TASK = "task"
    EVALUATION = "evaluation"
    JOB = "job"
    DELIVERY = "delivery"
    PROJECT = "project"


@dataclass(frozen=True)
class Entry:
    target: TargetKind
    subject: str
    line: str
    channels: Channels


ALL = Channels(in_app=True, email=True, realtime=True)
QUIET = Channels(in_app=True, email=False, realtime=True)

CATALOGUE: Mapping[NotificationKind, Entry] = {
    NotificationKind.MENTION: Entry(
        TargetKind.THREAD, "You were mentioned", "Someone mentioned you in a thread.", ALL
    ),
    NotificationKind.REPLY: Entry(
        TargetKind.THREAD, "New reply", "There is a new reply in a thread you follow.", QUIET
    ),
    NotificationKind.TASK_ASSIGNED: Entry(
        TargetKind.TASK, "New review task", "A review task was handed to you.", ALL
    ),
    NotificationKind.TASK_DUE_SOON: Entry(
        TargetKind.TASK, "Review task due soon", "A review task of yours is due soon.", ALL
    ),
    NotificationKind.MODEL_RUN_FINISHED: Entry(
        TargetKind.JOB, "Model run finished", "A model run you started has finished.", QUIET
    ),
    NotificationKind.MODEL_RUN_PAUSED: Entry(
        TargetKind.JOB, "Model run paused", "A model run you started is paused.", ALL
    ),
    NotificationKind.UPLOAD_DONE: Entry(
        TargetKind.JOB, "Upload done", "Your upload has been checked and is ready.", QUIET
    ),
    NotificationKind.DISAGREEMENTS_READY: Entry(
        TargetKind.TASK,
        "Disagreements to decide",
        "Every reviewer has submitted and some objects need your decision.",
        ALL,
    ),
    NotificationKind.TASK_SIGNED_OFF: Entry(
        TargetKind.EVALUATION, "Task signed off", "A review task was signed off.", ALL
    ),
    NotificationKind.RESULT_SET_ADDED: Entry(
        TargetKind.SLIDE, "Results added", "A pipeline added AI results to a slide.", QUIET
    ),
    NotificationKind.INTEGRATION_DOWN: Entry(
        TargetKind.DELIVERY,
        "Integration down",
        "Parfocal could not reach a connected service.",
        ALL,
    ),
    NotificationKind.EMERGENCY_ACCESS: Entry(
        TargetKind.PROJECT,
        "Emergency access to your project",
        "Someone opened your clinical project with emergency access.",
        ALL,
    ),
}
DEFAULTS: Mapping[NotificationKind, Channels] = {
    kind: entry.channels for kind, entry in CATALOGUE.items()
}
