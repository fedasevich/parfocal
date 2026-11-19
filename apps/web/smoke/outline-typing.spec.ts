import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { email, galleryProject, password, readJson, seededSlide, signIn } from "./session.ts";
import {
  type CellCollection,
  firstTypeableCell,
  gpuAnswer,
  gpuSmokeTimeoutMs,
  type TypedOutlines,
  typedCellsFile,
  typedSlideLabel,
  typerWaitMs,
  typingProblem,
} from "./typing.ts";
import { errorScreenShown, report, watch } from "./watch.ts";

type ResultSetRow = { id: string; name: string; cell_count: number };

test.describe.configure({ timeout: gpuSmokeTimeoutMs });

async function seededOutline(): Promise<number[]> {
  const cells = JSON.parse(await readFile(typedCellsFile, "utf8")) as CellCollection;
  const points = firstTypeableCell(cells);
  expect(points, `${typedSlideLabel} has a cell small enough to type`).not.toBeNull();
  return points as number[];
}

async function typeOne(
  page: Page,
  origin: string,
  slideId: string,
  points: number[],
): Promise<TypedOutlines> {
  const { response, retried } = await gpuAnswer(
    (call) =>
      page.request.post(`/api/slides/${slideId}/outline-types`, {
        data: { outlines: [{ points }] },
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
    `the typer answered ${status}${again}: ${(await response.text()).slice(0, 300)}`,
  ).toBe(200);
  return (await response.json()) as TypedOutlines;
}

test("the viewer typing tool types one seeded outline on the deployed app", async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(
    email === "" || password === "",
    "PARFOCAL_SMOKE_EMAIL and PARFOCAL_SMOKE_PASSWORD are not set",
  );
  const origin = baseURL ?? "";
  const seen = await watch(context, origin);
  seen.step("sign-in");
  await signIn(page, origin);
  seen.signedIn();

  const project = await galleryProject(page);
  const slideId = await seededSlide(page, project, typedSlideLabel);
  const sets = await readJson<ResultSetRow[]>(page, `/api/slides/${slideId}/result-sets`);
  expect(
    sets.some((set) => set.cell_count > 0),
    `the smoke account sees AI cells on ${typedSlideLabel}`,
  ).toBe(true);

  seen.step("viewer");
  await page.goto(`/projects/${project.id}/slides/${slideId}`);
  await expect(page.getByTestId("slide-stage")).toBeVisible();
  await expect(page.getByTestId("slide-host").locator("canvas").first()).toBeVisible();
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.screenshot({ path: info.outputPath("typing-viewer.png"), fullPage: false });
  expect(await errorScreenShown(page), "the viewer shows an error screen").toBeNull();

  seen.step("typing");
  const answer = await typeOne(page, origin, slideId, await seededOutline());
  expect(typingProblem(answer, slideId), JSON.stringify(answer).slice(0, 300)).toBeNull();
  info.annotations.push({
    type: "typed",
    description: `${answer.typer}@${answer.version} typed one outline as ${answer.outlines[0]?.type}`,
  });

  expect(seen.problems, report(seen.problems)).toEqual([]);
});
