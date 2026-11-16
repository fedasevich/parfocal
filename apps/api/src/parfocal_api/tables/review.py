import uuid
from enum import StrEnum

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Table,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

from parfocal_api.tables.base import one_of, timestamps
from parfocal_api.tables.cases import owned_ids
from parfocal_common.data_classes import OPERATIONAL, PERSONAL, PHI
from parfocal_common.db import metadata


class TaskSplit(StrEnum):
    EVERYONE = "everyone"
    EVEN = "even"
    CHOSEN = "chosen"


class TaskScope(StrEnum):
    ALL_REGIONS = "all-regions"
    RANDOM_CELLS = "random-cells"
    CELLS_BELOW_SCORE = "cells-below-score"
    INSIDE_ROIS = "inside-rois"
    UNSURE_ZONES = "unsure-zones"
    WHOLE_SLIDE = "whole-slide"


class TaskKind(StrEnum):
    REVIEW = "review"
    ANNOTATE = "annotate"


class StartMode(StrEnum):
    GUIDED = "guided"
    VIEWER = "viewer"


class DecisionStyle(StrEnum):
    CERTAINTY = "certainty"
    AGREE = "agree"
    YES_NO = "yes-no"
    BLIND = "blind"


DEFAULT_COUNTS_AS = ("disagree", "disagree", "unsure", "agree", "agree")


