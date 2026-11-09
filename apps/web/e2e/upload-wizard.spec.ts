import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const storage = "http://127.0.0.1:9161/e2e";

type Tree = { name: string; text?: string; children?: Tree[] };

const batch: Tree = {
  name: "P07-upload",
  children: [
    {
      name: "S26-04812",
      children: [
        { name: "A1_HE.svs", text: "slide-a1" },
        { name: "A1_HE.geojson", text: "{}" },
        { name: "A2_HE.svs", text: "slide-a2" },
        { name: "A2_HE", children: [{ name: "cells.csv", text: "x,y" }] },
      ],
    },
    { name: "tumor_031.tif", text: "slide-t31" },
    {
      name: "results",
      children: [
        { name: "tumor_031_prob.png", text: "png" },
        { name: "mystery_heatmap.png", text: "png2" },
      ],
    },
    { name: "notes.txt", text: "notes" },
  ],
};

async function writeTree(root: string, tree: Tree) {
  const here = join(root, tree.name);
  if (tree.children === undefined) {
    await writeFile(here, tree.text ?? "");
    return;
  }
  await mkdir(here, { recursive: true });
  for (const child of tree.children) await writeTree(here, child);
}

type Created = { filename: string; caseId: string | null; uploadId: string };

type Gate = {
  release: () => void;
  created: Created[];
  pairs: { uploadId: string; slideUploadId: string }[];
};

const caseS2604812 = "00000000-0000-4000-8004-000000000001";

