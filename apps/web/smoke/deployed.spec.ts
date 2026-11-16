import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { errorScreenShown, report, type Watch, watch } from "./watch.ts";

const email = process.env["PARFOCAL_SMOKE_EMAIL"] ?? "";
const password = process.env["PARFOCAL_SMOKE_PASSWORD"] ?? "";

type Listed = { id: string; label?: string };
type CaseDetail = { id: string; label: string; slides: { id: string }[] };

const appSignIn = (page: Page) => page.getByRole("heading", { name: "Sign in to Parfocal" });
const hostedLoginName = (page: Page) =>
  page.locator("input[name='loginName'], input#loginName, input[autocomplete='username']");

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

async function readJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  return (await response.json()) as T;
}

async function signIn(page: Page, origin: string) {
  await page.goto("/sign-in");
  await expect(appSignIn(page).or(hostedLoginName(page)).first()).toBeVisible();
  if (await appSignIn(page).isVisible()) {
    await page.getByRole("textbox", { name: "Work email" }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  } else {
    await hostedLoginName(page).fill(email);
    await page.locator("button[type='submit']").first().click();
    await page.locator("input[type='password']").fill(password);
    await page.locator("button[type='submit']").first().click();
  }
  const app = new URL(origin).origin;
  await page.waitForURL((url) => url.origin === app && !url.pathname.startsWith("/sign-in"));
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
