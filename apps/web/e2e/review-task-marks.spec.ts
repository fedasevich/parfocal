import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

test.use({ viewport: { width: 1280, height: 900 } });

type Mark = { id: string; kind: string; task_id: string | null; text?: string | null };

async function openAnnotate(page: Page, persona = "") {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=annotate${persona}`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(stage).toHaveAttribute("data-layer", "review");
  return stage;
}

const readLayer = (page: Page) =>
  page.evaluate(
    async ([task, slide]) => {
      const layer = await fetch(`/api/review-tasks/${task}/slides/${slide}/layer`);
      const wide = await fetch(`/api/slides/${slide}/annotations`);
      return {
        marks: ((await layer.json()) as { marks: Mark[] }).marks,
        wide: ((await wide.json()) as Mark[]).map((item) => item.id),
      };
    },
    [rt14, a1] as const,
  );

const rulerLabels = (page: Page) => page.getByTestId("ruler-layer").locator("text");

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

test("a note, an arrow and a ruler drawn in a review task stay in the author's layer only", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const stage = await openAnnotate(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  const at = (x: number, y: number) => ({ x: box.x + x, y: box.y + y });
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes(`/api/slides/${a1}/annotations`)) {
      posts.push(request.url());
    }
  });

  await page.keyboard.press("t");
  await expect(stage).toHaveAttribute("data-tool", "text");
  await page.mouse.click(box.x + 300, box.y + 200);
  await page.keyboard.type("check margin");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("text-shape")).toHaveCount(1);
  await page.keyboard.press("Escape");

  await page.keyboard.press("Shift+L");
  await expect(stage).toHaveAttribute("data-tool", "arrow");
  await drag(page, at(200, 300), at(340, 360));
  await expect(page.getByTestId("arrow-shape")).toHaveCount(1);
  await page.keyboard.press("Escape");

  await page.keyboard.press("l");
  await expect(stage).toHaveAttribute("data-tool", "ruler");
  await drag(page, at(200, 450), at(420, 452));
  await page.keyboard.press("Escape");

  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await expect
    .poll(async () => (await readLayer(page)).marks.map((mark) => mark.kind).sort())
    .toEqual(["arrow", "measurement", "text"]);
  const saved = await readLayer(page);
  expect(posts).toEqual([]);
  expect(saved.marks.every((mark) => mark.task_id === rt14)).toBe(true);
  expect(saved.marks.find((mark) => mark.kind === "text")?.text).toBe("check margin");
  for (const mark of saved.marks) expect(saved.wide).not.toContain(mark.id);

  await page.reload();
  await expect(stage).toHaveAttribute("data-annotations", "loaded", { timeout: 30_000 });
  await expect(page.getByTestId("text-shape")).toHaveCount(1);
  await expect(page.getByTestId("arrow-shape")).toHaveCount(1);
  await expect(rulerLabels(page)).toHaveCount(1);

  await openAnnotate(page, "&as=SM");
  await expect(page.getByTestId("text-shape")).toHaveCount(0);
  await expect(page.getByTestId("arrow-shape")).toHaveCount(0);
  await expect(rulerLabels(page)).toHaveCount(0);
  expect((await readLayer(page)).marks).toEqual([]);
});

test("the slide export from a review task's Annotate mode holds the author's own marks", async ({
  page,
}) => {
  const stage = await openAnnotate(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("t");
  await page.mouse.click(box.x + 300, box.y + 200);
  await page.keyboard.type("export me");
  await page.keyboard.press("Enter");
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await expect.poll(async () => (await readLayer(page)).marks.length).toBe(1);
  const texts = await page.evaluate(
    async ([task, slide]) => {
      const response = await fetch(`/api/slides/${slide}/export?format=geojson&task_id=${task}`);
      const body = (await response.json()) as {
        features: { properties: { text?: string | null } }[];
      };
      return body.features.map((feature) => feature.properties.text);
    },
    [rt14, a1] as const,
  );
  expect(texts).toContain("export me");
  await expect(page.getByTestId("export-menu")).toBeVisible();
});
