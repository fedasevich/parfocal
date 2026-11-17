import { sql } from "./support.ts";

const run = process.env["PARFOCAL_E2E_RUN"] ?? "";
if (!/^[a-z0-9]+$/.test(run)) {
  throw new Error("PARFOCAL_E2E_RUN must be set by playwright.config.ts");
}

export const runSlugPrefix = `e2e-${run}-`;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type WorkspaceKind = "research" | "diagnostic";

export function newWorkspace(kind: WorkspaceKind): string {
  const slug = `${runSlugPrefix}${Math.floor(Math.random() * 36 ** 6).toString(36)}`;
  const [id = ""] = sql(
    `WITH organisation AS (INSERT INTO organisations (slug, name) VALUES ('${slug}', 'E2E ${slug}') RETURNING id) ` +
      `INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) ` +
      `SELECT id, '${slug}', 'E2E ${slug}', '${kind}', 'eu', 'pilot' FROM organisation RETURNING id`,
  ).split("\n");
  if (!uuid.test(id)) {
    throw new Error(`The workspace insert returned ${JSON.stringify(id)}`);
  }
  return id;
}

export function researcherWorkspace(userId: string): string {
  const tenantId = newWorkspace("research");
  sql(
    `INSERT INTO memberships (tenant_id, user_id, role) VALUES ('${tenantId}', '${userId}', 'researcher')`,
  );
  return tenantId;
}

const purge = (doomed: string) => `DO $purge$
DECLARE
  doomed uuid[] := ARRAY(SELECT id FROM tenants WHERE ${doomed});
  owners uuid[];
  scoped record;
  link record;
  orphan text;
  changed bigint;
  total bigint;
BEGIN
  IF cardinality(doomed) = 0 THEN
    RETURN;
  END IF;
  owners := ARRAY(SELECT organisation_id FROM tenants WHERE id = ANY(doomed));
  PERFORM set_config('session_replication_role', 'replica', true);
  FOR scoped IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE tenant_id = ANY($1)', scoped.table_name) USING doomed;
  END LOOP;
  DELETE FROM tenants WHERE id = ANY(doomed);
  DELETE FROM organisations o WHERE o.id = ANY(owners)
    AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.organisation_id = o.id);
  LOOP
    total := 0;
    FOR link IN
      SELECT con.conrelid::regclass AS child, con.confrelid::regclass AS parent,
        array_agg(quote_ident(ca.attname::text) ORDER BY k.i) AS columns,
        array_agg(quote_ident(pa.attname::text) ORDER BY k.i) AS refs,
        bool_and(NOT ca.attnotnull) AS nullable
      FROM pg_constraint con
      CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(own, ref, i)
      JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = k.own
      JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = k.ref
      WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace
      GROUP BY con.oid, con.conrelid, con.confrelid
    LOOP
      SELECT string_agg(format('c.%s IS NOT NULL', col), ' AND ')
        || format(' AND NOT EXISTS (SELECT 1 FROM %s p WHERE ', link.parent)
        || string_agg(format('p.%s = c.%s', ref, col), ' AND ') || ')'
      INTO orphan
      FROM unnest(link.columns, link.refs) AS pair(col, ref);
      IF link.nullable AND cardinality(link.columns) = 1 THEN
        EXECUTE format('UPDATE %s c SET %s = NULL WHERE %s', link.child, link.columns[1], orphan);
      ELSE
        EXECUTE format('DELETE FROM %s c WHERE %s', link.child, orphan);
      END IF;
      GET DIAGNOSTICS changed = ROW_COUNT;
      total := total + changed;
    END LOOP;
    EXIT WHEN total = 0;
  END LOOP;
END
$purge$`;

export function purgeWorkspace(tenantId: string): void {
  if (!uuid.test(tenantId)) {
    throw new Error(`Not a workspace id: ${JSON.stringify(tenantId)}`);
  }
  sql(purge(`id = '${tenantId}'`));
}

export function purgeRun(): void {
  sql(purge(`starts_with(slug, '${runSlugPrefix}')`));
}

export interface Counts {
  workspaces: number;
  organisations: number;
}

export function counts(): Counts {
  const [workspaces = "", organisations = ""] = sql(
    "SELECT (SELECT count(*) FROM tenants) || '|' || (SELECT count(*) FROM organisations)",
  ).split("|");
  return { workspaces: Number(workspaces), organisations: Number(organisations) };
}
