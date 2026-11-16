import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  deleteZitadelUser,
  readSession,
  root,
  sql,
  zitadelIssuer,
  zitadelUserIds,
} from "./support.ts";

const idpImage = "kristophjunge/test-saml-idp:1.15";
const idpPort = process.env["PARFOCAL_SAML_IDP_PORT"] ?? "8091";
const idpContainer = `${process.env["COMPOSE_PROJECT_NAME"] ?? "parfocal"}-saml-idp-${idpPort}`;
const idpOrigin = `http://localhost:${idpPort}`;
const domain = "example.com";
const linkedEmail = `user2@${domain}`;
const slug = `sso-${Date.now().toString(36)}`;
const projectOrganisation = process.env["ZITADEL_ORGANIZATION_ID"] ?? "";

let tenantId = "";
let idpId = "";
let workdir = "";
let metadataFile = "";

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

function startIdp(entityId: string): void {
  execFileSync("docker", ["rm", "-f", idpContainer], { stdio: "ignore" });
  docker(
    "run",
    "--detach",
    "--platform",
    "linux/amd64",
    "--name",
    idpContainer,
    "--publish",
    `127.0.0.1:${idpPort}:8080`,
    "--env",
    `SIMPLESAMLPHP_SP_ENTITY_ID=${entityId}`,
    "--env",
    `SIMPLESAMLPHP_SP_ASSERTION_CONSUMER_SERVICE=${zitadelIssuer}/ui/login/login/externalidp/saml/acs`,
    idpImage,
  );
}

async function idpMetadata(): Promise<string> {
  let metadata = "";
  await expect(async () => {
    const response = await fetch(`${idpOrigin}/simplesaml/saml2/idp/metadata.php`);
    expect(response.status).toBe(200);
    metadata = await response.text();
  }).toPass({ timeout: 90_000 });
  return metadata;
}

function tenantCommand(...args: string[]): string {
  return execFileSync(
    "uv",
    ["run", "--package", "parfocal-api", "python", "-m", "parfocal_api.tenant_command", ...args],
    { cwd: root, encoding: "utf8" },
  ).trim();
}

