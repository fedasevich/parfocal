import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestFile, writeRandomFile } from "@parfocal/upload-spike/digest";
import { type StorageStack, startStorageStack } from "@parfocal/upload-spike/harness";
import { dockerIsUp } from "@parfocal/upload-spike/minio";
import { expect, type Page, test } from "./a11y.ts";

const MIB = 1024 * 1024;
const PART_BYTES = 16 * MIB;
const p07 = "00000000-0000-4000-8003-000000000007";
const caseId = "00000000-0000-4000-8004-000000000001";
const uploadPage = `/projects/${p07}/cases/${caseId}/upload`;

const stackPorts = { apiPort: 9161, s3Port: 9162, minioPort: 9163 };

test.describe.configure({ mode: "serial", timeout: 300_000 });
test.skip(
  !process.env["PARFOCAL_UPLOAD_E2E"],
  "Set PARFOCAL_UPLOAD_E2E=1 to run the upload tests. They need Docker and write up to 1 GiB.",
);

let workdir = "";
let stack: StorageStack | null = null;

test.beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "parfocal-upload-e2e-"));
  test.skip(!(await dockerIsUp()), "Docker or the pinned MinIO image is not available");
});

test.afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test.afterEach(async () => {
  await stack?.stop();
  stack = null;
});

async function startStack(uplinkMbit: number): Promise<StorageStack> {
  stack = await startStorageStack({
    ...stackPorts,
    appOrigin: new URL(test.info().project.use.baseURL ?? "http://localhost:5183").origin,
    container: "parfocal-web-e2e-minio",
    uplinkBytesPerSecond: (uplinkMbit * 1_000_000) / 8,
    rttMs: 20,
    partBytes: PART_BYTES,
  });
  return stack;
}

async function waitForUploaded(current: StorageStack, bytes: number, timeoutMs: number) {
  await expect.poll(() => current.uploadedBytes(), { timeout: timeoutMs }).toBeGreaterThan(bytes);
}

function row(page: Page) {
  return page.getByTestId("upload-row");
}

test("a throttled 1 GiB upload resumes after a reload and finishes without resending stored parts", async ({
  page,
}) => {
  const size = 1024 * MIB;
  const file = join(workdir, "slide-1g.bin");
  await writeRandomFile(file, size);
  const source = await digestFile(file, PART_BYTES);
  const current = await startStack(400);

  await page.goto(uploadPage);
  await expect(page.getByTestId("upload-drawer")).toBeVisible();
  await page.getByTestId("file-input").setInputFiles(file);
  await expect(row(page)).toHaveAttribute("data-status", "uploading");

  await waitForUploaded(current, size * 0.35, 120_000);
  await page.reload();
  await expect(page.getByTestId("upload-drawer")).toBeVisible();
  await expect(row(page)).toHaveAttribute("data-status", "interrupted");
  await expect(row(page)).toContainText("Choose this file again");
  await page.waitForTimeout(1000);
  const bytesBeforeResume = current.uploadedBytes();
  const storedBeforeResume = await current.openStorageUploads();
  expect(storedBeforeResume).toBe(1);

  await page.getByTestId("file-input").setInputFiles(file);
  await expect(row(page)).toHaveAttribute("data-status", "done", { timeout: 180_000 });

  const object = await current.completedObject();
  expect(object).toEqual({ bytes: size, sha256: source.sha256 });
  expect(current.eventsOf("create")).toHaveLength(1);
  const signed = current.eventsOf("sign").map((event) => event.partNumber);
  const partCount = size / PART_BYTES;
  const resent = signed.length - new Set(signed).size;
  expect(new Set(signed).size).toBe(partCount);
  expect(resent).toBeLessThanOrEqual(1);
  const bytesAfterResume = current.uploadedBytes() - bytesBeforeResume;
  expect(bytesAfterResume).toBeLessThan(size - size * 0.3 + PART_BYTES);
  console.log(
    `upload-resume: size ${size}, bytes before reload ${bytesBeforeResume}, bytes after ${bytesAfterResume}, parts signed ${signed.length} of ${partCount}, parts sent again ${resent}`,
  );
});

test("pause and resume keep the stored parts, and a cut link is retried by itself", async ({
  page,
}) => {
  const size = 96 * MIB;
  const file = join(workdir, "slide-96m.bin");
  await writeRandomFile(file, size);
  const source = await digestFile(file, PART_BYTES);
  const current = await startStack(80);

  await page.goto(uploadPage);
  await page.getByTestId("file-input").setInputFiles(file);
  await waitForUploaded(current, 2 * MIB, 30_000);

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(row(page)).toHaveAttribute("data-status", "paused");
  await page.waitForTimeout(1500);
  const whilePaused = current.uploadedBytes();
  await page.waitForTimeout(1500);
  expect(current.uploadedBytes()).toBe(whilePaused);

  await page.getByRole("button", { name: "Resume" }).click();
  await expect(row(page)).toHaveAttribute("data-status", "uploading");
  await waitForUploaded(current, whilePaused + 20 * MIB, 30_000);

  await current.cutLink();
  await expect(row(page)).toHaveAttribute("data-status", "retrying", { timeout: 20_000 });
  await expect(row(page)).toContainText("Trying again");
  await current.restoreLink();
  await expect(row(page)).toHaveAttribute("data-status", "done", { timeout: 90_000 });

  const object = await current.completedObject();
  expect(object).toEqual({ bytes: size, sha256: source.sha256 });
  const signed = current.eventsOf("sign").map((event) => event.partNumber);
  expect(new Set(signed).size).toBe(size / PART_BYTES);
});

test("Cancel stops the upload and aborts it in storage", async ({ page }) => {
  const size = 96 * MIB;
  const file = join(workdir, "slide-96m-cancel.bin");
  await writeRandomFile(file, size);
  const current = await startStack(80);

  await page.goto(uploadPage);
  await page.getByTestId("file-input").setInputFiles(file);
  await waitForUploaded(current, 2 * MIB, 30_000);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(row(page)).toHaveCount(0);
  await expect.poll(() => current.eventsOf("abort").length).toBe(1);
  expect(await current.openStorageUploads()).toBe(0);
});
