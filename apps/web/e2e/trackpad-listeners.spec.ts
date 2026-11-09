import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSlide(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("parfocal.device-settings", JSON.stringify({ device: "trackpad" }));
  });
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  return page.getByTestId("slide-host");
}

const zoomOf = async (page: Page) => {
  const camera = await page.getByTestId("slide-host").getAttribute("data-camera");
  return Number(camera?.split(",")[2]);
};

test("a Safari pinch on the slide zooms the camera and is not left to the page", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const host = await openSlide(page);
  const before = await zoomOf(page);
  const cancelled = await host.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const send = (type: string, scale: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, {
        scale,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const results = [send("gesturestart", 1)];
    for (const scale of [1.1, 1.25, 1.4]) results.push(send("gesturechange", scale));
    results.push(send("gestureend", 1.4));
    return results;
  });
  expect(cancelled.every(Boolean)).toBe(true);
  await expect(host).toHaveAttribute("data-trackpad-intent", "zoom");
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(before);
});

test("a two-finger click on the slide is read as a negative point and its menu is cancelled", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const host = await openSlide(page);
  const menuCancelled = await host.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const at = { clientX: box.left + 40, clientY: box.top + 40, bubbles: true, cancelable: true };
    element.dispatchEvent(
      new PointerEvent("pointerdown", { ...at, button: 2, buttons: 2, pointerType: "mouse" }),
    );
    const menu = new MouseEvent("contextmenu", { ...at, button: 2 });
    element.dispatchEvent(menu);
    return menu.defaultPrevented;
  });
  expect(menuCancelled).toBe(true);
  await expect(host).toHaveAttribute("data-trackpad-intent", "negativePoint");
});

test("a Ctrl click on the slide is the same two-finger click", async ({ page }) => {
  test.setTimeout(60_000);
  const host = await openSlide(page);
  await host.evaluate((element) => {
    const box = element.getBoundingClientRect();
    element.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: box.left + 40,
        clientY: box.top + 40,
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        ctrlKey: true,
        pointerType: "mouse",
      }),
    );
  });
  await expect(host).toHaveAttribute("data-trackpad-intent", "negativePoint");
});
