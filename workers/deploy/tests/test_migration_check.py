from pathlib import Path

import pytest

from parfocal_deploy import migrations
from parfocal_deploy.migrations import (
    DestructiveMigrationError,
    MigrationHistoryError,
    check,
    load,
    read_revision,
)
from parfocal_deploy.tools import REPOSITORY

HEADER = 'revision: str = "{revision}"\ndown_revision: str | None = {down}\n\n\n'
ADDITIVE = """def upgrade() -> None:
    op.add_column("slides", sa.Column("stain", sa.Text(), nullable=True))
    op.create_index("slides_stain", "slides", ["stain"])
    op.drop_index("slides_old")
    op.drop_constraint("slides_name_key", "slides")


def downgrade() -> None:
    op.drop_column("slides", "stain")
    op.execute("DROP TABLE leftovers")
"""


def write(directory: Path, revision: str, down: str | None, body: str = ADDITIVE) -> None:
    quoted = "None" if down is None else f'"{down}"'
    (directory / f"{revision}_step.py").write_text(
        HEADER.format(revision=revision, down=quoted) + body
    )


def findings(body: str) -> tuple[str, ...]:
    return read_revision(HEADER.format(revision="0002", down='"0001"') + body).findings


def test_a_migration_that_only_adds_passes_even_when_its_downgrade_drops() -> None:
    assert findings(ADDITIVE) == ()


@pytest.mark.parametrize(
    ("body", "finding"),
    [
        ('def upgrade() -> None:\n    op.drop_table("slides")\n', "drop_table slides"),
        (
            'def upgrade() -> None:\n    op.drop_column("slides", "stain")\n',
            "drop_column slides stain",
        ),
        (
            'def upgrade() -> None:\n    op.rename_table("slides", "scans")\n',
            "rename_table slides scans",
        ),
        (
            'def upgrade() -> None:\n    with op.batch_alter_table("slides") as batch:\n'
            '        batch.drop_column("stain")\n',
            "drop_column stain",
        ),
        (
            'def upgrade() -> None:\n    op.alter_column("slides", "stain", type_=sa.Integer())\n',
            "alter_column slides stain type_",
        ),
        (
            'def upgrade() -> None:\n    op.alter_column("slides", "stain", new_column_name="d")\n',
            "alter_column slides stain new_column_name",
        ),
        ('def upgrade() -> None:\n    op.execute("truncate  slides")\n', "TRUNCATE"),
        (
            'CLEAN = "DELETE FROM slides WHERE stain IS NULL"\n\n\n'
            "def upgrade() -> None:\n    op.execute(CLEAN)\n",
            "DELETE FROM",
        ),
        (
            'def upgrade() -> None:\n    op.execute(f"ALTER TABLE {NAME} DROP COLUMN stain")\n',
            "DROP COLUMN",
        ),
        (
            'def upgrade() -> None:\n    op.execute("ALTER TABLE slides RENAME COLUMN a TO b")\n',
            "RENAME COLUMN",
        ),
        (
            'def upgrade() -> None:\n    op.execute("ALTER TABLE a ALTER COLUMN b TYPE bigint")\n',
            "ALTER COLUMN B TYPE",
        ),
    ],
)
def test_dropping_renaming_and_rewriting_are_found(body: str, finding: str) -> None:
    assert findings(body) == (finding,)


def test_a_nullable_change_and_a_new_policy_are_not_destructive() -> None:
    body = (
        'def upgrade() -> None:\n    op.alter_column("slides", "stain", nullable=False)\n'
        '    op.execute("DROP POLICY slides_tenant ON slides")\n'
        "    op.execute(\"UPDATE slides SET stain = 'he' WHERE stain IS NULL\")\n"
    )
    assert findings(body) == ()


def test_only_revisions_the_database_has_not_run_are_checked(tmp_path: Path) -> None:
    write(tmp_path, "0001", None, 'def upgrade() -> None:\n    op.drop_table("old")\n')
    write(tmp_path, "0002", "0001")
    write(tmp_path, "0003", "0002")
    assert check("0001", (), tmp_path) == ["0002", "0003"]
    assert check("0003", (), tmp_path) == []


def test_an_empty_database_has_nothing_to_lose(tmp_path: Path) -> None:
    write(tmp_path, "0001", None, 'def upgrade() -> None:\n    op.drop_table("old")\n')
    assert check(None, (), tmp_path) == []


def test_a_destructive_revision_is_refused_until_it_is_named(tmp_path: Path) -> None:
    write(tmp_path, "0001", None)
    write(tmp_path, "0002", "0001", 'def upgrade() -> None:\n    op.drop_table("old")\n')
    write(tmp_path, "0003", "0002", 'def upgrade() -> None:\n    op.execute("TRUNCATE a")\n')
    with pytest.raises(DestructiveMigrationError) as refused:
        check("0001", {"0002"}, tmp_path)
    message = str(refused.value)
    assert "0003: TRUNCATE" in message
    assert "0002" not in message
    assert "allow_destructive=0003" in message
    assert check("0001", {"0002", "0003"}, tmp_path) == ["0002", "0003"]


def test_a_database_ahead_of_the_code_and_a_forked_history_are_refused(tmp_path: Path) -> None:
    write(tmp_path, "0001", None)
    write(tmp_path, "0002", "0001")
    with pytest.raises(MigrationHistoryError, match="0009"):
        check("0009", (), tmp_path)
    write(tmp_path, "0003", "0001")
    with pytest.raises(MigrationHistoryError, match="more than one head: 0002, 0003"):
        check("0001", (), tmp_path)


def test_the_real_migrations_form_one_chain_and_the_latest_only_adds() -> None:
    revisions = load(migrations.VERSIONS)
    newest = migrations.head(revisions)
    assert newest is not None
    oldest = min(revisions)
    assert [step.revision for step in migrations.pending(revisions, oldest)][-1] == newest.revision
    assert len(migrations.pending(revisions, oldest)) == len(revisions) - 1
    assert revisions["0110"].findings == ()
    assert migrations.VERSIONS == REPOSITORY / "apps/api/migrations/versions"
