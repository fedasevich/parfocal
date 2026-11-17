import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { appSignIn, email, hostedLoginName, password, readJson, signIn } from "./session.ts";
import { errorScreenShown, report, type Watch, watch } from "./watch.ts";

type Listed = { id: string; label?: string };
type CaseDetail = { id: string; label: string; slides: { id: string }[] };

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
}

async function visit(page: Page, seen: Watch, info: TestInfo, name: string, path: string | null) {
  seen.step(name);
  if (path !== null) await page.goto(path);
  await settle(page);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: false });
  expect(await errorScreenShown(page), `${name} shows an error screen`).toBeNull();
}

test("a signed-out visitor gets the sign-in, not a broken screen", async ({
  page,
  context,
  baseURL,
}, info) => {
  const origin = baseURL ?? "";
  const seen = await watch(context, origin);
  seen.step("signed-out");
  await page.goto("/");
  await expect(appSignIn(page).or(hostedLoginName(page)).first()).toBeVisible();
  await visit(page, seen, info, "signed-out", null);
  expect(seen.problems, report(seen.problems)).toEqual([]);
});

test("a signed-in person opens home, a workspace, a case and the viewer", async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(
    email === "" || password === "",
    "PARFOCAL_SMOKE_EMAIL and PARFOCAL_SMOKE_PASSWORD are not set",
  );
  const origin = baseURL ?? "";
  const seen = await watch(context, origin);
  seen.step("sign-in");
  await signIn(page, origin);
  expect(new URL(page.url()).origin).toBe(new URL(origin).origin);
  seen.signedIn();

  await visit(page, seen, info, "home", "/");

  const projects = await readJson<Listed[]>(page, "/api/projects");
  const project = projects[0];
  expect(project, "the smoke account sees at least one workspace").toBeDefined();
  if (project === undefined) return;
  await visit(page, seen, info, "workspace", `/projects/${project.id}`);

  const cases = await readJson<Listed[]>(page, `/api/cases?project_id=${project.id}`);
  const first = cases[0];
  expect(first, "the smoke workspace holds at least one case").toBeDefined();
  if (first === undefined) return;
  const detail = await readJson<CaseDetail>(page, `/api/cases/${first.id}`);
  await expect(page.getByText(detail.label, { exact: true }).first()).toBeVisible();
  await visit(page, seen, info, "case", null);

  const slide = detail.slides[0];
  expect(slide, "the smoke case holds at least one slide").toBeDefined();
  if (slide === undefined) return;
  seen.step("viewer");
  await page.goto(`/projects/${project.id}/slides/${slide.id}`);
  await expect(page.getByTestId("slide-stage")).toBeVisible();
  await expect(page.getByTestId("slide-host").locator("canvas").first()).toBeVisible();
  await visit(page, seen, info, "viewer", null);

  expect(seen.problems, report(seen.problems)).toEqual([]);
});
