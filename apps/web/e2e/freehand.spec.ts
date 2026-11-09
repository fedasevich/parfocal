import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

test("Shift P draws a freehand stroke that is simplified and saved, and Escape leaves the tool", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("Shift+P");
  await expect(stage).toHaveAttribute("data-tool", "freehand");
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  const steps = 80;
  for (let i = 1; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    await page.mouse.move(box.x + 300 + 100 * Math.sin(angle), box.y + 300 - 100 * Math.cos(angle));
  }
  await page.mouse.up();
  const shape = page.getByTestId("polygon-shape");
  await expect(shape).toHaveCount(1);
  const points = Number(await shape.getAttribute("data-points"));
  expect(points).toBeGreaterThanOrEqual(8);
  expect(points).toBeLessThan(steps);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
});

async function openSlide(page: import("@playwright/test").Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await page.keyboard.press("Shift+P");
  await expect(stage).toHaveAttribute("data-tool", "freehand");
  return stage;
}

test("a cancelled pointer drops the stroke and later moves do not extend it", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 350, box.y + 350, { steps: 3 });
  await expect(page.getByTestId("freehand-layer")).not.toHaveAttribute("data-drawing", "0");
  await page.evaluate(() => {
    const host = document.querySelector('[data-testid="slide-host"]');
    host?.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }));
  });
  await expect(page.getByTestId("freehand-layer")).toHaveAttribute("data-drawing", "0");
  await page.mouse.move(box.x + 500, box.y + 500, { steps: 3 });
  await expect(page.getByTestId("freehand-layer")).toHaveAttribute("data-drawing", "0");
  await page.mouse.up();
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
});

test("coalesced samples land on the stroke where the pointer passed", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  const ring = [
    [300, 200],
    [400, 200],
    [400, 300],
    [300, 300],
  ];
  await page.evaluate(
    ({ ring, origin }) => {
      const host = document.querySelector('[data-testid="slide-host"]');
      if (!host) throw new Error("no host");
      const at = (
        x: number,
        y: number,
        type: string,
        init: PointerEventInit = {},
        extra: Record<string, unknown> = {},
      ) =>
        Object.assign(
          new PointerEvent(type, {
            pointerId: 7,
            pointerType: "mouse",
            button: 0,
            buttons: 1,
            clientX: origin.x + x,
            clientY: origin.y + y,
            bubbles: true,
            cancelable: true,
            isPrimary: true,
            ...init,
          }),
          extra,
        );
      const first = ring[0] ?? [0, 0];
      host.dispatchEvent(at(first[0] ?? 0, first[1] ?? 0, "pointerdown"));
      for (let index = 1; index < ring.length; index += 1) {
        const from = ring[index - 1] ?? [0, 0];
        const to = ring[index] ?? [0, 0];
        const samples = [1, 2, 3].map((step) =>
          at(
            (from[0] ?? 0) + (((to[0] ?? 0) - (from[0] ?? 0)) * step) / 3,
            (from[1] ?? 0) + (((to[1] ?? 0) - (from[1] ?? 0)) * step) / 3,
            "pointermove",
          ),
        );
        host.dispatchEvent(
          at(to[0] ?? 0, to[1] ?? 0, "pointermove", {}, { getCoalescedEvents: () => samples }),
        );
      }
      host.dispatchEvent(at(first[0] ?? 0, first[1] ?? 0, "pointerup", { buttons: 0 }));
    },
    { ring, origin: { x: box.x, y: box.y } },
  );
  const shape = page.getByTestId("polygon-shape");
  await expect(shape).toHaveCount(1);
  const bounds = (await shape.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  expect(Math.abs(bounds.x - (box.x + 300))).toBeLessThan(2);
  expect(Math.abs(bounds.y - (box.y + 200))).toBeLessThan(2);
  expect(Math.abs(bounds.width - 100)).toBeLessThan(3);
  expect(Math.abs(bounds.height - 100)).toBeLessThan(3);
});

test("a stroke keeps going while the pointer is outside the stage", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.mouse.move(box.x + 300, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y - 30, { steps: 4 });
  await page.mouse.move(box.x + 500, box.y + 100, { steps: 4 });
  await page.mouse.move(box.x + 400, box.y + 200, { steps: 4 });
  await page.mouse.up();
  const shape = page.getByTestId("polygon-shape");
  await expect(shape).toHaveCount(1);
  const bounds = (await shape.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  expect(bounds.y).toBeLessThan(box.y);
  expect(Math.abs(bounds.height - 230)).toBeLessThan(4);
});