function zitadel(path: string, organisation: string, body?: unknown): Promise<Response> {
  return fetch(`${zitadelIssuer}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${process.env["ZITADEL_ADMIN_TOKEN"] ?? ""}`,
      "content-type": "application/json",
      "x-zitadel-orgid": organisation,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function parfocalProjectId(): Promise<string> {
  const response = await zitadel("/management/v1/projects/_search", projectOrganisation, {});
  const body = (await response.json()) as { result: { id: string }[] };
  const project = body.result[0]?.id;
  if (!project) {
    throw new Error("The local Zitadel has no Parfocal project");
  }
  return project;
}

async function connectSaml(): Promise<{ organisation: string; idp: string }> {
  const connected = tenantCommand(
    "connect-saml",
    tenantId,
    "--metadata-file",
    metadataFile,
    "--email-domain",
    domain,
    "--project-organisation-id",
    projectOrganisation,
    "--project-id",
    await parfocalProjectId(),
    "--default-role",
    "researcher",
    "--group-role",
    "group1=reviewer",
    "--groups-attribute",
    "eduPersonAffiliation",
    "--subject-attribute",
    "uid",
  );
  sql(
    "UPDATE sso_connections SET domain_proofs = jsonb_set(domain_proofs, " +
      `'{${domain},proven_at}', to_jsonb(now()::text)) WHERE tenant_id = '${tenantId}'`,
  );
  return {
    organisation: /idp_organisation_id=(\S+)/.exec(connected)?.[1] ?? "",
    idp: /idp_id=(\S+)/.exec(connected)?.[1] ?? "",
  };
}

async function countIn(organisation: string, path: string, body: unknown): Promise<number> {
  const response = await zitadel(path, organisation, body);
  expect(response.status).toBe(200);
  return ((await response.json()) as { result?: unknown[] }).result?.length ?? 0;
}

async function signInThroughOrganisation(page: Page, user: string, typed: string): Promise<void> {
  await page.goto("/sign-in?return_to=/");
  await page.getByRole("button", { name: "Sign in with your organisation" }).click();
  await page.getByRole("textbox", { name: "Institution or email domain" }).fill(typed);
  await page.getByRole("button", { name: "Continue to your organisation's sign-in" }).click();
  await expect(page).toHaveURL(new RegExp(`^${idpOrigin}/simplesaml/`));
  await page.locator("input[name=username]").fill(user);
  await page.locator("input[name=password]").fill(`${user}pass`);
  await page.locator("input[name=password]").press("Enter");
  const app = new URL(test.info().project.use.baseURL ?? "").origin;
  await page.waitForURL((url) => url.origin === app && !url.pathname.startsWith("/api/"), {
    timeout: 60_000,
  });
  await page.waitForLoadState();
}

function roleOf(subject: string): string {
  return sql(
    "SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id " +
      `WHERE u.subject = '${subject}' AND m.tenant_id = '${tenantId}'`,
  );
}

async function forgetPasswordAccounts(): Promise<void> {
  for (const userId of await zitadelUserIds(linkedEmail)) {
    await deleteZitadelUser(userId);
  }
  sql(`UPDATE users SET email = NULL WHERE lower(email) = '${linkedEmail}'`);
}

test.describe("per-workspace SSO", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    const stale = sql(
      `SELECT tenant_id FROM sso_connections WHERE '${domain}' = ANY(email_domains)`,
    );
    for (const leftover of stale.split("\n").filter(Boolean)) {
      tenantCommand("deprovision", leftover);
    }
    await forgetPasswordAccounts();
    workdir = mkdtempSync(join(tmpdir(), "parfocal-sso-"));
    startIdp("http://placeholder.invalid/metadata");
    metadataFile = join(workdir, "idp-metadata.xml");
    writeFileSync(metadataFile, await idpMetadata());
    tenantId = tenantCommand(
      "provision",
      "--organisation-slug",
      slug,
      "--organisation-name",
      "SSO Hospital",
      "--slug",
      slug,
      "--name",
      "SSO Hospital research",
      "--kind",
      "research",
    );
    idpId = (await connectSaml()).idp;
    expect(idpId).not.toBe("");
    startIdp(`${zitadelIssuer}/idps/${idpId}/saml/metadata`);
    await idpMetadata();
  });

  test.afterAll(async () => {
    execFileSync("docker", ["rm", "-f", idpContainer], { stdio: "ignore" });
    if (tenantId) {
      tenantCommand("deprovision", tenantId);
    }
    await forgetPasswordAccounts();
    if (workdir) {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  test("running connect-saml again updates the connection instead of adding a second one", async () => {
    const again = await connectSaml();
    expect(again.idp).toBe(idpId);
    expect(sql(`SELECT count(*) FROM sso_connections WHERE tenant_id = '${tenantId}'`)).toBe("1");
    expect(await countIn(again.organisation, "/management/v1/idps/templates/_search", {})).toBe(1);
    const byName = { actionNameQuery: { name: "parfocalSso", method: "TEXT_QUERY_METHOD_EQUALS" } };
    expect(
      await countIn(again.organisation, "/management/v1/actions/_search", { queries: [byName] }),
    ).toBe(1);
    const flow = await zitadel("/management/v1/flows/1", again.organisation);
    const triggers = (
      (await flow.json()) as { flow: { triggerActions?: { actions: unknown[] }[] } }
    ).flow.triggerActions;
    expect(triggers?.flatMap((trigger) => trigger.actions)).toHaveLength(1);
  });

  test("a user signs in from the sign-in screen through the workspace's SAML IdP and joins with the mapped role", async ({
    page,
  }) => {
    await signInThroughOrganisation(page, "user1", domain);
    const session = await readSession(page);
    expect(session.email).toBe("user1@example.com");
    expect(roleOf(session.subject)).toBe("reviewer");
    expect(
      sql(
        `SELECT active_tenant_id FROM sessions WHERE subject = '${session.subject}' ` +
          "ORDER BY created_at DESC LIMIT 1",
      ),
    ).toBe(tenantId);
  });

  test("a password account with the same verified email is linked on its first SSO sign-in", async ({
    page,
  }) => {
    const secret = `${randomBytes(12).toString("base64url")}Aa1!`;
    const created = await zitadel("/v2/users/human", projectOrganisation, {
      organization: { orgId: projectOrganisation },
      username: linkedEmail,
      profile: { givenName: "Linked", familyName: "Person" },
      email: { email: linkedEmail, isVerified: true },
      password: { password: secret, changeRequired: false },
    });
    expect(created.ok).toBe(true);
    await page.goto("/sign-in?return_to=/");
    await page.getByLabel("Work email").fill(linkedEmail);
    await page.getByLabel("Password", { exact: true }).fill(secret);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe("/");
    const before = await readSession(page);
    await page.context().clearCookies();

    await signInThroughOrganisation(page, "user2", `user2@${domain}`);
    const after = await readSession(page);
    expect(after.subject).toBe(before.subject);
    expect(after.email).toBe(linkedEmail);
    expect(sql(`SELECT count(*) FROM users WHERE lower(email) = '${linkedEmail}'`)).toBe("1");
    expect(roleOf(before.subject)).toBe("researcher");
  });
});
