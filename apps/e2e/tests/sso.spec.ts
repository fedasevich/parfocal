import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { readSession, root, sql, zitadelIssuer } from "./support.ts";

const idpImage = "kristophjunge/test-saml-idp:1.15";
const idpPort = process.env["PARFOCAL_SAML_IDP_PORT"] ?? "8091";
const idpContainer = `${process.env["COMPOSE_PROJECT_NAME"] ?? "parfocal"}-saml-idp-${idpPort}`;
const idpOrigin = `http://localhost:${idpPort}`;
const domain = "example.com";
const slug = `sso-${Date.now().toString(36)}`;

let tenantId = "";
let workdir = "";

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

async function parfocalProjectId(): Promise<string> {
  const organisation = process.env["ZITADEL_ORGANIZATION_ID"] ?? "";
  const response = await fetch(`${zitadelIssuer}/management/v1/projects/_search`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env["ZITADEL_ADMIN_TOKEN"] ?? ""}`,
      "content-type": "application/json",
      "x-zitadel-orgid": organisation,
    },
    body: "{}",
  });
  const body = (await response.json()) as { result: { id: string }[] };
  const project = body.result[0]?.id;
  if (!project) {
    throw new Error("The local Zitadel has no Parfocal project");
  }
  return project;
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
    workdir = mkdtempSync(join(tmpdir(), "parfocal-sso-"));
    startIdp("http://placeholder.invalid/metadata");
    const metadataFile = join(workdir, "idp-metadata.xml");
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
    const connected = tenantCommand(
      "connect-saml",
      tenantId,
      "--metadata-file",
      metadataFile,
      "--email-domain",
      domain,
      "--project-organisation-id",
      process.env["ZITADEL_ORGANIZATION_ID"] ?? "",
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
    const idpId = /idp_id=(\S+)/.exec(connected)?.[1] ?? "";
    expect(idpId).not.toBe("");
    startIdp(`${zitadelIssuer}/idps/${idpId}/saml/metadata`);
    await idpMetadata();
  });

  test.afterAll(() => {
    execFileSync("docker", ["rm", "-f", idpContainer], { stdio: "ignore" });
    if (tenantId) {
      tenantCommand("deprovision", tenantId);
    }
    if (workdir) {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  test("a user signs in through the workspace's SAML IdP and joins with the mapped role", async ({
    page,
  }) => {
    await page.goto(`/api/auth/sso?domain=${domain}&return_to=/`);
    await expect(page).toHaveURL(new RegExp(`^${idpOrigin}/simplesaml/`));
    await page.locator("input[name=username]").fill("user1");
    await page.locator("input[name=password]").fill("user1pass");
    await page.locator("input[name=password]").press("Enter");
    const app = new URL(test.info().project.use.baseURL ?? "").origin;
    await page.waitForURL((url) => url.origin === app && !url.pathname.startsWith("/api/"), {
      timeout: 60_000,
    });
    await page.waitForLoadState();
    const session = await readSession(page);
    expect(session.email).toBe("user1@example.com");
    expect(
      sql(
        "SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id " +
          `WHERE u.subject = '${session.subject}' AND m.tenant_id = '${tenantId}'`,
      ),
    ).toBe("reviewer");
    expect(
      sql(`SELECT active_tenant_id FROM sessions WHERE subject = '${session.subject}' LIMIT 1`),
    ).toBe(tenantId);
  });
});
