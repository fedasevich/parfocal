import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const lenka = "00000000-0000-4000-8001-000000000001";

test.use({ viewport: { width: 1280, height: 900 } });

type Added = { id: string; code: string; task_id: string | null; created_by_user_id: string };

const corners = [
  [0, 0],
  [120, 10],
  [100, 100],
  [10, 90],
] as const;

async function openAnnotate(page: Page, persona = "") {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=annotate${persona}`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  return stage;
}

const readBoth = (page: Page) =>
  page.evaluate(
    async ([task, slide]) => {
      const layer = await fetch(`/api/review-tasks/${task}/slides/${slide}/layer`);
      const wide = await fetch(`/api/slides/${slide}/annotations`);
      return {
        added: ((await layer.json()) as { added: Added[] }).added,
        wide: ((await wide.json()) as { id: string }[]).map((item) => item.id),
      };
    },
    [rt14, a1] as const,
  );

test("a shape a reviewer draws in Annotate mode is the task's added object, hidden from the other reviewer", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const stage = await openAnnotate(page);
  await expect(stage).toHaveAttribute("data-layer", "review");
  const shapes = page.getByTestId("polygon-shape");
  const before = await shapes.count();

  const slideWidePosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes(`/api/slides/${a1}/annotations`)) {
      slideWidePosts.push(request.url());
    }
  });
  const added = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/added"),
  );
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const origin = { x: box.x + box.width / 2 - 60, y: box.y + box.height / 2 - 50 };
  if ((await stage.getAttribute("data-tool")) !== "polygon") await page.keyboard.press("p");
  for (const [x, y] of corners) await page.mouse.click(origin.x + x, origin.y + y);
  await page.mouse.click(origin.x + 2, origin.y + 1);
  await added;
  await expect(shapes).toHaveCount(before + 1);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  expect(slideWidePosts).toEqual([]);

  const saved = await readBoth(page);
  expect(saved.added).toHaveLength(1);
  const [drawn] = saved.added;
  expect(drawn?.task_id).toBe(rt14);
  expect(drawn?.created_by_user_id).toBe(lenka);
  expect(drawn?.code.endsWith("⁺")).toBe(true);
  expect(saved.wide).not.toContain(drawn?.id);

  await page.reload();
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(shapes).toHaveCount(before + 1);

  await openAnnotate(page, "&as=SM");
  await expect(shapes).toHaveCount(before);
  expect((await readBoth(page)).added).toEqual([]);
});
