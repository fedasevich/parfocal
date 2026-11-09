# Result: tenant isolation review of 2026-11-09

- Date: 2026-11-09
- Backlog: SEC-032 (refuse a database role that bypasses row-level security), SEC-033 (isolation checks that read the policies), SEC-034 (narrow three database escape hatches), SEC-035 (foreign keys to tenant tables carry the tenant) and IAM-026 (a workspace on a shared mail domain is not open to strangers)
- Kind: check
- Commit: ba45feb5
- Environment: the owner's Mac, read-only, no cloud database queried
- Data: `apps/api`, `packages/py-common`, `workers` and the 91 migrations

## Question

Can a member of one workspace read or write another workspace's rows, and would the tests notice if a change made that possible.

## Method

A read-only review by an agent. Nothing was run during the review. Confirmed finding 3 was then reproduced with failing tests and fixed in SEC-032.

Read-only review of row-level security, tenant scoping and the isolation suite, done on 2026-11-09 against commit `ba45feb5`. The eight commits between it and `8b8ac1f6` (the head when this was written) change nothing in the reviewed files. Nothing was run. Every claim below comes from reading the code, and the two suspicions say what would have to be run to settle them.

## Summary

| Kind | Severity | Title |
|---|---|---|
| Confirmed 1 | medium | A workspace made from a shared mail domain that is not on the deny-list is open to every stranger on that domain |
| Confirmed 2 | medium | The isolation checks compare policy names and GET routes only, so a wrong policy or an unscoped write route passes |
| Confirmed 3 | low | Nothing refuses to start when the runtime database role can bypass row-level security |
| Confirmed 4 | low | Three escape hatches are wider than the code that uses them needs |
| Suspicion 1 | high | On Neon the role behind `DATABASE_URL` may hold `BYPASSRLS`, which would switch off every policy |
| Suspicion 2 | low | Many foreign keys to tenant tables leave out `tenant_id`, which gives an existence oracle if any route skips the parent check |

The core design is sound. I could not find a request path where a member of tenant A reads or writes tenant B's rows through the API as long as the database role is what ADR 0018 (Postgres, SQLAlchemy and row-level security) says it is.

## Confirmed findings

### Confirmed 1 (medium). A workspace made from a shared mail domain that is not on the deny-list is open to every stranger on that domain

