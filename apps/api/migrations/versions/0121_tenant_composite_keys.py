from collections.abc import Sequence
from dataclasses import dataclass

from alembic import op

revision: str = "0121"
down_revision: str | None = "0120"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LONGEST_NAME = 63


@dataclass(frozen=True)
class CompositeKey:
    child: str
    old_name: str
    columns: tuple[str, ...]
    parent: str
    referred: tuple[str, ...]
    on_delete: str = ""

    @property
    def new_name(self) -> str:
        without_parent = f"fk_{self.child}_{'_'.join(self.columns)}_tenant_id"
        full = f"{without_parent}_{self.parent}"
        return full if len(full) <= LONGEST_NAME else without_parent

    def on_delete_clause(self) -> str:
        return f" ON DELETE {self.on_delete}" if self.on_delete else ""


ON_PROJECT = ("id", "project_id")
TASK_SLIDE = ("task_id", "slide_id")
ASSIGNMENT = ("task_id", "slide_id", "user_id")

KEYS = (
    CompositeKey(
        "adjudication_objects",
        "fk_adjudication_objects_task_id_slide_id_review_task_slides",
        TASK_SLIDE,
        "review_task_slides",
        TASK_SLIDE,
    ),
    CompositeKey(
        "annotations",
        "fk_annotations_class_id_project_id_project_classes",
        ("class_id", "project_id"),
        "project_classes",
        ON_PROJECT,
    ),
    CompositeKey(
        "annotations",
        "fk_annotations_slide_id_project_id_slides",
        ("slide_id", "project_id"),
        "slides",
        ON_PROJECT,
    ),
    CompositeKey(
        "annotations",
        "fk_annotations_task_id_review_task_slides",
        TASK_SLIDE,
        "review_task_slides",
        TASK_SLIDE,
    ),
    CompositeKey(
        "cases",
        "fk_cases_patient_id_project_id_patients",
        ("patient_id", "project_id"),
        "patients",
        ON_PROJECT,
    ),
    CompositeKey(
        "class_mappings",
        "fk_class_mappings_class_id_project_id_project_classes",
        ("class_id", "project_id"),
        "project_classes",
        ON_PROJECT,
        "CASCADE",
    ),
    CompositeKey(
        "clinical_reports",
        "fk_clinical_reports_case_id_project_id_cases",
        ("case_id", "project_id"),
        "cases",
        ON_PROJECT,
    ),
    CompositeKey(
        "disagreement_decisions",
        "fk_disagreement_decisions_answer_class_id_project_classes",
        ("answer_class_id", "project_id"),
        "project_classes",
        ON_PROJECT,
    ),
    CompositeKey(
        "disagreement_decisions",
        "fk_disagreement_decisions_task_id_slide_id_review_task_slides",
        TASK_SLIDE,
        "review_task_slides",
        TASK_SLIDE,
    ),
    CompositeKey(
        "emergency_grants",
        "fk_emergency_grants_project_id_privacy_mode_projects",
        ("project_id", "privacy_mode"),
        "projects",
        ("id", "privacy_mode"),
    ),
    CompositeKey(
        "job_units",
        "fk_job_units_job_id_ordinal_job_steps",
        ("job_id", "ordinal"),
        "job_steps",
        ("job_id", "ordinal"),
        "CASCADE",
    ),
    CompositeKey(
        "model_runs",
        "fk_model_runs_slide_id_project_id_slides",
        ("slide_id", "project_id"),
        "slides",
        ON_PROJECT,
    ),
    CompositeKey(
        "model_runs",
        "fk_model_runs_task_id_project_id_review_tasks",
        ("task_id", "project_id"),
        "review_tasks",
        ON_PROJECT,
    ),
    CompositeKey(
        "opinions",
        "fk_opinions_project_id_form_version_opinion_forms",
        ("project_id", "form_version"),
        "opinion_forms",
        ("project_id", "version"),
    ),
    CompositeKey(
        "opinions",
        "fk_opinions_task_id_slide_id_user_id_review_assignments",
        ASSIGNMENT,
        "review_assignments",
        ASSIGNMENT,
    ),
    CompositeKey(
        "painted_maps",
        "fk_painted_maps_slide_id_project_id_slides",
        ("slide_id", "project_id"),
        "slides",
        ON_PROJECT,
    ),
    CompositeKey(
        "patients",
        "fk_patients_project_id_privacy_mode_projects",
        ("project_id", "privacy_mode"),
        "projects",
        ("id", "privacy_mode"),
    ),
    CompositeKey(
        "result_set_classes",
        "fk_result_set_classes_class_id_project_id_project_classes",
        ("class_id", "project_id"),
        "project_classes",
        ON_PROJECT,
    ),
    CompositeKey(
        "result_set_classes",
        "fk_result_set_classes_result_set_id_project_id_result_sets",
        ("result_set_id", "project_id"),
        "result_sets",
        ON_PROJECT,
    ),
    CompositeKey(
        "result_sets",
        "fk_result_sets_slide_id_project_id_slides",
        ("slide_id", "project_id"),
        "slides",
        ON_PROJECT,
    ),
    CompositeKey(
        "review_assignments",
        "fk_review_assignments_task_id_slide_id_review_task_slides",
        TASK_SLIDE,
        "review_task_slides",
        TASK_SLIDE,
    ),
    CompositeKey(
        "review_decisions",
        "fk_review_decisions_ai_class_id_project_id_project_classes",
        ("ai_class_id", "project_id"),
        "project_classes",
        ON_PROJECT,
    ),
    CompositeKey(
        "review_decisions",
        "fk_review_decisions_answer_class_id_project_id_project_classes",
        ("answer_class_id", "project_id"),
        "project_classes",
        ON_PROJECT,
    ),
    CompositeKey(
        "review_decisions",
        "fk_review_decisions_reason_class_id_project_id_project_classes",
        ("reason_class_id", "project_id"),
        "project_classes",
        ON_PROJECT,
    ),
    CompositeKey(
        "review_decisions",
        "fk_review_decisions_task_id_slide_id_user_id_review_assignments",
        ASSIGNMENT,
        "review_assignments",
        ASSIGNMENT,
    ),
    CompositeKey(
        "review_edits",
        "fk_review_edits_class_id_project_id_project_classes",
        ("class_id", "project_id"),
        "project_classes",
        ON_PROJECT,
    ),
    CompositeKey(
        "review_edits",
        "fk_review_edits_task_id_slide_id_user_id_review_assignments",
        ASSIGNMENT,
        "review_assignments",
        ASSIGNMENT,
    ),
    CompositeKey(
        "review_order",
        "fk_review_order_task_id_slide_id_review_task_slides",
        TASK_SLIDE,
        "review_task_slides",
        TASK_SLIDE,
    ),
    CompositeKey(
        "review_skips",
        "fk_review_skips_ai_class_id_project_id_project_classes",
        ("ai_class_id", "project_id"),
        "project_classes",
        ON_PROJECT,
    ),
    CompositeKey(
        "review_skips",
        "fk_review_skips_task_id_slide_id_user_id_review_assignments",
        ASSIGNMENT,
        "review_assignments",
        ASSIGNMENT,
    ),
    CompositeKey(
        "review_task_slides",
        "fk_review_task_slides_result_set_id_project_id_result_sets",
        ("result_set_id", "project_id"),
        "result_sets",
        ON_PROJECT,
    ),
    CompositeKey(
        "review_task_slides",
        "fk_review_task_slides_slide_id_project_id_slides",
        ("slide_id", "project_id"),
        "slides",
        ON_PROJECT,
    ),
    CompositeKey(
        "review_task_slides",
        "fk_review_task_slides_task_id_kind_review_tasks",
        ("task_id", "kind"),
        "review_tasks",
        ("id", "kind"),
    ),
    CompositeKey(
        "review_task_slides",
        "fk_review_task_slides_task_id_project_id_review_tasks",
        ("task_id", "project_id"),
        "review_tasks",
        ON_PROJECT,
    ),
    CompositeKey(
        "review_tasks",
        "fk_review_tasks_project_id_opinion_form_version_opinion_forms",
        ("project_id", "opinion_form_version"),
        "opinion_forms",
        ("project_id", "version"),
    ),
    CompositeKey(
        "slides",
        "fk_slides_block_id_case_id_blocks",
        ("block_id", "case_id"),
        "blocks",
        ("id", "case_id"),
    ),
    CompositeKey(
        "slides",
        "fk_slides_case_id_project_id_cases",
        ("case_id", "project_id"),
        "cases",
        ON_PROJECT,
    ),
    CompositeKey(
        "slides",
        "fk_slides_upload_id_project_id_uploads",
        ("upload_id", "project_id"),
        "uploads",
        ON_PROJECT,
    ),
    CompositeKey(
        "stage_throughput",
        "fk_stage_throughput_job_id_ordinal_job_steps",
        ("job_id", "ordinal"),
        "job_steps",
        ("job_id", "ordinal"),
        "CASCADE",
    ),
    CompositeKey(
        "threads",
        "fk_threads_task_id_slide_id_review_task_slides",
        TASK_SLIDE,
        "review_task_slides",
        TASK_SLIDE,
    ),
    CompositeKey(
        "uploads",
        "fk_uploads_case_id_project_id_cases",
        ("case_id", "project_id"),
        "cases",
        ON_PROJECT,
    ),
    CompositeKey(
        "uploads",
        "fk_uploads_result_set_id_project_id_result_sets",
        ("result_set_id", "project_id"),
        "result_sets",
        ON_PROJECT,
    ),
    CompositeKey(
        "uploads",
        "fk_uploads_slide_id_project_id_slides",
        ("slide_id", "project_id"),
        "slides",
        ON_PROJECT,
    ),
    CompositeKey(
        "uploads",
        "fk_uploads_slide_upload_id_project_id_uploads",
        ("slide_upload_id", "project_id"),
        "uploads",
        ON_PROJECT,
    ),
)


