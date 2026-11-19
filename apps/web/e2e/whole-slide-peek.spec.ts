import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1440, height: 900 } });

const cameraOf = async (page: Page) => {
  const raw = (await page.getByTestId("slide-host").getAttribute("data-camera")) ?? "0,0,0";
  const [x = 0, y = 0] = raw.split(",").map(Number);
  return { x, y };
};

test("Z shows the whole slide with its picture, AI areas, checks and the view", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(`/projects/${p07}/slides/${a1}/live?task=${rt14}&as=LM`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(stage).toHaveAttribute("data-coverage", "loaded");
  const decided = await page.evaluate(
    async ([task, slide]) => {
      const objects = (await (
        await fetch(`/api/review-tasks/${task}/slides/${slide}/objects`)
      ).json()) as { objects: { kind: string; object: string }[] };
      const decisions = (await (
        await fetch(`/api/review-tasks/${task}/slides/${slide}/decisions`)
      ).json()) as { object: string }[];
      const regions = new Set(
        objects.objects.filter((item) => item.kind === "region").map((item) => item.object),
      );
      return [
        ...new Set(decisions.map((item) => item.object).filter((object) => regions.has(object))),
      ];
    },
    [rt14, a1],
  );

  await page.keyboard.press("z");
  const peek = page.getByTestId("viewed-peek");
  await expect(peek).toBeVisible();
  const cover = await peek.boundingBox();
  expect(cover?.x).toBe(0);
  expect(cover?.width).toBe(1440);
  expect((cover?.y ?? 0) + (cover?.height ?? 0)).toBe(900);

  await expect(peek).not.toHaveAttribute("data-source", "loading");
  await expect(peek.locator("image")).not.toHaveAttribute("href", /^data:image\/svg/);
  const map = peek.getByRole("img", { name: "The whole slide. Click a place to go there" });
  const box = await map.boundingBox();
  expect(Math.abs((box?.width ?? 0) / (box?.height ?? 1) - 1024 / 768)).toBeLessThan(0.02);

  const areas = peek.locator("[data-slot=peek-area]");
  await expect(areas).toHaveCount(5);
  await expect(peek.locator("[data-slot=peek-area][data-checked]")).toHaveCount(decided.length);
  for (const [index, object] of ["T1", "T2", "T3", "T4", "T5"].entries()) {
    const area = areas.nth(index);
    if (decided.includes(object)) await expect(area).toHaveAttribute("data-checked", "true");
    else await expect(area.locator("text")).toHaveText(String(index + 1));
  }
  await expect(peek.locator("[data-slot=peek-here]")).toHaveCount(1);

  const percent = Number(await stage.getAttribute("data-coverage-percent"));
  await expect(peek).toContainText(
    `A1 · H&E · 5 tumor regions, ${decided.length} decided · ${percent}% of tissue seen`,
  );
  const tint = peek.locator("[data-slot=viewed-cells]");
  const tinted = Number(await tint.getAttribute("data-cells"));
  const basis = Number(await tint.getAttribute("data-basis-cells"));
  expect(Math.abs((tinted / basis) * 100 - percent)).toBeLessThanOrEqual(1);

  await map.click({
    position: {
      x: (675 / 1024) * (box?.width ?? 0),
      y: (265 / 768) * (box?.height ?? 0),
    },
  });
  await expect(peek).toBeHidden();
  await expect
    .poll(async () => {
      const { x, y } = await cameraOf(page);
      return x > 560 && x < 790 && y > 170 && y < 370;
    })
    .toBe(true);

  await page.getByTestId("progress-trigger").click();
  await expect(page.getByText(`${percent}% of the tissue seen at 10x or more`)).toBeVisible();
});
