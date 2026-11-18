import { expect, type Page } from "@playwright/test";

export const email = process.env["PARFOCAL_SMOKE_EMAIL"] ?? "";
export const password = process.env["PARFOCAL_SMOKE_PASSWORD"] ?? "";

export const appSignIn = (page: Page) => page.getByRole("heading", { name: "Sign in to Parfocal" });
export const hostedLoginName = (page: Page) =>
  page.locator("input[name='loginName'], input#loginName, input[autocomplete='username']");

export async function readJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  return (await response.json()) as T;
}

export async function signIn(page: Page, origin: string) {
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

const galleryProjects = new Set([
  "Scanner format comparison",
  "Whole-slide format survey",
  "Vendor format robustness",
]);

export type Project = { id: string; name: string };
type SlidePage = { slides: { id: string; label: string }[] };

export async function galleryProject(page: Page): Promise<Project> {
  const projects = await readJson<Project[]>(page, "/api/projects");
  const gallery = projects.find((project) => galleryProjects.has(project.name));
  expect(gallery, "the signed-in owner sees a seeded format gallery").toBeDefined();
  return gallery as Project;
}

export async function seededSlide(page: Page, project: Project, label: string): Promise<string> {
  const listed = await readJson<SlidePage>(
    page,
    `/api/me/slides?project_id=${project.id}&limit=200`,
  );
  const slide = listed.slides.find((found) => found.label === label);
  expect(slide, `the gallery holds ${label}`).toBeDefined();
  return (slide as { id: string }).id;
}
