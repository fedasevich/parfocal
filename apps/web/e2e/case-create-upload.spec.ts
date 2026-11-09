import { expect, type Page, test } from "@playwright/test";

const deidentified = "00000000-0000-4000-8003-000000000007";
const clinical = "00000000-0000-4000-8003-000000000003";
const storage = "http://127.0.0.1:9161/e2e";

type Created = { filename: string; caseId: string | null };

async function fakeStorage(page: Page) {
  const created: Created[] = [];
  let counter = 0;
  const headersOf = (origin: string | undefined) => ({
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-expose-headers": "ETag, Location",
  });
  await page.context().route(`${storage}/**`, async (route) => {
    const request = route.request();
    const headers = headersOf(request.headers().origin);
    const path = new URL(request.url()).pathname.replace("/e2e", "");
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
    } else if (request.method() === "GET" && path === "/uploads/open") {
      await route.fulfill({ status: 404, headers, json: { type: "no-open-upload" } });
    } else if (request.method() === "POST" && path === "/uploads/s3/multipart") {
      counter += 1;
      const draft = request.postDataJSON() as {
        filename: string;
        metadata: { case_id?: string };
      };
      created.push({ filename: draft.filename, caseId: draft.metadata.case_id ?? null });
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
    } else if (request.method() === "GET" && /\/uploads\/s3\/multipart\/[^/]+\/\d+$/.test(path)) {
      await route.fulfill({
        status: 200,
        headers,
        json: { url: `${storage}/part/${path.split("/")[4]}`, expires: 900 },
      });
    } else if (request.method() === "GET" && path.startsWith("/uploads/s3/multipart/")) {
      await route.fulfill({ status: 200, headers, json: [] });
    } else if (request.method() === "PUT" && path.startsWith("/part/")) {
      await route.fulfill({ status: 200, headers: { ...headers, etag: '"abc"' }, body: "" });
    } else if (request.method() === "POST" && path.endsWith("/complete")) {
      await route.fulfill({
        status: 200,
        headers,
        json: { location: "/jobs/1", key: "k", uploadId: "u", job_id: "j", etag: "abc" },
      });
    } else {
      await route.fulfill({ status: 200, headers, json: {} });
    }
  });
  return created;
}

test.use({ actionTimeout: 20_000 });
expect.configure({ timeout: 20_000 });

const modes = [
  { name: "de-identified", project: deidentified, label: "S26-91001", owner: "DH", patient: false },
  { name: "clinical", project: clinical, label: "S26-91002", owner: "LM", patient: true },
] as const;

for (const mode of modes) {
  test(`a case is created in a ${mode.name} project and a slide is uploaded into it`, async ({
    page,
  }) => {
    const created = await fakeStorage(page);
    const bodies: Record<string, unknown>[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/cases")) {
        bodies.push(request.postDataJSON() as Record<string, unknown>);
      }
    });

    await page.goto(`/projects/${mode.project}/cases/new?as=${mode.owner}`);
    const drawer = page.getByRole("dialog", { name: "New case" });
    await expect(drawer.getByTestId("case-patient").getByRole("textbox")).toHaveCount(
      mode.patient ? 2 : 0,
    );
    await drawer.getByLabel("Case ID").fill(mode.label);
    await drawer.getByLabel("Specimen").fill("Fake lymph node");
    if (mode.patient) {
      await drawer.getByLabel("Name").fill("Fake Patient Two");
      await drawer.getByLabel("Birth number").fill("FAKE-0002");
    }
    const response = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith("/api/cases") && candidate.request().method() === "POST",
    );
    await drawer.getByRole("button", { name: "Create case" }).click();
    const caseId = ((await (await response).json()) as { id: string }).id;
    await expect(drawer).toBeHidden();
    expect(bodies[0]?.patient !== undefined).toBe(mode.patient);

    await page.evaluate((viewer) => {
      const url = new URL(window.location.href);
      url.searchParams.set("as", viewer);
      window.history.pushState(null, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, mode.owner);
    const group = page.getByRole("row", { name: new RegExp(mode.label) });
    await expect(group).toBeVisible();
    await group.getByRole("button", { name: "Upload slides" }).click();
    await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/upload`));
    await page.getByTestId("file-input").setInputFiles({
      name: "fake_slide.svs",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("slide"),
    });
    await expect(page.getByTestId("upload-row")).toHaveAttribute("data-status", "done");
    expect(created).toEqual([{ filename: "fake_slide.svs", caseId }]);
  });
}
