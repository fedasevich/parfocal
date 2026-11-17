import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
  area,
  ok,
  onRealApi,
  realTags,
  signIn,
  storageStandIn,
  taskWithEveryReviewIn,
  viewableTask,
} from "./real.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const fakeStorage = "http://127.0.0.1:9161/e2e";
const slideFixture = fileURLToPath(
  new URL("../../../packages/test-fixtures/synthetic/synthetic-jpeg.tiff", import.meta.url),
);
const corners = [
  [520, 250],
  [700, 270],
  [680, 420],
  [540, 400],
] as const;

interface ProjectRow {
  id: string;
  my_role: string | null;
  archived_at: string | null;
  privacy_mode: string;
  sample: boolean;
}

interface TaskStates {
  signed_off_at: string | null;
  slides: { state: string }[];
}

interface Decision {
  object: string;
  value: string;
}

interface Me {
  user_id: string;
}

test(
  "a password signs in and lands where the user was going",
  realTags(area.login),
  async ({ page }) => {
    await signIn(page, "/my-work");
    const me = await ok<Me>(page, "GET", "/api/me");
    expect(me.user_id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.getByRole("main")).toBeVisible();
  },
);

test(
  "a guided review decision is stored for the slide",
  realTags(area.review),
  async ({ page }) => {
    await signIn(page, "/my-work");
    const { task, slide } = await viewableTask(page, "review", true);
    await page.goto(`/tasks/${task}/guided?slide=${slide}`);
    const decisions = `/api/review-tasks/${task}/slides/${slide}/decisions`;
    const stored = async () => (await ok<Decision[]>(page, "GET", decisions)).length;
    const answers = page.getByRole("group", { name: /^Your (answer|call) on / }).first();
    await expect(answers).toBeVisible({ timeout: 30_000 });
    const before = await stored();
    await answers.getByRole("button").first().click();
    await expect.poll(stored).toBe(before + 1);
  },
);

test("a slide uploaded into a project finishes", realTags(area.upload), async ({ page }) => {
  await signIn(page, "/my-work");
  if (!onRealApi) await storageStandIn(page, fakeStorage);
  await ok(page, "POST", "/api/projects/sample");
  const open = (await ok<ProjectRow[]>(page, "GET", "/api/projects")).filter(
    (row) => row.archived_at === null && row.privacy_mode !== "clinical",
  );
  const project =
    (
      open.find((row) => row.sample && row.my_role === "owner") ??
      open.find((row) => row.my_role === "owner") ??
      open[0]
    )?.id ?? "";
  expect(project, "the user owns a project to upload into").not.toBe("");
  const folder = await mkdtemp(join(tmpdir(), "parfocal-real-upload-"));
  try {
    await mkdir(join(folder, "batch"));
    await copyFile(slideFixture, join(folder, "batch", "real-check.tiff"));
    await page.goto(`/projects/${project}/upload`);
    await page.getByTestId("folder-input").setInputFiles(join(folder, "batch"));
    await page.getByTestId("upload-next").click();
    await expect(page.getByTestId("start-upload")).toBeEnabled();
    await page.getByTestId("start-upload").click();
    await expect(page.getByTestId("upload-page")).toHaveAttribute("data-scene", /progress|done/);
    await expect(page.getByTestId("close-upload")).toHaveText("Done", { timeout: 60_000 });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("an annotate task slide keeps a drawn region", realTags(area.annotate), async ({ page }) => {
  await signIn(page, "/my-work");
  const { project, task, slide } = await viewableTask(page, "annotate");
  await page.goto(`/projects/${project}/slides/${slide}/live?task=${task}`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-layer", "shared");
  const drawn = page.locator('[data-testid="task-object"][data-origin="human"]');
  const before = await drawn.count();
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  for (const [x, y] of corners) await page.mouse.click(box.x + x, box.y + y);
  await page.mouse.click(box.x + corners[0][0] + 2, box.y + corners[0][1] + 1);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await expect(drawn).toHaveCount(before + 1);
  await page.reload();
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(drawn).toHaveCount(before + 1);
});

test(
  "the owner signs off a task whose reviews are all in",
  realTags(area.signOff),
  async ({ page }) => {
    await signIn(page, "/my-work");
    const task = await taskWithEveryReviewIn(page);
    await page.goto(`/tasks/${task}/sign-off`);
    const modal = page.getByRole("dialog", { name: /^Sign off / });
    await expect(modal).toBeVisible({ timeout: 30_000 });
    const sign = modal.getByRole("button", { name: /^Sign with/ });
    await expect(sign).toBeEnabled();
    await sign.click();
    await expect(modal.getByText(/Evaluation v1 · signed/)).toBeVisible();
    const states = `/api/review-tasks/${task}/states`;
    await expect
      .poll(async () => (await ok<TaskStates>(page, "GET", states)).signed_off_at)
      .not.toBeNull();
  },
);
