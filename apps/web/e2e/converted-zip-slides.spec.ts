import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { devSlideFolders } from "../vite/dev-tiles.ts";
import { expect, type Page, test } from "./a11y.ts";

const repository = fileURLToPath(new URL("../../..", import.meta.url));
const fixtures = join(
  process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"),
  "parfocal",
  "fixtures",
);
const pilot = "00000000-0000-4000-8003-000000000011";

const zipped = [
  {
    fixture: "CMU-1-Saved-1_16.zip",
    label: "CMU-1-Saved-1_16 (MIRAX)",
    slideId: "00000000-0000-4000-8005-000000000024",
  },
  {
    fixture: "CMU-1-JP2K-33005-v2.zip",
    label: "CMU-1-JP2K-33005-v2 (DICOM)",
    slideId: "00000000-0000-4000-8005-000000000025",
  },
] as const;

test.describe.configure({ timeout: 600_000 });

function publishedFolder(fixture: string, slideId: string): string {
  const target = join(devSlideFolders, slideId);
  if (existsSync(join(target, "facts.json"))) return target;
  const work = mkdtempSync(join(tmpdir(), "converted-zip-"));
  try {
    execFileSync(
      "uv",
      [
        "run",
        "--package",
        "parfocal-ingest",
        "python",
        "-m",
        "parfocal_ingest.fixture_slides",
        "--into",
        work,
        fixture,
      ],
      { cwd: repository, stdio: "pipe", timeout: 540_000 },
    );
    const parent = join(work, "fixture-slides");
    const [folder] = readdirSync(parent);
    if (folder === undefined) throw new Error(`no folder was written for ${fixture}`);
    mkdirSync(devSlideFolders, { recursive: true });
    rmSync(target, { recursive: true, force: true });
    renameSync(join(parent, folder), target);
    return target;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

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

for (const { fixture, label, slideId } of zipped) {
  test(`${label} opens from the pyramid TIFF ingest made of ${fixture} and draws`, async ({
    page,
  }) => {
    test.skip(!existsSync(join(fixtures, fixture)), `${fixture} is not in ${fixtures}`);
    const folder = publishedFolder(fixture, slideId);
    expect(existsSync(join(folder, "original.tiff"))).toBe(true);
    const reads: string[] = [];
    page.on("response", (response) => {
      const { pathname } = new URL(response.url());
      if (pathname === `/tiles/${slideId}/original.tiff` && response.status() === 206) {
        reads.push(response.headers()["content-range"] ?? "");
      }
    });

    await page.goto(`/projects/${pilot}?tab=slides`);
    await expect(page.getByTestId("slide-title").filter({ hasText: label })).toBeVisible();

    await page.goto(`/projects/${pilot}/slides/${slideId}`);
    const stage = page.getByTestId("slide-stage");
    await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 120_000 });
    await expect(page.getByText(label).first()).toBeVisible();
    await expect(page.getByText("cannot be opened in the browser")).toHaveCount(0);
    await expect.poll(() => distinctColours(page), { timeout: 60_000 }).toBeGreaterThan(64);
    expect(reads.length).toBeGreaterThan(0);
  });
}