def parent_uniques() -> list[tuple[str, tuple[str, ...]]]:
    return sorted({(key.parent, key.referred) for key in KEYS})


def unique_name(parent: str, referred: tuple[str, ...]) -> str:
    return f"uq_{parent}_{'_'.join(referred)}_tenant_id"


def listed(columns: tuple[str, ...], *more: str) -> str:
    return ", ".join((*columns, *more))


def upgrade() -> None:
    for parent, referred in parent_uniques():
        op.execute(
            f"ALTER TABLE {parent} ADD CONSTRAINT {unique_name(parent, referred)} "
            f"UNIQUE ({listed(referred, 'tenant_id')})"
        )
    for key in KEYS:
        op.execute(
            f"ALTER TABLE {key.child} DROP CONSTRAINT {key.old_name}, "
            f"ADD CONSTRAINT {key.new_name} FOREIGN KEY ({listed(key.columns, 'tenant_id')}) "
            f"REFERENCES {key.parent} ({listed(key.referred, 'tenant_id')})"
            f"{key.on_delete_clause()}"
        )


def downgrade() -> None:
    for key in KEYS:
        op.execute(
            f"ALTER TABLE {key.child} DROP CONSTRAINT {key.new_name}, "
            f"ADD CONSTRAINT {key.old_name} FOREIGN KEY ({listed(key.columns)}) "
            f"REFERENCES {key.parent} ({listed(key.referred)}){key.on_delete_clause()}"
        )
    for parent, referred in parent_uniques():
        op.execute(f"ALTER TABLE {parent} DROP CONSTRAINT {unique_name(parent, referred)}")
