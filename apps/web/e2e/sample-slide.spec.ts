import { expect, test } from "@playwright/test";

const sampleProject = "00000000-0000-4000-8003-000000000001";
const tumor001 = "00000000-0000-4000-8005-000000000101";

test("a sample slide opens in the viewer from the shared original under its tile token", async ({
  page,
}) => {
  const reads: { path: string; bearer: string | undefined }[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/tiles/")) {
      reads.push({ path: pathname, bearer: request.headers()["authorization"] });
    }
  });
  await page.goto(`/projects/${sampleProject}/slides/${tumor001}/live`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  const paths = reads.map((read) => read.path);
  expect(paths).toContain(`/tiles/${tumor001}/levels.json`);
  expect(paths).toContain(`/tiles/${tumor001}/original.tif`);
  expect(reads.every((read) => read.bearer === "Bearer fake-capability-token")).toBe(true);
});
