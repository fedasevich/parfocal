import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const slideFixture = join(fixtures, "CMU-1-Small-Region.svs");

interface ProjectRow {
  id: string;
  my_role: string | null;
  archived_at: string | null;
  privacy_mode: string;
}

interface UploadState {
  status: string;
  reason: string | null;
  slide_id: string | null;
}

interface ResultSetRow {
  status: string;
}

async function deIdentifiedProject(page: Page): Promise<string> {
  await ok(page, "POST", "/api/projects/sample");
  const open = (await ok<ProjectRow[]>(page, "GET", "/api/projects")).filter(
    (row) => row.archived_at === null && row.privacy_mode !== "clinical",
  );
  const project = (open.find((row) => row.my_role === "owner") ?? open[0])?.id ?? "";
  expect(project, "the user owns a de-identified project to upload into").not.toBe("");
  return project;
}

async function writeSlide(folder: string, name: string, padding: number): Promise<void> {
  const bytes = await readFile(slideFixture);
  await writeFile(join(folder, name), Buffer.concat([bytes, Buffer.alloc(padding)]));
}

function cellsWithClass(className: string): string {
  const square = (x: number, y: number) => [
    [
      [x, y],
      [x + 40, y],
      [x + 40, y + 40],
      [x, y + 40],
      [x, y],
    ],
  ];
  return JSON.stringify({
    type: "FeatureCollection",
    features: [0, 1, 2].map((index) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: square(400 + index * 100, 600) },
      properties: { objectType: "detection", classification: { name: className } },
    })),
  });
}

function watchCreatedUploads(page: Page): Map<string, string[]> {
  const created = new Map<string, string[]>();
  page.on("response", async (response) => {
    const request = response.request();
    if (request.method() !== "POST" || !/\/uploads\/s3\/multipart$/.test(request.url())) return;
    if (!response.ok()) return;
    const { filename } = request.postDataJSON() as { filename: string };
    const { uploadId } = (await response.json()) as { uploadId: string };
    created.set(filename, [...(created.get(filename) ?? []), uploadId]);
  });
  return created;
}

async function chooseFolder(page: Page, project: string, folder: string): Promise<void> {
  await page.goto(`/projects/${project}/upload`);
  await page.getByTestId("folder-input").setInputFiles(folder);
  await page.getByTestId("upload-next").click();
}

test(
  "the Check step fixes act on the real upload, fixed files are stored and the others wait",
  realTags(area.upload),
  async ({ page }) => {
    test.skip(!onRealApi, "Only the real stack checks duplicates and imports result files");
    test.skip(!existsSync(slideFixture), "CMU-1-Small-Region.svs is not downloaded");
    test.setTimeout(600_000);
    await signIn(page, "/my-work");
    const project = await deIdentifiedProject(page);
    const created = watchCreatedUploads(page);
    const stamp = Date.now().toString(36);
    const kept = `kept-${stamp}.svs`;
    const undecided = `undecided-${stamp}.svs`;
    const fresh = `fresh-${stamp}`;
    const later = `later-${stamp}`;
    const lone = `lone-${stamp}.mrxs`;
    const stateOf = (upload: string) =>
      ok<UploadState>(page, "GET", `/api/uploads/${upload}/status`);
    const slideOf = async (upload: string | undefined) => {
      expect(upload, "the file was uploaded").toBeDefined();
      let slide: string | null = null;
      await expect
        .poll(
          async () => {
            const state = await stateOf(upload ?? "");
            slide = state.slide_id;
            return state.status;
          },
          { timeout: 240_000 },
        )
        .toBe("ready");
      return slide ?? "";
    };
    const root = await mkdtemp(join(tmpdir(), "parfocal-check-fixes-"));
    try {
      const seed = join(root, "seed", "batch");
      await mkdir(seed, { recursive: true });
      await writeSlide(seed, kept, 11);
      await writeSlide(seed, undecided, 23);
      await chooseFolder(page, project, seed);
      await expect(page.getByTestId("start-upload")).toBeEnabled();
      await page.getByTestId("start-upload").click();
      await expect(page.getByTestId("close-upload")).toHaveText("Done", { timeout: 120_000 });
      const first = await slideOf(created.get(kept)?.[0]);
      await slideOf(created.get(undecided)?.[0]);

      const mixed = join(root, "mixed", "batch");
      await mkdir(mixed, { recursive: true });
      await writeSlide(mixed, kept, 11);
      await writeSlide(mixed, undecided, 23);
      await writeSlide(mixed, `${fresh}.svs`, 37);
      await writeSlide(mixed, `${later}.svs`, 41);
      await writeFile(join(mixed, `${fresh}.geojson`), cellsWithClass(`Fresh class ${stamp}`));
      await writeFile(join(mixed, `${later}.geojson`), cellsWithClass(`Later class ${stamp}`));
      await writeFile(join(mixed, lone), "mirax without its data folder");
      await chooseFolder(page, project, mixed);

      const zones = page.getByTestId("upload-problem");
      const zoneOf = (text: string) => zones.filter({ hasText: text });
      await expect(zoneOf("This slide is already in the project")).toHaveCount(2);
      await expect(zoneOf("This MRXS slide has no data folder")).toHaveCount(1);
      await expect(page.getByTestId("check-summary")).toContainText("3 files need a look");
      await zoneOf(kept).getByRole("button", { name: "Keep both" }).click();
      await expect(page.getByTestId("upload-fixed").filter({ hasText: kept })).toContainText(
        "Kept next to the copy already here",
      );
      await expect(page.getByTestId("check-summary")).toContainText("2 files need a look");
      await expect(page.getByTestId("start-upload")).toContainText("Upload 3 slides and 2 results");
      await page.getByTestId("start-upload").click();
      await expect(page.getByTestId("upload-page")).toHaveAttribute("data-scene", "progress");

      const summary = page.getByTestId("result-problems-summary");
      await expect(summary).toContainText("2 result files need you", { timeout: 300_000 });
      await page.getByRole("combobox", { name: `Class for Fresh class ${stamp}` }).click();
      await page.getByRole("option").first().click();
      const freshBar = page
        .getByTestId("result-choice-bar")
        .filter({ hasText: `Import ${fresh}.geojson` });
      await expect(freshBar.getByTestId("import-result")).toBeEnabled();
      await freshBar.getByTestId("import-result").click();
      await expect(summary).toContainText("1 result file needs you", { timeout: 120_000 });
      await expect(
        page.getByRole("combobox", { name: `Class for Later class ${stamp}` }),
      ).toBeVisible();

      expect(created.get(kept)).toHaveLength(2);
      expect(created.get(undecided)).toHaveLength(1);
      expect(created.has(lone)).toBe(false);
      expect(created.has(lone.replace(".mrxs", ".zip"))).toBe(false);
      const copy = await slideOf(created.get(kept)?.[1]);
      expect(copy).not.toBe(first);
      const freshSlide = await slideOf(created.get(`${fresh}.svs`)?.[0]);
      const laterSlide = await slideOf(created.get(`${later}.svs`)?.[0]);
      const setsOf = (slide: string) =>
        ok<ResultSetRow[]>(page, "GET", `/api/slides/${slide}/result-sets`);
      await expect
        .poll(async () => (await setsOf(freshSlide)).map((set) => set.status), {
          timeout: 180_000,
        })
        .toContain("ready");
      expect((await setsOf(laterSlide)).filter((set) => set.status === "ready")).toHaveLength(0);
      const waiting = await stateOf(created.get(`${later}.geojson`)?.[0] ?? "");
      expect([waiting.status, waiting.reason]).toEqual(["waiting", "needs-choices"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
