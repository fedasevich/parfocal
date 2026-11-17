import { expect, type Page, test } from "@playwright/test";
import { email, password, readJson, signIn } from "./session.ts";
import { errorScreenShown, report, watch } from "./watch.ts";

const enabled = process.env["PARFOCAL_SMOKE_SEEDED_FORMATS"] === "1";

const galleryProjects = new Set([
  "Scanner format comparison",
  "Whole-slide format survey",
  "Vendor format robustness",
]);

const openedInTheBrowser = [
  ["aperio-svs", "CMU-1-Small-Region.svs"],
  ["hamamatsu-ndpi", "CMU-1.ndpi"],
  ["leica-scn", "Leica-1.scn"],
  ["ventana-bif", "Ventana-1.bif"],
  ["philips-tiff", "Philips-4.tiff"],
  ["huron-tiff", "Huron-1-40x.tif"],
  ["argos-avs", "Argos-1.avs"],
  ["generic-tiff", "CMU-1.tiff"],
  ["ome-tiff", "synthetic-zlib.ome.tiff"],
] as const;

const notInTheBrowserYet = [
  ["mirax", "CMU-1-Saved-1_16.zip"],
  ["dicom", "CMU-1-JP2K-33005-v2.zip"],
] as const;

type Project = { id: string; name: string };
type SlidePage = { slides: { id: string; label: string }[] };

async function galleryProject(page: Page): Promise<Project> {
  const projects = await readJson<Project[]>(page, "/api/projects");
  const gallery = projects.find((project) => galleryProjects.has(project.name));
  expect(gallery, "the signed-in owner sees a seeded format gallery").toBeDefined();
  return gallery as Project;
}

async function seededSlide(page: Page, project: Project, label: string): Promise<string> {
  const listed = await readJson<SlidePage>(
    page,
    `/api/me/slides?project_id=${project.id}&limit=200`,
  );
  const slide = listed.slides.find((found) => found.label === label);
  expect(slide, `the gallery holds ${label}`).toBeDefined();
  return (slide as { id: string }).id;
}

test.describe.configure({ timeout: 600_000 });

test.describe("seeded fixture slides open in the deployed viewer", () => {
  test.skip(!enabled, "PARFOCAL_SMOKE_SEEDED_FORMATS is not 1");
  test.skip(
    email === "" || password === "",
    "PARFOCAL_SMOKE_EMAIL and PARFOCAL_SMOKE_PASSWORD are not set",
  );

  test("one seeded slide of each browser format opens and serves its bytes", async ({
    page,
    context,
    baseURL,
  }, info) => {
    const origin = baseURL ?? "";
    const seen = await watch(context, origin);
    const refused: string[] = [];
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      const status = response.status();
      if (path.startsWith("/tiles/") && (status === 401 || status === 403 || status >= 500)) {
        refused.push(`${path} answered ${status}`);
      }
    });
    seen.step("sign-in");
    await signIn(page, origin);
    seen.signedIn();
    const project = await galleryProject(page);
    for (const [format, label] of openedInTheBrowser) {
      await test.step(format, async () => {
        const slideId = await seededSlide(page, project, label);
        seen.step(format);
        const original = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname.startsWith(`/tiles/${slideId}/original`) &&
            [200, 206].includes(response.status()),
        );
        await page.goto(`/projects/${project.id}/slides/${slideId}`);
        await expect(page.getByTestId("slide-stage")).toBeVisible();
        await original;
        await expect(page.getByTestId("slide-host").locator("canvas").first()).toBeVisible();
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
        await page.screenshot({ path: info.outputPath(`${format}.png`), fullPage: false });
        expect(await errorScreenShown(page), `${format} shows an error screen`).toBeNull();
      });
    }
    expect(refused, refused.join("\n")).toEqual([]);
    expect(seen.problems, report(seen.problems)).toEqual([]);
  });

  for (const [format, label] of notInTheBrowserYet) {
    test(`a seeded ${format} slide opens and serves its bytes`, () => {
      test.skip(true, `${label} needs a ${format} pixel source in the viewer engine first`);
    });
  }
});
