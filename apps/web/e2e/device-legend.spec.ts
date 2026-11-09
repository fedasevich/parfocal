import { type LegendContext, legendRows } from "../src/devices/device-legend.ts";
import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

const devices = [
  ["mouse", "Mouse"],
  ["trackpad", "Trackpad"],
  ["spacemouse", "SpaceMouse"],
  ["gamepad", "Gamepad"],
  ["pen", "Tablet and pen"],
  ["keyboard", "Keyboard"],
] as const;

for (const [device, name] of devices) {
  test(`the legend shows the ${name} controls on the slide`, async ({ page }) => {
    await page.addInitScript((value) => {
      window.localStorage.setItem("parfocal.device-settings", JSON.stringify({ device: value }));
    }, device);
    await page.goto(`/projects/${p07}?tab=slides`);
    await page
      .getByTestId("slide-row")
      .filter({ hasText: "tumor_044" })
      .getByRole("button", { name: "Open" })
      .click();
    await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
      timeout: 15_000,
    });
    const legend = page.getByTestId("device-legend");
    await expect(legend).toHaveAttribute("data-device", device);
    await expect(legend).toContainText(name);
    const context = (await legend.getAttribute("data-context")) as LegendContext;
    for (const [action, control] of legendRows[device][context]) {
      await expect(legend).toContainText(action);
      await expect(legend).toContainText(control);
    }
  });
}

test("no legend shows until a device is chosen", async ({ page }) => {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("device-legend")).toHaveCount(0);
});