It lives in `apps/api/src/parfocal_api/workspace_access.py:51-105` (the `PUBLIC_EMAIL_DOMAINS` set, the `PUBLIC_EMAIL_PREFIXES` tuple and `email_domain_of`), `apps/api/src/parfocal_api/own_workspaces.py:102` (the new tenant saves the creator's domain) and `apps/api/src/parfocal_api/tables.py:193` (`join_policy` defaults to `join`).

The owner accepted that a matching verified domain joins at once (decision 75a in `docs/decisions.md`, "a matching email domain joins at once by default", and ADR 0265, join a workspace by its verified email domain). That rule is only safe when the domain belongs to one organisation. ADR 0265 itself says so at line 20: the creator's domain is saved "except for public mail providers such as gmail.com or seznam.cz, whose workspaces are never listed". So the gap is against the ADR's own intent, not against a risk the owner accepted. The only guard is a hand-kept deny-list of 32 domains and 7 prefixes, matched exactly or by prefix (`is_public_domain`, line 95). Every consumer or ISP mail domain missing from it behaves like a private company domain. Examples that pass `email_domain_of` today are `onet.pl`, `btinternet.com`, `comcast.net`, `ymail.com`, `rambler.ru`, `126.com`, `naver.com`, `laposte.net`, `protonmail.ch`, `mailbox.org`, `duck.com` and `privaterelay.appleid.com`.

The sequence that breaks the invariant:

1. Person V signs in with `v@onet.pl` and calls `POST /api/me/workspaces`. The tenant row gets `email_domain = 'onet.pl'` and `join_policy = 'join'`.
2. Stranger S registers a free `s@onet.pl` mailbox, verifies it with Zitadel and signs in. S has no membership anywhere.
3. S calls `GET /api/me/joinable-workspaces` and receives V's workspace id, name, logo, member count and project count (`workspace_access.py:245-306`). This already reveals that tenant B exists to someone outside it.
4. S calls `POST /api/me/joinable-workspaces/{tenant_id}/membership` and becomes a reviewer of V's workspace (`workspace_access.py:314-336`). S can now call `GET /api/tenant/members` (the reviewer role holds "see people" as view only) and is assignable to tasks.

The existing tests miss it because `apps/api/tests/test_workspace_access.py:66`, `:164` and `:326` only use domains that are on the list (`gmail.com`, `Seznam.cz`, `outlook.de`, `yahoo.co.uk`). Nothing asserts what happens for a mail provider that is not on it, and the isolation suite seeds a unique `<slug>.example.test` domain per tenant so the two seeded tenants never share one.

The failing test I would add to `apps/api/tests/test_workspace_access.py`:

```python
@pytest.mark.parametrize("domain", ["onet.pl", "btinternet.com", "comcast.net", "ymail.com"])
def test_a_workspace_on_a_shared_mail_provider_is_not_open_to_strangers(
    browser: Browser, domain: str
) -> None:
    sign_in(browser, f"founder-{secrets.token_hex(4)}@{domain}")
    made = browser.post("/api/me/workspaces", json={"name": "Private lab"})
    assert made.status_code == 201
    sign_in(browser, f"stranger-{secrets.token_hex(4)}@{domain}")
    assert browser.get("/api/me/joinable-workspaces").json() == []
    joined = browser.post(f"/api/me/joinable-workspaces/{made.json()['tenant_id']}/membership")
    assert joined.status_code == 404
```

The smallest fix is to stop saving the domain when a person creates a workspace. Insert the tenant with `email_domain=None` in `own_workspaces.py:102` and let an admin opt in through `PUT /api/tenant/join-settings`, which already checks that the domain is the admin's own and not public. A deny-list can never be complete, so the safe default is "not listed until someone with admin rights says so". If the owner wants to keep the automatic claim, the next smallest fix is to create such workspaces with `join_policy='ask'`, so a stranger can at most send a request that an admin must approve. Either way this is a product choice that touches decision 75a, so it belongs in `docs/decisions.md`.

One assumption sits under the whole feature. `auth.py:351` trusts the `email_verified` claim from Zitadel. If the Zitadel instance ever links an external identity provider that marks addresses as verified without proving them, the domain rule and the invitation email check both fall. I could not check the Zitadel settings from the repository.

### Confirmed 2 (medium). The isolation checks compare policy names and GET routes only, so a wrong policy or an unscoped write route passes

It lives in `packages/py-common/src/parfocal_common/schema_sql.py:15-42` (the two catalogue queries), `apps/api/tests/test_migrations.py:187-194` (the tests that run them) and `apps/api/tests/test_tenant_isolation.py:1839-1856` (the route and table completeness tests).

What the suite proves today is that every table has `ENABLE` and `FORCE`, that every table with a `tenant_id` column has a policy named `tenant_isolation`, that every table name appears in one of four hand-kept sets, and that every GET operation is listed and shows tenant B none of tenant A's marker strings. I checked the 83 tables created by the 91 migrations against that and all of them do have `ENABLE`, `FORCE` and a policy today.

Four changes would break the invariant and still pass:

1. A migration that writes `CREATE POLICY tenant_isolation ON new_table USING (true)` or leaves out `WITH CHECK`. `TENANT_TABLES_WITHOUT_ISOLATION` looks at `polname` only, never at `polqual`, `polwithcheck`, `polcmd` or `polpermissive`.
2. A migration that adds a second permissive policy to an isolated table, such as `CREATE POLICY readers ON cases FOR SELECT USING (true)`. Permissive policies are joined with OR, so this opens the table to every tenant. The catalogue query does not count policies. The route test only catches it if a GET route happens to return those rows with a marker string in them.
3. A new table that holds tenant data through a foreign key but has no `tenant_id` column, with any policy at all. It passes `TABLES_WITHOUT_ROW_SECURITY`, and adding its name to `CASE_TABLES` satisfies `test_every_table_is_seeded_by_the_suite`, because that test compares names and does not check that both tenants have rows in it.
4. A new POST, PUT, PATCH or DELETE route that opens its own `scoped_transaction` with a client-supplied tenant id, the way `join_workspace` does. `test_every_get_operation_is_in_the_suite` filters on `method == "get"`. The API has 134 GET operations and 172 others, and inside this suite the others are covered only by two hand-written tests (`test_an_annotate_task_and_its_class_snapshot_stay_in_their_workspace` and `test_another_workspace_cannot_answer_an_ask`). Feature test files may send cross-tenant writes of their own. I did not read all of them, and nothing forces a new write route to have one.

The only test that asks the database directly as the application role is `test_auth_tables_are_hidden_from_tenant_scopes`, and it covers the four auth tables.

The failing tests I would add. The first goes in `apps/api/tests/test_migrations.py` and pins the full policy set, so any new or changed policy needs a reviewed edit of one file:

```python
POLICIES = """
SELECT c.relname, p.polname, p.polcmd, p.polpermissive,
       pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = current_schema() ORDER BY 1, 2
"""

def test_the_policies_at_head_are_the_reviewed_ones(empty_database: str) -> None:
    command.upgrade(alembic_config(empty_database), "head")
    found = [tuple(row) for row in query(empty_database, POLICIES)]
    assert found == json.loads(Path(__file__).with_name("policies_at_head.json").read_text())
```

The second goes in `apps/api/tests/test_tenant_isolation.py` and probes every table as the application role, so a table cannot hide behind a list:

```python
def test_no_table_shows_a_row_of_another_tenant_or_to_no_tenant(database, seeded) -> None:
    a, b = seeded
    tables = tenant_id_tables(database)
    assert visible_rows(database, DatabaseScope(tenant_id=b.tenant_id), tables, a.tenant_id) == {}
    assert visible_rows(database, DatabaseScope(), tables, a.tenant_id) == {}
    assert all(seeded_rows(database, a.tenant_id)[table] > 0 for table in tables)
```

`visible_rows` runs `SELECT count(*) FROM <table> WHERE tenant_id = :a` through `APP_URL` under the given scope and returns the non-zero counts. The last line fails when a tenant table has no seeded row, which closes the `CASE_TABLES` gap. The third makes the route list complete for every method:

```python
def test_every_operation_is_classified() -> None:
    operations = {op["operationId"] for path in openapi_schema()["paths"].values() for op in path.values()}
    assert operations == set(GET_ROUTES) | set(WRITE_ROUTES)
```

with a `WRITE_ROUTES` map that gives each write operation a path built from tenant A's ids and a body, and a parametrised test that sends it as tenant B and expects 403 or 404 and unchanged row counts for tenant A.

The smallest fix is the first test plus its snapshot file. It is about twenty lines and turns every policy change into a visible diff.

### Confirmed 3 (low). Nothing refuses to start when the runtime database role can bypass row-level security

It lives in `apps/api/src/parfocal_api/app.py:158` (the engine is created from `settings.database_url` with no check), and the same holds for `retention.py:296`, `stale_uploads.py:66`, `operators.py:13` and `workers/ingest/src/parfocal_ingest/__main__.py:37`.

All isolation rests on one fact that lives outside the code: the role in `DATABASE_URL` is not a superuser and does not hold `BYPASSRLS`. Locally that is true because `infra/local/postgres-init.sql:1` creates `parfocal_app` with `NOBYPASSRLS`. Nothing in the repository creates that role anywhere else, and nothing checks it. `FORCE ROW LEVEL SECURITY` on every table does protect against the API connecting as the table owner, so a non-superuser owner is safe, but a superuser or a `BYPASSRLS` role sees every tenant's rows on every route with no error at all.

The sequence that breaks the invariant: deploy with `DATABASE_URL` set to the owner connection string (the value in `MIGRATION_DATABASE_URL`, or the one Neon hands out by default), then any member calls `GET /api/projects` and receives every tenant's projects.

The tests miss it because they always connect through `APP_URL` as `parfocal_app`, which is the correct role, and no test starts the app with the owner role.

The failing test I would add to `apps/api/tests/test_app.py` (or wherever app start is tested):

```python
def test_the_api_refuses_a_role_that_bypasses_row_security(database: str) -> None:
    settings = api_settings(database_url=with_database(OWNER_URL, database))
    with pytest.raises(UnsafeDatabaseRoleError), TestClient(create_app(settings)):
        pass
```

The smallest fix is a start-up check in `parfocal_common.db`, called from the app lifespan and from the worker and job entry points:

```python
UNSAFE_ROLE = text("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user")

async def require_safe_role(engine: AsyncEngine) -> None:
    async with engine.connect() as connection:
        if await connection.scalar(UNSAFE_ROLE):
            raise UnsafeDatabaseRoleError
```

### Confirmed 4 (low). Three escape hatches are wider than the code that uses them needs

None of these is reachable from a request today. Each one removes a layer, so a later bug or an injection in the named code path would cross tenants where the policy could have stopped it.

1. `apps/api/migrations/versions/0007_service_accounts.py:105-106` creates `auth_touch ON api_tokens FOR UPDATE USING (auth) WITH CHECK (auth)`. The auth scope needs it only to set `last_used_at` (`auth.py:255-257`). As written the auth scope may rewrite `tenant_id`, `service_account_id`, `token_hash`, `revoked_at` and `expires_at` of any tenant's token. The smallest fix is one migration with `REVOKE UPDATE ON api_tokens FROM parfocal_app` followed by `GRANT UPDATE (last_used_at, revoked_at) ON api_tokens TO parfocal_app`, since tokens are never edited in any other way.
2. `apps/api/migrations/versions/0004_users_and_memberships.py:101-102` creates `users_write FOR ALL USING (platform OR auth OR id = current user)`. A plain member or signed-in scope may therefore change its own `email` and `subject` and delete its own row. `email` is the trust anchor for joining by domain and for accepting an invitation, and `subject` is the identity itself. The only self-service write that uses this branch is the email schedule in `notifications.py:460`. The smallest fix is a `BEFORE UPDATE` trigger on `users` that raises when `email` or `subject` changes and `app.auth` and `app.platform` are both off, plus splitting the policy so the `id = current user` branch is `FOR UPDATE` only.
3. `apps/api/src/parfocal_api/workspace_access.py:206-209` and `apps/api/src/parfocal_api/own_workspaces.py:72` open a scope with `platform=True` and `auth=True` together with a tenant id that came from the URL path (`join_workspace`, `ask_to_join_workspace`) before anything is checked. Inside that transaction row-level security allows writes to every tenant's `tenants`, `organisations`, `memberships`, `invitations`, `jobs`, `tenant_keys`, `users` and `sessions` rows. I read every statement in the four routes and each one carries its own tenant or user predicate, and `joinable_tenant` runs first, so there is no leak today. The smallest fix is to do the domain check in a first transaction under `DatabaseScope(user_id=..., platform=True)`, then open the write transaction as `DatabaseScope(tenant_id=tenant_id, user_id=person.user_id, auth=True)`, which is what `accept_invitation` already does at `invitations.py:474`. The membership insert passes through `tenant_isolation` and no longer needs the platform flag.

The tests miss all three because they exercise the routes, and the routes are correct. A test for each would be a direct database probe in `apps/api/tests/test_tenant_isolation.py`, for example:

```python
def test_the_auth_scope_cannot_move_or_revive_an_api_token(database, seeded) -> None:
    a, b = seeded
    with pytest.raises(DBAPIError):
        run_as_app(database, DatabaseScope(auth=True),
                   update(api_tokens).where(api_tokens.c.tenant_id == a.tenant_id)
                   .values(tenant_id=b.tenant_id, revoked_at=None))

def test_a_member_cannot_change_their_own_email_in_the_database(database, seeded) -> None:
    a, _ = seeded
    scope = DatabaseScope(tenant_id=a.tenant_id, user_id=a.ids["user"])
    with pytest.raises(DBAPIError):
        run_as_app(database, scope,
                   update(users).where(users.c.id == a.ids["user"]).values(email="x@other.example"))
```

## Suspicions

### Suspicion 1 (high). On Neon the role behind `DATABASE_URL` may hold `BYPASSRLS`, which would switch off every policy

This is the production face of Confirmed 3 (nothing refuses to start with a role that bypasses row-level security). I could not prove it because no deploy workflow or role-creation step for Neon exists in the repository and I did not query any cloud database.

What points to it:

1. Neon's "Manage roles" page (https://neon.com/docs/manage/roles, read on 2026-11-09) says that the role created with a project (`<database>_owner`) and every role created in the Neon Console, through the API or with `neon roles create` without `--access` is granted membership in `neon_superuser`, and that such roles "inherit the privileges assigned to this role". The page lists `BYPASSRLS` among them for projects created after 2023-08-15. It also says that a role made with SQL `CREATE ROLE`, or with `neon roles create --access read_write`, does not get that membership. In stock Postgres `BYPASSRLS` is a role attribute that membership does not pass on, so the page alone does not prove the login role itself has it. That is why the query below reads `rolbypassrls` of the connected role, which is the value that decides.
2. `docs/adr/0050-deploy-pipeline-and-previews.md:120` (ADR 0050, the deploy pipeline and previews) plans the preview `DATABASE_URL` as "returned by the Neon API for `pr-<n>`". The connection string the Neon API returns for a fresh branch is for a role copied from the parent branch, and unless someone made `parfocal_app` with SQL on the parent, the only role there is the owner.
3. Nothing in the project's memory records how `parfocal_app` was made on Neon. `board.py find` for `parfocal_app`, `neon role` and `BYPASSRLS` returns nothing, and in `docs/knowledge`, `docs/adr` and `docs/results` the role is only mentioned for the local compose setup and in ADR 0018 (Postgres, SQLAlchemy and row-level security), which states the intent "a role that owns nothing and has `NOBYPASSRLS`".
4. The migrations need a role named `parfocal_app` to exist (`0001_baseline.py:18-25` grants to it and later migrations revoke from it). On Neon somebody has to create it, and the obvious ways are the console and the API.

If it is true, every route returns and changes every tenant's rows, with no error, and the whole isolation suite still passes because it runs locally.

To settle it, run this read-only query against each cloud database through the same connection string the API uses:

```sql
SELECT current_user, rolsuper, rolbypassrls,
       pg_has_role(current_user, 'neon_superuser', 'member') AS neon_superuser
FROM pg_roles WHERE rolname = current_user;
```

`rolsuper` and `rolbypassrls` must be false. They decide whether policies apply. `neon_superuser` should be false too, because that membership also brings `pg_read_all_data`, `pg_write_all_data` and `CREATEROLE`, which an application role should not have. If any is true, create the role with SQL as the owner (`CREATE ROLE parfocal_app LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`), point `DATABASE_URL` at it, and add the start-up check from Confirmed 3 (the role check at start) so the API cannot run any other way. The test is the one given there.

### Suspicion 2 (low). Many foreign keys to tenant tables leave out `tenant_id`, which gives an existence oracle if any route skips the parent check

Foreign key checks ignore row-level security. A row in tenant A that names a parent id of tenant B is accepted when the key does not include `tenant_id`. Some keys in the schema are composite with `tenant_id` (for example `review_tasks` to `study_template_versions` in `0044_study_templates.py:142-148` and `legal_holds` to `projects` in `0036_retention.py:209`). Most are not. The single-column ones are the weakest: `report_links.task_id`, `resume_states.task_id` and `slide_id`, `display_presets.task_id`, `display_choices.task_id` and `preset_id`, `adjudications.task_id`, `slide_coverage.slide_id`, `evaluation_changes.slide_id`, `clinical_deposits.slide_id`, `projects.study_template_id`, `lab_model_projects.lab_model_id` and `project_id`, `threads.result_set_id`, `thread_messages.thread_id`, `invitations.task_id`, `task_nudges.task_id`, `task_reassignments.task_id`, `site_validations.announcement_id`, `uploads.job_id`, `result_sets.job_id`, `api_tokens.service_account_id`, `annotation_versions.annotation_id`, `result_objects.result_set_id`, `result_chunks.result_set_id` and `slide_counters.slide_id`. The many `(x_id, project_id)` keys are safe only as long as the route proves the project belongs to the caller.

If a route inserts such a row without first selecting the parent under the tenant scope, a member of tenant A learns whether a uuid exists in tenant B (success against a foreign key error), and A's hidden row then blocks B from hard-deleting its own parent, or is deleted by B's cascade.

I sampled eight insert paths (`home.py:445-466`, `display.py:207-232`, `display.py:333-356`, `lab_models.py:361-371`, `slide_coverage.py:172-188`, `projects.py:405-432`, `threads.py:355-427` and `workspace_access.py:487-519`) and every one reads the parent under row-level security first and answers 404. I did not read the other insert paths, so this stays a suspicion. The ids are random uuids, which keeps the impact low even if one route is wrong.

The test would go in `apps/api/tests/test_tenant_isolation.py` as a database probe that needs no route:

```python
def test_a_row_cannot_point_at_a_parent_in_another_workspace(database, seeded) -> None:
    a, b = seeded
    scope = DatabaseScope(tenant_id=b.tenant_id, user_id=b.ids["user"])
    for statement in cross_tenant_children(a, b):
        with pytest.raises(IntegrityError, match="fk_"):
            run_as_app(database, scope, statement)
```

where `cross_tenant_children` builds one complete insert per single-column key with `tenant_id = b` and the parent id taken from `a`. The `match` on the foreign key constraint name keeps a missing required column from passing the test by accident. I did not run it. From the constraint definitions it should fail today for every key in the list above, because the insert is accepted. The smallest fix is one migration that adds `UNIQUE (id, tenant_id)` to the parents that lack it and replaces each single-column key with `(x_id, tenant_id)` referencing `(id, tenant_id)`, starting with the tables whose rows a client names directly (`resume_states`, `display_choices`, `display_presets`, `lab_model_projects`, `threads`).

## What I checked and found sound

1. All 83 tables created in `apps/api/migrations/versions/` get `ENABLE` and `FORCE ROW LEVEL SECURITY` in the migration that creates them. No table is created with raw SQL, renamed, partitioned or inherited, and there are no views or materialized views.
2. The shared policy expression `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid` fails closed. An unset or empty setting gives NULL, which matches no row for `USING` and rejects every row for `WITH CHECK`. A non-uuid value raises an error. The policy has no command clause, so it covers SELECT, INSERT, UPDATE and DELETE. The same holds for the user setting. The platform and auth flags compare with the literal `'on'` after `COALESCE`, so an empty or unset flag is off.
3. The hand-written policies on `tenants`, `organisations`, `users`, `memberships`, `audit_events`, `audit_people`, `tenant_keys`, `jobs`, `invitations`, `service_accounts`, `api_tokens`, `session_policies`, `report_links`, `study_templates` and `study_template_versions`. Sub-selects inside them run under the caller's row-level security. Under the platform flag alone no clinical or case table returns a row. The auth flag reads `users`, `memberships`, tokens, invitations, session policies and report links, and writes `users`, `sessions`, `api_tokens` and tenant-less audit events.
4. The scope is always set with `set_config(..., true)` inside `scoped_transaction` (`db.py:72-94`). There is no session-level `SET`, no `SET ROLE`, no mid-request commit, no raw `engine.begin()` or `engine.connect()` outside `scoped_transaction` in application code, and no use of `MIGRATION_DATABASE_URL` at run time (only `migrations/env.py` and the local load script read it).
5. The 24 places that build a `DatabaseScope`. The tenant id comes from the session row, re-checked against `memberships` on every request (`auth.py:193-213` and `auth.py:326`), from the service account row of a hashed token (`auth.py:232-258`), from an invitation or report link found by its hashed token, from the job row, or from a loop over tenants. The two places where it comes from the URL path are covered in Confirmed 4 (escape hatches wider than needed), item 3.
6. Workspace switching (`users.py:319-355`) only accepts a tenant found in the caller's own memberships under the user scope. Accepting an invitation checks revoked, used, suspended, expired and that the verified email equals the invited one before it inserts the membership. The user's email is written only from an id token with `email_verified` true and cannot be changed through any route.
7. Background work. `claim` in `packages/py-common/src/parfocal_common/jobs.py:305` runs under the platform scope and touches only `jobs`. Every step, renewal and finish uses the tenant id of the claimed row. `retention.py:274-293`, `stale_uploads.py:24-62`, `worklist_events.py:111-118`, `review_order_job.py` and both workers open one tenant scope per tenant or per job. Storage keys are built as `t/<tenant_id>/...` from the row's own tenant id.
8. `parfocal_retention_purge()` in `0036_retention.py:41-155` is the only `SECURITY DEFINER` function. It pins `search_path`, refuses to run without a tenant setting, filters every top-level statement by that tenant, and is executable by the application role only. The other functions are plain triggers that run as the caller.
9. Unique constraints. The global ones are `organisations.slug`, `tenants.slug`, `users.subject`, `audit_people.subject`, `sessions.id`, the three token hashes and `uploads.object_key`. None is fed by a value a tenant member chooses freely (workspace slugs get a random suffix, object keys carry the tenant id), so none works as an existence oracle. The rest are scoped by a parent uuid.
10. The in-process report cache is keyed by tenant id (`report_cache.py:9-17`), and room and tile tokens carry the tenant or the slide key read under the tenant scope. I did not review the edge worker that verifies them.
