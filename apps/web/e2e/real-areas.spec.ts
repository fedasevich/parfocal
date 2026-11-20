import { expect, type Page, test } from "@playwright/test";
import {
  expectReadablePage,
  pageSvg,
  pdfViewer,
  printed,
  readingPage,
  stepAndZoom,
  stubPrint,
} from "./pdf-preview-steps.ts";
import { area, ok, realTags, signIn, viewableTask } from "./real.ts";

test.use({ viewport: { width: 1440, height: 900 } });

interface Unanswered {
  method: string;
  url: string;
  status: number;
}

function watchUnanswered(page: Page): Unanswered[] {
  const found: Unanswered[] = [];
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/")) return;
    const status = response.status();
    const method = response.request().method();
    if (status === 405) found.push({ method, url: url.pathname, status });
    if (status !== 404) return;
    const body: unknown = await response.json().catch(() => null);
    const detail = (body as { detail?: unknown } | null)?.detail;
    if (detail === "Not Found") found.push({ method, url: url.pathname, status });
  });
  return found;
}

async function noNotice(page: Page): Promise<void> {
  await expect(page.getByRole("main").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/is not available yet/)).toHaveCount(0);
}

test(
  "a project overview and its slide list come from the real API",
  realTags(area.project),
  async ({ page }) => {
    await signIn(page, "/my-work");
    const unanswered = watchUnanswered(page);
    const sample = await ok<{ id: string }>(page, "POST", "/api/projects/sample");
    await page.goto(`/projects/${sample.id}`);
    await noNotice(page);
    expect(unanswered).toEqual([]);
  },
);

test(
  "the slide viewer reads its panels from the real API",
  realTags(area.viewer),
  async ({ page }) => {
    await signIn(page, "/my-work");
    const unanswered = watchUnanswered(page);
    const { project, slide } = await viewableTask(page, "review");
    await page.goto(`/projects/${project}/slides/${slide}`);
    await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
      timeout: 45_000,
    });
    await noNotice(page);
    expect(unanswered).toEqual([]);
  },
);

test(
  "the models section lists the catalogue from the real API",
  realTags(area.models),
  async ({ page }) => {
    await signIn(page, "/my-work");
    const unanswered = watchUnanswered(page);
    await page.goto("/admin?section=models");
    await noNotice(page);
    expect(unanswered).toEqual([]);
  },
);

test(
  "a task evaluation report opens from the real API",
  realTags(area.reports),
  async ({ page }) => {
    await signIn(page, "/my-work");
    const unanswered = watchUnanswered(page);
    const { task } = await viewableTask(page, "review");
    await page.goto(`/tasks/${task}/evaluation`);
    await noNotice(page);
    expect(unanswered).toEqual([]);
  },
);

test(
  "the evaluation PDF preview shows the real PDF pages, steps, zooms and prints",
  realTags(area.reports),
  async ({ page }) => {
    await signIn(page, "/my-work");
    const { task } = await viewableTask(page, "review");
    await page.goto(`/tasks/${task}/evaluation`);
    await page.getByRole("button", { name: "Preview the PDF" }).click();
    await expect(page).toHaveURL(/view=pdf/);
    const preview = pdfViewer(page);
    const first = preview.getByRole("img", { name: "Page 1 of the report" });
    await expectReadablePage(page, first);
    expect(await pageSvg(first)).toMatch(/^<svg[^>]+viewBox=/);
    const count = Number((await readingPage(page).textContent())?.split("/")[1]?.trim());
    expect(count).toBeGreaterThan(0);
    await stepAndZoom(page, count);
    await stubPrint(page);
    await preview.getByRole("button", { name: "Print" }).click();
    await expect.poll(async () => (await printed(page)).length).toBe(1);
    expect((await printed(page))[0]?.pages).toBe(count);
    const file = await page.evaluate(async (path) => {
      const response = await fetch(path, { credentials: "same-origin" });
      const head = new Uint8Array(await response.arrayBuffer()).subarray(0, 5);
      return { type: response.headers.get("content-type"), head: String.fromCharCode(...head) };
    }, `/api/review-tasks/${task}/evaluation/exports/report.pdf`);
    expect(file.type).toContain("application/pdf");
    expect(file.head).toBe("%PDF-");
  },
);

test(
  "the admin overview and people read from the real API",
  realTags(area.admin),
  async ({ page }) => {
    await signIn(page, "/my-work");
    const unanswered = watchUnanswered(page);
    await page.goto("/admin");
    await noNotice(page);
    await page.goto("/admin?section=people");
    await noNotice(page);
    expect(unanswered).toEqual([]);
  },
);
