import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { area, ok, onRealApi, realTags, signIn } from "./real.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const fixtures = join(
  process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"),
  "parfocal",
  "fixtures",
);

interface ProjectRow {
  id: string;
  my_role: string | null;
  archived_at: string | null;
  privacy_mode: string;
  sample: boolean;
}

interface SlidePage {
  slides: { id: string }[];
}

async function ownedProject(page: Page): Promise<string> {
  await ok(page, "POST", "/api/projects/sample");
  const open = (await ok<ProjectRow[]>(page, "GET", "/api/projects")).filter(
    (row) => row.archived_at === null && row.privacy_mode !== "clinical",
  );
  const project = (open.find((row) => row.my_role === "owner") ?? open[0])?.id ?? "";
  expect(project, "the user owns a project to upload into").not.toBe("");
  return project;
}

async function miraxFolder(batch: string): Promise<void> {
  const stem = `mirax-${Date.now()}`;
  execFileSync("unzip", ["-q", join(fixtures, "CMU-1-Saved-1_16.zip"), "-d", batch]);
  await rename(join(batch, "CMU-1-Saved-1_16.mrxs"), join(batch, `${stem}.mrxs`));
  await rename(join(batch, "CMU-1-Saved-1_16"), join(batch, stem));
}

async function dicomZip(batch: string): Promise<void> {
  await copyFile(join(fixtures, "CMU-1-JP2K-33005-v2.zip"), join(batch, `dicom-${Date.now()}.zip`));
}

const uploads = [
  {
    what: "a MIRAX folder",
    fixture: "CMU-1-Saved-1_16.zip",
    place: miraxFolder,
    seconds: 240,
  },
  {
    what: "a DICOM zip",
    fixture: "CMU-1-JP2K-33005-v2.zip",
    place: dicomZip,
    seconds: 900,
  },
] as const;

async function distinctColours(page: Page): Promise<number> {
  const shot = await page.getByTestId("slide-host").screenshot();
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (context === null) return 0;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const seen = new Set<number>();
    for (let index = 0; index < data.length; index += 4 * 7) {
      seen.add(((data[index] ?? 0) << 16) | ((data[index + 1] ?? 0) << 8) | (data[index + 2] ?? 0));
    }
    return seen.size;
  }, shot.toString("base64"));
}

for (const { what, fixture, place, seconds } of uploads) {
  test(
    `${what} uploaded into a project is converted at ingest and draws in the viewer`,
    realTags(area.upload),
    async ({ page }) => {
      test.skip(!onRealApi, "Only the real stack runs the ingest worker");
      test.skip(!existsSync(join(fixtures, fixture)), `${fixture} is not downloaded`);
      test.setTimeout(seconds * 1000);
      await signIn(page, "/my-work");
      const project = await ownedProject(page);
      const listed = async () =>
        (await ok<SlidePage>(page, "GET", `/api/me/slides?project_id=${project}`)).slides.map(
          (slide) => slide.id,
        );
      const before = new Set(await listed());
      const folder = await mkdtemp(join(tmpdir(), "parfocal-zip-upload-"));
      try {
        await mkdir(join(folder, "batch"));
        await place(join(folder, "batch"));
        await page.goto(`/projects/${project}/upload`);
        await page.getByTestId("folder-input").setInputFiles(join(folder, "batch"));
        await page.getByTestId("upload-next").click();
        await expect(page.getByTestId("start-upload")).toBeEnabled();
        await page.getByTestId("start-upload").click();
        await expect(page.getByTestId("close-upload")).toHaveText("Done", { timeout: 120_000 });
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
      const published = async () => (await listed()).find((id) => !before.has(id));
      await expect.poll(published, { timeout: (seconds - 150) * 1000 }).toBeTruthy();
      const slide = await published();

      await page.goto(`/projects/${project}/slides/${slide}`);
      const stage = page.getByTestId("slide-stage");
      await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
      await expect(page.getByText("cannot be opened in the browser")).toHaveCount(0);
      await expect.poll(() => distinctColours(page), { timeout: 60_000 }).toBeGreaterThan(64);
    },
  );
}
