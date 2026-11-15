from collections.abc import Sequence
from dataclasses import dataclass

from alembic import op

revision: str = "0120"
down_revision: str | None = "0119"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


@dataclass(frozen=True)
class TenantKey:
    child: str
    column: str
    parent: str
    on_delete: str = ""
    short_name: str = ""

    @property
    def old_name(self) -> str:
        return f"fk_{self.child}_{self.column}_{self.parent}"

    @property
    def new_name(self) -> str:
        return self.short_name or f"fk_{self.child}_{self.column}_tenant_id_{self.parent}"

    def old_on_delete(self) -> str:
        return self.on_delete.split(" (")[0]


KEYS = (
    TenantKey("adjudication_objects", "adjudication_id", "adjudications"),
    TenantKey("adjudications", "task_id", "review_tasks"),
    TenantKey("annotation_versions", "annotation_id", "annotations"),
    TenantKey("api_tokens", "service_account_id", "service_accounts"),
    TenantKey("clinical_deposits", "report_id", "clinical_reports", "CASCADE"),
    TenantKey("clinical_deposits", "slide_id", "slides"),
    TenantKey(
        "clinical_report_versions",
        "report_id",
        "clinical_reports",
        "CASCADE",
        "fk_clinical_report_versions_report_tenant_clinical_reports",
    ),
    TenantKey("display_choices", "preset_id", "display_presets", "SET NULL (preset_id)"),
    TenantKey("display_choices", "task_id", "review_tasks"),
    TenantKey("display_presets", "task_id", "review_tasks"),
    TenantKey("evaluation_changes", "slide_id", "slides"),
    TenantKey("evaluation_changes", "task_id", "review_tasks", "CASCADE"),
    TenantKey("evaluation_versions", "task_id", "review_tasks", "CASCADE"),
    TenantKey("gpu_usage", "job_id", "jobs", "CASCADE"),
    TenantKey("invitations", "task_id", "review_tasks"),
    TenantKey("job_steps", "job_id", "jobs", "CASCADE"),
    TenantKey("lab_model_projects", "lab_model_id", "lab_models", "CASCADE"),
    TenantKey("lab_model_projects", "project_id", "projects", "CASCADE"),
    TenantKey("model_runs", "job_id", "jobs"),
    TenantKey("projects", "study_template_id", "study_templates"),
    TenantKey("report_links", "task_id", "review_tasks", "CASCADE"),
    TenantKey("result_chunks", "result_set_id", "result_sets"),
    TenantKey("result_objects", "result_set_id", "result_sets"),
    TenantKey("result_sets", "job_id", "jobs"),
    TenantKey("resume_states", "slide_id", "slides", "CASCADE"),
    TenantKey("resume_states", "task_id", "review_tasks", "CASCADE"),
    TenantKey("site_validations", "announcement_id", "announcements"),
    TenantKey("slide_counters", "slide_id", "slides"),
    TenantKey("slide_coverage", "slide_id", "slides", "CASCADE"),
    TenantKey("task_nudges", "task_id", "review_tasks"),
    TenantKey("task_reassignments", "task_id", "review_tasks"),
    TenantKey("thread_messages", "thread_id", "threads", "CASCADE"),
    TenantKey("threads", "result_set_id", "result_sets"),
    TenantKey("uploads", "created_by_service_id", "service_accounts"),
    TenantKey("uploads", "job_id", "jobs"),
)

PARENTS_WITH_A_TENANT_UNIQUE = {"projects", "study_templates"}


def parents_to_unique() -> list[str]:
    return sorted({key.parent for key in KEYS} - PARENTS_WITH_A_TENANT_UNIQUE)


def on_delete_clause(on_delete: str) -> str:
    return f" ON DELETE {on_delete}" if on_delete else ""


def upgrade() -> None:
    for parent in parents_to_unique():
        op.execute(
            f"ALTER TABLE {parent} ADD CONSTRAINT uq_{parent}_id_tenant_id UNIQUE (id, tenant_id)"
        )
    for key in KEYS:
        op.execute(
            f"ALTER TABLE {key.child} DROP CONSTRAINT {key.old_name}, "
            f"ADD CONSTRAINT {key.new_name} FOREIGN KEY ({key.column}, tenant_id) "
            f"REFERENCES {key.parent} (id, tenant_id){on_delete_clause(key.on_delete)}"
        )


def downgrade() -> None:
    for key in KEYS:
        op.execute(
            f"ALTER TABLE {key.child} DROP CONSTRAINT {key.new_name}, "
            f"ADD CONSTRAINT {key.old_name} FOREIGN KEY ({key.column}) "
            f"REFERENCES {key.parent} (id){on_delete_clause(key.old_on_delete())}"
        )
    for parent in parents_to_unique():
        op.execute(f"ALTER TABLE {parent} DROP CONSTRAINT uq_{parent}_id_tenant_id")
