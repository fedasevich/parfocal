import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  return stage;
}

type Pointer = "touch" | "pen" | "mouse";

async function stroke(page: Page, pointerType: Pointer, stopMidway: boolean) {
  const stage = page.getByTestId("slide-stage");
  const box = await stage.boundingBox();
  if (box === null) throw new Error("the stage has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const drawing = page.getByTestId("freehand-layer");
  const peak = { value: 0 };
  await stage.evaluate(
    (node, args) => {
      const fire = (type: string, dx: number, dy: number) =>
        node.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 7,
            pointerType: args.pointerType,
            isPrimary: true,
            button: type === "pointerdown" ? 0 : -1,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: args.x + dx,
            clientY: args.y + dy,
          }),
        );
      fire("pointerdown", 0, 0);
      for (let step = 1; step <= 8; step += 1) fire("pointermove", step * 6, step * 3);
      if (!args.stopMidway) fire("pointerup", 48, 24);
    },
    { pointerType, x, y, stopMidway },
  );
  const length = Number(await drawing.getAttribute("data-drawing"));
  peak.value = length;
  return peak.value;
}

test("a finger never draws in Annotate and the pen draws with the active tool", async ({
  page,
}) => {
  const stage = await openSlide(page);
  await page.keyboard.press("Shift+P");
  await expect(stage).toHaveAttribute("data-tool", "freehand");

  const finger = await stroke(page, "touch", true);
  expect(finger).toBe(0);
  await page.evaluate(() => {
    const node = document.querySelector('[data-testid="slide-stage"]');
    node?.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 7, pointerType: "touch" }),
    );
  });

  const pen = await stroke(page, "pen", true);
  expect(pen).toBeGreaterThan(1);
});

test("a finger drag pans the slide while a freehand tool is active", async ({ page }) => {
  const stage = await openSlide(page);
  await page.keyboard.press("Shift+P");
  await expect(stage).toHaveAttribute("data-tool", "freehand");
  const engine = page.getByTestId("still-engine");
  const before = await engine.getAttribute("data-camera");
  await stroke(page, "touch", false);
  await expect(page.getByTestId("freehand-layer")).toHaveAttribute("data-drawing", "0");
  const after = await engine.getAttribute("data-camera");
  expect(after).not.toBe(before);
});
