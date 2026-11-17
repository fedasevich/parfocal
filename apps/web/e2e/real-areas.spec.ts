import { expect, type Page, test } from "@playwright/test";
import { area, ok, realTags, sampleTask, signIn } from "./real.ts";

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
    const { project, slide } = await sampleTask(page, "review");
    await page.goto(`/projects/${project}/slides/${slide}`);
    await expect(page.getByTestId("slide-stage")).toHaveAttribute(
      "data-state",
      /^(ready|failed)$/,
      { timeout: 45_000 },
    );
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
    const { task } = await sampleTask(page, "review");
    await page.goto(`/tasks/${task}/evaluation`);
    await noNotice(page);
    expect(unanswered).toEqual([]);
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