async function fakeStorage(page: Page, hold: boolean): Promise<Gate> {
  let release: () => void = () => undefined;
  const gate = hold ? new Promise<void>((done) => (release = done)) : Promise.resolve();
  let counter = 0;
  const created: Created[] = [];
  const pairs: { uploadId: string; slideUploadId: string }[] = [];
  page.on("request", (request) => {
    const match = /\/api\/uploads\/([^/]+)\/slide$/.exec(new URL(request.url()).pathname);
    if (request.method() !== "PUT" || match === null) return;
    const body = request.postDataJSON() as { slide_upload_id: string };
    pairs.push({ uploadId: match[1] ?? "", slideUploadId: body.slide_upload_id });
  });
  const cors = (route: { request: () => { headers: () => Record<string, string> } }) => ({
    "access-control-allow-origin": route.request().headers()["origin"] ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-expose-headers": "ETag, Location",
  });
  await page.context().route(`${storage}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = cors(route);
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    const path = url.pathname.replace("/e2e", "");
    if (request.method() === "GET" && path === "/uploads/open") {
      await route.fulfill({ status: 404, headers, json: { type: "no-open-upload" } });
      return;
    }
    if (request.method() === "POST" && path === "/uploads/s3/multipart") {
      counter += 1;
      const draft = request.postDataJSON() as {
        filename: string;
        metadata: { case_id?: string };
      };
      created.push({
        filename: draft.filename,
        caseId: draft.metadata.case_id ?? null,
        uploadId: `up-${counter}`,
      });
      await route.fulfill({
        status: 201,
        headers,
        json: {
          key: `t/x/quarantine/${counter}/file`,
          uploadId: `up-${counter}`,
          part_size: 16777216,
          part_count: 1,
        },
      });
      return;
    }
    if (request.method() === "GET" && /\/uploads\/s3\/multipart\/[^/]+\/\d+$/.test(path)) {
      await route.fulfill({
        status: 200,
        headers,
        json: { url: `${storage}/part/${path.split("/")[4]}`, expires: 900 },
      });
      return;
    }
    if (request.method() === "GET" && path.startsWith("/uploads/s3/multipart/")) {
      await route.fulfill({ status: 200, headers, json: [] });
      return;
    }
    if (request.method() === "PUT" && path.startsWith("/part/")) {
      await gate;
      await route.fulfill({ status: 200, headers: { ...headers, etag: '"abc"' }, body: "" });
      return;
    }
    if (request.method() === "POST" && path.endsWith("/complete")) {
      await route.fulfill({
        status: 200,
        headers,
        json: { location: "/jobs/1", key: "k", uploadId: "u", job_id: "j", etag: "abc" },
      });
      return;
    }
    await route.fulfill({ status: 200, headers, json: {} });
  });
  return { release, created, pairs };
}

async function dropTree(page: Page, selector: string, tree: Tree) {
  await page.evaluate(
    ({ selector: target, tree: root }) => {
      const entryOf = (node: Tree): unknown =>
        node.children === undefined
          ? {
              isFile: true,
              isDirectory: false,
              name: node.name,
              file: (done: (file: File) => void) => done(new File([node.text ?? ""], node.name)),
            }
          : {
              isFile: false,
              isDirectory: true,
              name: node.name,
              createReader: () => {
                let given = false;
                return {
                  readEntries: (done: (entries: unknown[]) => void) => {
                    done(given ? [] : (node.children ?? []).map(entryOf));
                    given = true;
                  },
                };
              },
            };
      DataTransferItem.prototype.webkitGetAsEntry = () => entryOf(root) as FileSystemEntry;
      const transfer = new DataTransfer();
      transfer.items.add(new File(["x"], root.name));
      const element = document.querySelector(target);
      if (element === null) throw new Error("No drop target");
      element.dispatchEvent(
        new DragEvent("dragover", { dataTransfer: transfer, bubbles: true, cancelable: true }),
      );
      element.dispatchEvent(
        new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
      );
    },
    { selector, tree },
  );
}

let workdir = "";

test.use({ actionTimeout: 20_000 });
expect.configure({ timeout: 20_000 });

test.beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "parfocal-wizard-e2e-"));
  await writeTree(workdir, batch);
});

test.afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test("the empty wizard explains the folder shape that works", async ({ page }) => {
  await page.goto(`/projects/${p07}/upload`);
  await expect(page.getByTestId("upload-page")).toHaveAttribute("data-scene", "empty", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("drop-area")).toContainText(
    "Drop slides, results or a whole folder",
  );
  await expect(page.getByText("What folder shape works")).toBeVisible();
  await expect(
    page.getByText("A folder is a case, and its name becomes the case number."),
  ).toBeVisible();
  await expect(page.getByTestId("upload-summary")).toContainText("Nothing yet");
  await expect(page.getByTestId("upload-next")).toBeDisabled();
});

test("a chosen folder is listed by case and slide with each result under its slide", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}/upload`);
  await page.getByTestId("folder-input").setInputFiles(join(workdir, "P07-upload"));
  await expect(page.getByTestId("upload-page")).toHaveAttribute("data-scene", "files");
  await expect(page.getByText("Case S26-04812")).toBeVisible();
  await expect(page.getByText("Loose slides", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Same folder, same name")).toBeVisible();
  await expect(page.getByText("In a folder named like the slide")).toBeVisible();
  await expect(page.getByText("Same name, other folder")).toBeVisible();
  await expect(page.getByTestId("not-matched")).toContainText("mystery_heatmap.png");
  await expect(page.getByText("notes.txt", { exact: false }).first()).toBeVisible();
  await expect(page.getByTestId("upload-summary")).toContainText("1 new case, 1 loose");
  await page.getByRole("button", { name: "Add a result file for A1_HE" }).first().waitFor();
  await page.getByRole("button", { name: "Change" }).click();
  await expect(page.getByTestId("pairing-rule")).toBeVisible();
  await page.getByRole("radio", { name: "Slide ID inside only" }).click();
  await expect(page.getByTestId("grouping-line")).toContainText("Grouped by the slide ID inside");
  await expect(page.getByTestId("not-matched")).toContainText("A1_HE.geojson");
  await page.getByRole("radio", { name: "Folder, then name, then ID" }).click();
  await page.getByRole("radio", { name: "Keep all loose" }).click();
  await expect(page.getByText("Case S26-04812")).toHaveCount(0);
});

test("the check step shows an unplaced result and an empty file, and only Start upload is filled", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}/upload`);
  await page.getByTestId("folder-input").setInputFiles(join(workdir, "P07-upload"));
  await page.getByTestId("upload-next").click();
  await expect(page.getByTestId("upload-page")).toHaveAttribute("data-scene", "check");
  await expect(page.getByTestId("upload-problem")).toHaveCount(1);
  await expect(page.getByTestId("upload-problem")).toContainText(
    "This result file has no slide yet",
  );
  await expect(page.getByTestId("check-summary")).toContainText("1 file");
  await page.getByRole("button", { name: "Leave it out" }).click();
  await expect(page.getByTestId("upload-fixed")).toContainText("Left out of this upload");
  await expect(page.getByTestId("upload-problem")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("upload-problem")).toHaveCount(1);
  await page.getByRole("button", { name: "Files" }).first().click();
  await expect(page.getByTestId("upload-page")).toHaveAttribute("data-scene", "files");
});

test("a result added for a slide goes under it and Undo sends it back", async ({ page }) => {
  await page.goto(`/projects/${p07}/upload`);
  await page.getByTestId("folder-input").setInputFiles(join(workdir, "P07-upload"));
  await page.getByRole("button", { name: "Add a result file for tumor_031" }).click();
  await page.getByTestId("add-result-input").setInputFiles({
    name: "extra_cells.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("a,b"),
  });
  await expect(page.getByText("Picked by you")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("not-matched")).toContainText("extra_cells.csv");
});

test("a folder dropped on a project is sorted, an unmatched result is placed, and the upload runs on in the jobs tray", async ({
  page,
}) => {
  const gate = await fakeStorage(page, true);
  await page.goto(`/projects/${p07}`);
  await expect(page.getByTestId("project-page")).toBeVisible();

  await dropTree(page, '[data-testid="project-page"]', batch);
  await expect(page).toHaveURL(/upload/);
  await expect(page.getByTestId("upload-page")).toHaveAttribute("data-scene", "files");
  await expect(page.getByText("Case S26-04812")).toBeVisible();
  await expect(page.getByText("Same folder, same name")).toBeVisible();
  await expect(page.getByText("In a folder named like the slide")).toBeVisible();
  await expect(page.getByTestId("not-matched")).toContainText(
    "P07-upload/results/mystery_heatmap.png",
  );

  await page.getByTestId("not-matched").getByRole("combobox", { name: "Choose a slide" }).click();
  await page.getByRole("option", { name: "P07-upload/tumor_031.tif" }).click();
  await expect(page.getByTestId("not-matched")).toHaveCount(0);
  await expect(page.getByText("Picked by you")).toBeVisible();

  await page.getByTestId("upload-next").click();
  await expect(page.getByTestId("upload-page")).toHaveAttribute("data-scene", "check");
  await expect(page.getByTestId("upload-problem")).toHaveCount(0);
  await expect(page.getByTestId("check-summary")).toContainText("Nothing needs you");
  await expect(page.getByTestId("start-upload")).toContainText("Upload 3 slides and 4 results");
  await page.getByTestId("start-upload").click();

  await expect(page.getByTestId("upload-page")).toHaveAttribute("data-scene", "progress");
  await expect(page.getByTestId("upload-overall")).toContainText("of 7 files uploaded");
  await expect(page.getByTestId("upload-file-row")).toHaveCount(7);

  await page.getByTestId("close-upload").click();
  await expect(page.getByTestId("project-page")).toBeVisible();
  await page.getByRole("button", { name: /^Jobs/ }).click();
  const job = page.getByTestId("browser-upload-job");
  await expect(job).toContainText("Uploading 7 files");

  gate.release();
  await expect(job).toContainText("Uploaded 7 files", { timeout: 20_000 });

  const idOf = (filename: string) => gate.created.find((item) => item.filename === filename);
  expect(idOf("A1_HE.svs")?.caseId).toBe(caseS2604812);
  expect(idOf("A1_HE.geojson")?.caseId).toBe(caseS2604812);
  expect(idOf("cells.csv")?.caseId).toBe(caseS2604812);
  expect(idOf("tumor_031.tif")?.caseId).toBeNull();
  expect(idOf("mystery_heatmap.png")?.caseId).toBeNull();
  const linkedTo = (filename: string) =>
    gate.pairs.find((pair) => pair.uploadId === idOf(filename)?.uploadId)?.slideUploadId;
  await expect.poll(() => gate.pairs.length).toBe(4);
  expect(linkedTo("A1_HE.geojson")).toBe(idOf("A1_HE.svs")?.uploadId);
  expect(linkedTo("cells.csv")).toBe(idOf("A2_HE.svs")?.uploadId);
  expect(linkedTo("tumor_031_prob.png")).toBe(idOf("tumor_031.tif")?.uploadId);
  expect(linkedTo("mystery_heatmap.png")).toBe(idOf("tumor_031.tif")?.uploadId);
});

test("a slide opens from the upload while its results are still being placed", async ({ page }) => {
  await fakeStorage(page, false);
  await page.goto(`/projects/${p07}`);
  await expect(page.getByTestId("project-page")).toBeVisible();
  await dropTree(page, '[data-testid="project-page"]', batch);
  await expect(page.getByTestId("not-matched")).toBeVisible();
  await page.getByTestId("not-matched").getByRole("combobox", { name: "Choose a slide" }).click();
  await page.getByRole("option", { name: "P07-upload/tumor_031.tif" }).click();
  await page.getByTestId("upload-next").click();
  await page.getByTestId("start-upload").click();
  await expect(page.getByTestId("upload-page")).toHaveAttribute("data-scene", "progress");

  const row = page.getByTestId("upload-file-row").filter({ hasText: "A1_HE.svs" });
  await row.getByRole("button", { name: /processing steps/ }).click();
  await expect(row.getByText("Tiles built")).toBeVisible();
  await expect(row.getByText("Results read")).toBeVisible();
  const open = row.getByRole("button", { name: "Open now with what is ready" });
  await expect(open).toBeVisible({ timeout: 20_000 });
  await expect(row).toHaveAttribute("data-ingest", "processing");
  await open.click();
  await expect(page).toHaveURL(/\/slides\//);
});