review_tasks = Table(
    "review_tasks",
    metadata,
    *owned_ids(),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("number", Integer, nullable=False, info=OPERATIONAL),
    Column("name", String(120), nullable=False, info=OPERATIONAL),
    Column(
        "kind", String(10), nullable=False, server_default=TaskKind.REVIEW.value, info=OPERATIONAL
    ),
    Column("class_snapshot", JSONB(none_as_null=True), nullable=True, info=OPERATIONAL),
    Column("split", String(10), nullable=False, info=OPERATIONAL),
    Column("scope", String(20), nullable=False, info=OPERATIONAL),
    Column("scope_count", Integer, nullable=True, info=OPERATIONAL),
    Column("scope_seed", BigInteger, nullable=True, info=OPERATIONAL),
    Column("scope_score", SmallInteger, nullable=True, info=OPERATIONAL),
    Column(
        "extra_scopes", JSONB, nullable=False, server_default=text("'[]'::jsonb"), info=OPERATIONAL
    ),
    Column("opinion_form_version", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("blinded", Boolean, nullable=False, server_default=text("true"), info=OPERATIONAL),
    Column(
        "ai_hidden_first_read",
        Boolean,
        nullable=False,
        server_default=text("false"),
        info=OPERATIONAL,
    ),
    Column("start_mode", String(10), nullable=False, info=OPERATIONAL),
    Column("due_on", Date, nullable=True, info=OPERATIONAL),
    Column(
        "reminder_days",
        ARRAY(SmallInteger),
        nullable=False,
        server_default=text("'{}'"),
        info=OPERATIONAL,
    ),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column("archived_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("signed_off_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "signed_off_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    Column("study_template_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("study_template_version", SmallInteger, nullable=True, info=OPERATIONAL),
    Column(
        "decision_style",
        String(10),
        nullable=False,
        server_default=DecisionStyle.CERTAINTY.value,
        info=OPERATIONAL,
    ),
    Column(
        "counts_as",
        ARRAY(String(10)),
        nullable=False,
        server_default=text("'{" + ",".join(DEFAULT_COUNTS_AS) + "}'"),
        info=OPERATIONAL,
    ),
    Column(
        "counts_as_changes",
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        info=PERSONAL,
    ),
    Column("question", String(200), nullable=True, info=OPERATIONAL),
    Column("display", JSONB, nullable=False, server_default=text("'{}'::jsonb"), info=OPERATIONAL),
    Column("check_options", JSONB(none_as_null=True), nullable=True, info=OPERATIONAL),
    Column("blind_first", Boolean, nullable=False, server_default=text("false"), info=OPERATIONAL),
    Column("blind_first_since", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("report_layout", JSONB(none_as_null=True), nullable=True, info=OPERATIONAL),
    *timestamps(),
    UniqueConstraint("project_id", "number"),
    UniqueConstraint("id", "project_id"),
    UniqueConstraint("id", "kind"),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    ForeignKeyConstraint(
        ["project_id", "opinion_form_version"],
        ["opinion_forms.project_id", "opinion_forms.version"],
    ),
    ForeignKeyConstraint(
        ["study_template_id", "study_template_version", "tenant_id"],
        [
            "study_template_versions.template_id",
            "study_template_versions.version",
            "study_template_versions.tenant_id",
        ],
        name="fk_review_tasks_study_template_versions",
    ),
    CheckConstraint(
        "(study_template_id IS NULL) = (study_template_version IS NULL)", name="study_template"
    ),
    one_of("kind", TaskKind),
    one_of("split", TaskSplit),
    one_of("scope", TaskScope),
    CheckConstraint("(kind = 'annotate') = (class_snapshot IS NOT NULL)", name="class_snapshot"),
    CheckConstraint("(kind = 'annotate') = (scope = 'whole-slide')", name="whole_slide"),
    CheckConstraint("kind = 'annotate' OR check_options IS NULL", name="check_options"),
    CheckConstraint("kind = 'annotate' OR NOT blind_first", name="blind_first"),
    one_of("start_mode", StartMode),
    one_of("decision_style", DecisionStyle),
    CheckConstraint(
        "cardinality(counts_as) = 5 AND "
        "counts_as <@ ARRAY['agree', 'disagree', 'unsure']::varchar[] AND "
        "'agree' = ANY(counts_as) AND 'disagree' = ANY(counts_as)",
        name="counts_as",
    ),
    CheckConstraint("number > 0", name="number"),
    CheckConstraint(
        "(scope = 'random-cells') = (scope_count IS NOT NULL AND scope_seed IS NOT NULL)",
        name="random_cells",
    ),
    CheckConstraint("scope_count IS NULL OR scope_count BETWEEN 1 AND 10000", name="scope_count"),
    CheckConstraint(
        "(scope = 'cells-below-score') = (scope_score IS NOT NULL)", name="cells_below_score"
    ),
    CheckConstraint("scope_score IS NULL OR scope_score BETWEEN 0 AND 255", name="scope_score"),
    CheckConstraint("cardinality(reminder_days) <= 3", name="reminders"),
)

review_task_slides = Table(
    "review_task_slides",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, index=True, info=OPERATIONAL),
    Column("position", Integer, nullable=False, info=OPERATIONAL),
    Column(
        "kind", String(10), nullable=False, server_default=TaskKind.REVIEW.value, info=OPERATIONAL
    ),
    Column("result_set_id", Uuid[uuid.UUID](), nullable=True, index=True, info=OPERATIONAL),
    Column(
        "run_set_ids",
        ARRAY(Uuid[uuid.UUID]()),
        nullable=False,
        server_default=text("'{}'"),
        info=OPERATIONAL,
    ),
    Column("signed_off_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "signed_off_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    UniqueConstraint("task_id", "position"),
    ForeignKeyConstraint(["task_id", "project_id"], ["review_tasks.id", "review_tasks.project_id"]),
    ForeignKeyConstraint(["task_id", "kind"], ["review_tasks.id", "review_tasks.kind"]),
    CheckConstraint("kind = 'annotate' OR result_set_id IS NOT NULL", name="result_set"),
    CheckConstraint("kind = 'annotate' OR cardinality(run_set_ids) = 0", name="run_sets"),
    CheckConstraint("kind = 'annotate' OR signed_off_at IS NULL", name="slide_sign_off"),
    ForeignKeyConstraint(["slide_id", "project_id"], ["slides.id", "slides.project_id"]),
    ForeignKeyConstraint(
        ["result_set_id", "project_id"], ["result_sets.id", "result_sets.project_id"]
    ),
)

review_assignments = Table(
    "review_assignments",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, index=True, info=PERSONAL),
    Column("submitted_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "assigned_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("first_read_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("first_read", JSONB(none_as_null=True), nullable=True, info=PHI),
    Column("released_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "nothing_to_mark", Boolean, nullable=False, server_default=text("false"), info=OPERATIONAL
    ),
    ForeignKeyConstraint(
        ["task_id", "slide_id"], ["review_task_slides.task_id", "review_task_slides.slide_id"]
    ),
    ForeignKeyConstraint(
        ["tenant_id", "user_id"], ["memberships.tenant_id", "memberships.user_id"]
    ),
    CheckConstraint("(first_read_at IS NULL) = (first_read IS NULL)", name="first_read_pair"),
    CheckConstraint("NOT nothing_to_mark OR submitted_at IS NOT NULL", name="nothing_to_mark"),
)


class ReassignWhat(StrEnum):
    NOT_STARTED = "not-started"
    ALL = "all"


task_nudges = Table(
    "task_nudges",
    metadata,
    *owned_ids(),
    Column(
        "task_id",
        Uuid[uuid.UUID](),
        ForeignKey("review_tasks.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column("user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=False, info=PERSONAL),
    Column(
        "sent_by_user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=True, info=PERSONAL
    ),
    Column(
        "sent_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
)

task_reassignments = Table(
    "task_reassignments",
    metadata,
    *owned_ids(),
    Column(
        "task_id",
        Uuid[uuid.UUID](),
        ForeignKey("review_tasks.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column(
        "from_user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=False, info=PERSONAL
    ),
    Column("to_user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=False, info=PERSONAL),
    Column("what", String(12), nullable=False, info=OPERATIONAL),
    Column("slide_ids", ARRAY(Uuid[uuid.UUID]()), nullable=False, info=OPERATIONAL),
    Column("kept_slide_ids", ARRAY(Uuid[uuid.UUID]()), nullable=False, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("undone_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    one_of("what", ReassignWhat),
    CheckConstraint("from_user_id <> to_user_id", name="two_people"),
)

review_order = Table(
    "review_order",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("seed", BigInteger, nullable=False, info=OPERATIONAL),
    Column("count", Integer, nullable=False, info=OPERATIONAL),
    Column("objects", LargeBinary, nullable=False, info=OPERATIONAL),
    Column(
        "created_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    ForeignKeyConstraint(
        ["task_id", "slide_id"], ["review_task_slides.task_id", "review_task_slides.slide_id"]
    ),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    CheckConstraint("count >= 0", name="count"),
    CheckConstraint("octet_length(objects) = 5 * count", name="packed"),
)


review_edits = Table(
    "review_edits",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, info=PERSONAL),
    Column("kind", String(10), primary_key=True, info=OPERATIONAL),
    Column("number", Integer, primary_key=True, info=OPERATIONAL),
    Column("split", String(26), primary_key=True, server_default=text("''"), info=OPERATIONAL),
    Column("class_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column[object]("geometry", Geometry(spatial_index=False), nullable=True, info=OPERATIONAL),
    Column("deleted", Boolean, nullable=False, server_default=text("false"), info=OPERATIONAL),
    Column("retired", String(10), nullable=True, info=OPERATIONAL),
    Column("merged_into_number", Integer, nullable=True, info=OPERATIONAL),
    Column("merged_into_split", String(26), nullable=True, info=OPERATIONAL),
    *timestamps(),
    ForeignKeyConstraint(
        ["task_id", "slide_id", "user_id"],
        ["review_assignments.task_id", "review_assignments.slide_id", "review_assignments.user_id"],
    ),
    ForeignKeyConstraint(
        ["class_id", "project_id"], ["project_classes.id", "project_classes.project_id"]
    ),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    CheckConstraint("kind IN ('region', 'cell')", name="kind"),
    CheckConstraint("number > 0", name="number"),
    CheckConstraint(
        "deleted OR retired IS NOT NULL OR class_id IS NOT NULL OR geometry IS NOT NULL",
        name="changes_something",
    ),
    CheckConstraint("geometry IS NULL OR ST_IsValid(geometry)", name="geometry_valid"),
    CheckConstraint("split ~ '^[a-z]*$'", name="split"),
    CheckConstraint("retired IN ('split', 'merged')", name="retired"),
    CheckConstraint(
        "(retired = 'merged') = (merged_into_number IS NOT NULL AND merged_into_split IS NOT NULL)",
        name="merged_into",
    ),
)


class DecisionValue(StrEnum):
    AGREE = "agree"
    DISAGREE = "disagree"
    UNSURE = "unsure"


class DecisionReason(StrEnum):
    NOT_CLASS = "not_class"
    BOUNDARY_OFF = "boundary_off"
    TWO_REGIONS = "two_regions"
    ARTEFACT = "artefact"
    NOT_A_CELL = "not_a_cell"
    WRONG_CLASS = "wrong_class"
    NEED_DEEPER_LEVEL = "need_deeper_level"
    NEED_IHC = "need_ihc"
    BORDER_UNCLEAR = "border_unclear"
    OUT_OF_FOCUS = "out_of_focus"
    NEED_SECOND_LOOK = "need_second_look"


AI_CALL = {
    **OPERATIONAL,
    "note": "The AI call at decision time, read from the result set for a region and reported "
    "by the reviewer's client for a cell, unchecked against the cell chunks",
}

review_decisions = Table(
    "review_decisions",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, info=PERSONAL),
    Column("kind", String(10), primary_key=True, info=OPERATIONAL),
    Column("number", Integer, primary_key=True, info=OPERATIONAL),
    Column("value", String(10), nullable=False, info=OPERATIONAL),
    Column("style", String(10), nullable=False, info=OPERATIONAL),
    Column("answer", String(10), nullable=False, info=OPERATIONAL),
    Column("answer_class_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("reasons", ARRAY(String(20)), nullable=False, server_default="{}", info=OPERATIONAL),
    Column("reason_class_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("note", String(500), nullable=True, info=PHI),
    Column("reopened_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("reopened_note", String(500), nullable=True, info=PHI),
    Column("preset", String(40), nullable=True, info=PERSONAL),
    Column("ai_class_id", Uuid[uuid.UUID](), nullable=True, info=AI_CALL),
    Column("ai_score", SmallInteger, nullable=True, info=AI_CALL),
    *timestamps(),
    ForeignKeyConstraint(
        ["task_id", "slide_id", "user_id"],
        ["review_assignments.task_id", "review_assignments.slide_id", "review_assignments.user_id"],
    ),
    ForeignKeyConstraint(
        ["reason_class_id", "project_id"], ["project_classes.id", "project_classes.project_id"]
    ),
    ForeignKeyConstraint(
        ["ai_class_id", "project_id"],
        ["project_classes.id", "project_classes.project_id"],
        name="fk_review_decisions_ai_class_id_project_id_project_classes",
    ),
    CheckConstraint("ai_score BETWEEN 0 AND 255", name="ai_score"),
    ForeignKeyConstraint(
        ["answer_class_id", "project_id"],
        ["project_classes.id", "project_classes.project_id"],
        name="fk_review_decisions_answer_class_id_project_id_project_classes",
    ),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    CheckConstraint("kind IN ('region', 'cell')", name="kind"),
    CheckConstraint("number > 0", name="number"),
    one_of("value", DecisionValue),
    one_of("style", DecisionStyle),
    CheckConstraint(
        "(style = 'certainty' AND answer IN ('1', '2', '3', '4', '5', 'unsure')) OR "
        "(style = 'agree' AND answer IN ('agree', 'disagree', 'unsure')) OR "
        "(style = 'yes-no' AND answer IN ('yes', 'no', 'unsure')) OR "
        "(style = 'blind' AND answer IN ('class', 'unsure'))",
        name="answer_fits_style",
    ),
    CheckConstraint(
        "(answer = 'class') = (answer_class_id IS NOT NULL)", name="answer_names_class"
    ),
    CheckConstraint(
        "(value = 'agree' AND cardinality(reasons) = 0) OR "
        "(value = 'unsure' AND reasons <@ ARRAY['need_deeper_level', 'need_ihc', "
        "'border_unclear', 'out_of_focus', 'need_second_look']::varchar[]) OR "
        "(value = 'disagree' AND kind = 'region' AND reasons <@ ARRAY['not_class', "
        "'boundary_off', 'two_regions', 'artefact']::varchar[]) OR "
        "(value = 'disagree' AND kind = 'cell' AND reasons <@ ARRAY['not_a_cell', "
        "'wrong_class', 'boundary_off', 'artefact']::varchar[])",
        name="reasons_fit",
    ),
    CheckConstraint(
        "('wrong_class' = ANY(reasons)) = (reason_class_id IS NOT NULL)",
        name="wrong_class_names_class",
    ),
)

review_skips = Table(
    "review_skips",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, info=PERSONAL),
    Column("kind", String(10), primary_key=True, info=OPERATIONAL),
    Column("number", Integer, primary_key=True, info=OPERATIONAL),
    Column("ai_class_id", Uuid[uuid.UUID](), nullable=True, info=AI_CALL),
    Column("ai_score", SmallInteger, nullable=True, info=AI_CALL),
    *timestamps(),
    ForeignKeyConstraint(
        ["task_id", "slide_id", "user_id"],
        ["review_assignments.task_id", "review_assignments.slide_id", "review_assignments.user_id"],
    ),
    ForeignKeyConstraint(
        ["ai_class_id", "project_id"], ["project_classes.id", "project_classes.project_id"]
    ),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    CheckConstraint("kind IN ('region', 'cell')", name="kind"),
    CheckConstraint("number > 0", name="number"),
    CheckConstraint("ai_score BETWEEN 0 AND 255", name="ai_score"),
)

display_presets = Table(
    "display_presets",
    metadata,
    *owned_ids(),
    Column("user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=False, info=PERSONAL),
    Column(
        "task_id", Uuid[uuid.UUID](), ForeignKey("review_tasks.id"), nullable=True, info=OPERATIONAL
    ),
    Column("name", String(40), nullable=False, info=PERSONAL),
    Column("settings", JSONB, nullable=False, info=PERSONAL),
    *timestamps(),
    Index(
        "ix_display_presets_tenant_id_user_id_name",
        "tenant_id",
        "user_id",
        func.lower(text("name")),
        unique=True,
    ),
)

display_choices = Table(
    "display_choices",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column(
        "task_id",
        Uuid[uuid.UUID](),
        ForeignKey("review_tasks.id"),
        primary_key=True,
        info=OPERATIONAL,
    ),
    Column("user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), primary_key=True, info=PERSONAL),
    Column(
        "preset_id",
        Uuid[uuid.UUID](),
        ForeignKey("display_presets.id", ondelete="SET NULL"),
        nullable=True,
        info=PERSONAL,
    ),
    Column("settings", JSONB, nullable=False, info=PERSONAL),
    *timestamps(),
)


adjudications = Table(
    "adjudications",
    metadata,
    *owned_ids(),
    Column(
        "task_id",
        Uuid[uuid.UUID](),
        ForeignKey("review_tasks.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column(
        "adjudicator_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=False,
        index=True,
        info=PERSONAL,
    ),
    Column(
        "sent_by_user_id", Uuid[uuid.UUID](), ForeignKey("users.id"), nullable=True, info=PERSONAL
    ),
    Column("note", String(300), nullable=True, info=PHI),
    Column(
        "sent_at",
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        info=OPERATIONAL,
    ),
    Column("declined_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("declined_note", String(300), nullable=True, info=PHI),
    CheckConstraint("declined_note IS NULL OR declined_at IS NOT NULL", name="declined_with_note"),
)

adjudication_objects = Table(
    "adjudication_objects",
    metadata,
    Column(
        "adjudication_id",
        Uuid[uuid.UUID](),
        ForeignKey("adjudications.id"),
        primary_key=True,
        info=OPERATIONAL,
    ),
    Column(
        "tenant_id",
        Uuid[uuid.UUID](),
        ForeignKey("tenants.id"),
        nullable=False,
        index=True,
        info=OPERATIONAL,
    ),
    Column("task_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("kind", String(10), primary_key=True, info=OPERATIONAL),
    Column("number", Integer, primary_key=True, info=OPERATIONAL),
    ForeignKeyConstraint(
        ["task_id", "slide_id"], ["review_task_slides.task_id", "review_task_slides.slide_id"]
    ),
    CheckConstraint("kind IN ('region', 'cell')", name="kind"),
    CheckConstraint("number > 0", name="number"),
)


class Decision(StrEnum):
    KEEP_AI = "keep-ai"
    GO_WITH_REVIEWERS = "go-with-reviewers"


disagreement_decisions = Table(
    "disagreement_decisions",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("kind", String(10), primary_key=True, info=OPERATIONAL),
    Column("number", Integer, primary_key=True, info=OPERATIONAL),
    Column("decision", String(20), nullable=True, info=OPERATIONAL),
    Column("style", String(10), nullable=True, info=OPERATIONAL),
    Column("answer", String(10), nullable=True, info=OPERATIONAL),
    Column("answer_class_id", Uuid[uuid.UUID](), nullable=True, info=OPERATIONAL),
    Column("value", String(10), nullable=True, info=OPERATIONAL),
    Column("left_open", Boolean, nullable=False, server_default=text("false"), info=OPERATIONAL),
    Column("edits_settled_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column("note", String(500), nullable=True, info=PHI),
    Column(
        "decided_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    ForeignKeyConstraint(
        ["task_id", "slide_id"], ["review_task_slides.task_id", "review_task_slides.slide_id"]
    ),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
    CheckConstraint("kind IN ('region', 'cell')", name="kind"),
    CheckConstraint("number > 0", name="number"),
    one_of("decision", Decision),
    ForeignKeyConstraint(
        ["answer_class_id", "project_id"],
        ["project_classes.id", "project_classes.project_id"],
        name="fk_disagreement_decisions_answer_class_id_project_classes",
    ),
    CheckConstraint(
        "style IS NULL OR style IN ('certainty', 'agree', 'yes-no', 'blind')", name="style"
    ),
    CheckConstraint(
        "style IS NULL OR "
        "(style = 'certainty' AND answer IN ('1', '2', '3', '4', '5', 'unsure')) OR "
        "(style = 'agree' AND answer IN ('agree', 'disagree', 'unsure')) OR "
        "(style = 'yes-no' AND answer IN ('yes', 'no', 'unsure')) OR "
        "(style = 'blind' AND answer IN ('class', 'unsure'))",
        name="answer_fits_style",
    ),
    CheckConstraint("(style IS NULL) = (answer IS NULL)", name="style_with_answer"),
    CheckConstraint(
        "(answer = 'class') = (answer_class_id IS NOT NULL) "
        "AND (answer IS NOT NULL OR answer_class_id IS NULL)",
        name="answer_names_class",
    ),
    CheckConstraint("value IS NULL OR value IN ('agree', 'disagree', 'unsure')", name="value"),
    CheckConstraint(
        "NOT (left_open AND value IS NOT NULL) "
        "AND (left_open OR value IS NOT NULL OR edits_settled_at IS NOT NULL)",
        name="decided_or_left_open",
    ),
)

opinions = Table(
    "opinions",
    metadata,
    Column("tenant_id", Uuid[uuid.UUID](), nullable=False, index=True, info=OPERATIONAL),
    Column("project_id", Uuid[uuid.UUID](), nullable=False, info=OPERATIONAL),
    Column("task_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("slide_id", Uuid[uuid.UUID](), primary_key=True, info=OPERATIONAL),
    Column("user_id", Uuid[uuid.UUID](), primary_key=True, info=PERSONAL),
    Column("form_version", SmallInteger, nullable=False, info=OPERATIONAL),
    Column("answers", JSONB, nullable=False, server_default=text("'{}'::jsonb"), info=PHI),
    *timestamps(),
    ForeignKeyConstraint(
        ["task_id", "slide_id", "user_id"],
        ["review_assignments.task_id", "review_assignments.slide_id", "review_assignments.user_id"],
    ),
    ForeignKeyConstraint(
        ["project_id", "form_version"], ["opinion_forms.project_id", "opinion_forms.version"]
    ),
    ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"]),
)


class AnnouncementKind(StrEnum):
    MODEL = "model"
    SLOWDOWN = "slowdown"
    CHANGE = "change"


announcements = Table(
    "announcements",
    metadata,
    *owned_ids(),
    Column("kind", String(10), nullable=False, info=OPERATIONAL),
    Column("text", String(280), nullable=False, info=OPERATIONAL),
    Column("ends_at", DateTime(timezone=True), nullable=True, info=OPERATIONAL),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    Index("ix_announcements_tenant_id_created_at", "tenant_id", "created_at"),
    one_of("kind", AnnouncementKind),
)


site_validations = Table(
    "site_validations",
    metadata,
    *owned_ids(),
    Column("model_name", String(80), nullable=False, info=OPERATIONAL),
    Column("model_version", String(40), nullable=False, info=OPERATIONAL),
    Column("specimen_type", String(80), nullable=False, info=OPERATIONAL),
    Column("threshold", Float[float](), nullable=False, info=OPERATIONAL),
    Column("true_positives", Integer, nullable=False, info=OPERATIONAL),
    Column("false_positives", Integer, nullable=False, info=OPERATIONAL),
    Column("true_negatives", Integer, nullable=False, info=OPERATIONAL),
    Column("false_negatives", Integer, nullable=False, info=OPERATIONAL),
    Column(
        "announcement_id",
        Uuid[uuid.UUID](),
        ForeignKey("announcements.id"),
        nullable=False,
        info=OPERATIONAL,
    ),
    Column(
        "created_by_user_id",
        Uuid[uuid.UUID](),
        ForeignKey("users.id"),
        nullable=True,
        info=PERSONAL,
    ),
    *timestamps(),
    Index("ix_site_validations_tenant_id_created_at", "tenant_id", "created_at"),
    CheckConstraint(
        "least(true_positives, false_positives, true_negatives, false_negatives) >= 0",
        name="counts",
    ),
    CheckConstraint("threshold >= 0 AND threshold <= 1", name="threshold"),
)
