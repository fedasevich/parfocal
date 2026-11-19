import { expect, type Page, test } from "@playwright/test";
import { email, galleryProject, password, seededSlide, signIn } from "./session.ts";
import { gpuAnswer, gpuSmokeTimeoutMs, typedSlideLabel, typerWaitMs } from "./typing.ts";

const tileCells = 16;

test.describe.configure({ timeout: gpuSmokeTimeoutMs });

async function firstTile(page: Page, origin: string, slideId: string): Promise<Buffer> {
  const { response, retried } = await gpuAnswer(
    (call) =>
      page.request.post(`/api/slides/${slideId}/view-map/0/0`, {
        headers: { origin },
        params: call === null ? {} : { call },
        timeout: typerWaitMs,
      }),
    (ms) => page.waitForTimeout(ms),
  );
  const status = response.status();
  const again = retried ? " after one retry" : "";
  expect(
    status,
    `the view map answered ${status}${again}: ${(await response.text()).slice(0, 300)}`,
  ).toBe(200);
  return response.body();
}

test("a view map tile is scored on a seeded sample slide on the deployed app", async ({
  page,
  baseURL,
}, info) => {
  test.skip(
    email === "" || password === "",
    "PARFOCAL_SMOKE_EMAIL and PARFOCAL_SMOKE_PASSWORD are not set",
  );
  const origin = baseURL ?? "";
  await signIn(page, origin);
  const project = await galleryProject(page);
  const slideId = await seededSlide(page, project, typedSlideLabel);
  const cells = await firstTile(page, origin, slideId);
  expect(cells.length, "the first view map tile is a full 16 by 16 cell grid").toBe(
    tileCells * tileCells,
  );
  info.annotations.push({
    type: "view-map",
    description: `${typedSlideLabel} tile 0,0 has ${cells.filter((value) => value > 0).length} scored cells`,
  });
});
