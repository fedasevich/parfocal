import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const live = `/projects/${p07}/slides/${a1}/live?as=DH`;

async function unclipped(page: Page): Promise<string[]> {
  return page.getByTestId("result-set-toggle").evaluateAll((buttons) => {
    const stage = document.querySelector('[data-testid="slide-stage"]');
    if (stage === null) return ["no stage"];
    const frame = stage.getBoundingClientRect();
    const problems: string[] = [];
    for (const button of buttons) {
      const box = button.getBoundingClientRect();
      const name = button.textContent ?? "";
      if (button.scrollWidth > button.clientWidth + 1) problems.push(`${name} cuts its text`);
      const fill = getComputedStyle(button).backgroundColor;
      const slashed = /\/\s*([\d.]+)%?\s*\)$/.exec(fill)?.[1];
      const alpha =
        slashed !== undefined
          ? Number(slashed)
          : fill.startsWith("rgba(")
            ? Number(fill.split(",")[3]?.replace(")", ""))
            : 1;
      if (fill === "transparent" || alpha < 0.95) {
        problems.push(`${name} lets the slide show through its ${fill} fill`);
      }
      if (
        box.left < frame.left ||
        box.top < frame.top ||
        box.right > frame.right ||
        box.bottom > frame.bottom
      ) {
        problems.push(`${name} leaves the stage`);
      }
      const middleX = (box.left + box.right) / 2;
      const middleY = (box.top + box.bottom) / 2;
      const edges = [
        [box.left + 3, middleY],
        [box.right - 3, middleY],
        [middleX, box.top + 3],
        [middleX, box.bottom - 3],
      ] as const;
      for (const [x, y] of edges) {
        const hit = document.elementFromPoint(x, y);
        if (hit === null || !button.contains(hit)) {
          const by =
            hit === null
              ? "nothing"
              : (hit.closest("[data-testid]")?.getAttribute("data-testid") ?? hit.tagName);
          problems.push(`${name} is covered at ${Math.round(x)},${Math.round(y)} by ${by}`);
        }
      }
    }
    return problems;
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
]) {
  test(`the per-set hide buttons sit whole inside the stage at ${viewport.width} by ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(live);
    await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
      timeout: 20_000,
    });
    const toggles = page.getByTestId("result-set-toggle");
    await expect(toggles.first()).toBeVisible();
    expect(await toggles.count()).toBeGreaterThan(1);
    expect(await unclipped(page)).toEqual([]);
  });
}
