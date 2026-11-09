import { expect, type Page, test } from "./a11y.ts";

const p03 = "00000000-0000-4000-8003-000000000003";
const block = 16;

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return box;
}

async function openFeedbackFromPalette(page: Page) {
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 500 });
  }).toPass();
  await palette.getByRole("combobox").fill("send feedback");
  await expect(palette.getByRole("option").first()).toContainText("Send feedback");
  await page.keyboard.press("Enter");
}

async function pixelsAt(page: Page, source: string, points: [number, number][]) {
  return page.evaluate(
    async ({ source, points }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.drawImage(image, 0, 0);
      return points.map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3)));
    },
    { source, points },
  );
}

async function blockReport(page: Page, source: string, areas: Box[]) {
  return page.evaluate(
    async ({ source, areas, block }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.drawImage(image, 0, 0);
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
      const uniform = (left: number, top: number) => {
        const first = (top * width + left) * 4;
        for (let y = top; y < Math.min(height, top + block); y += 1) {
          for (let x = left; x < Math.min(width, left + block); x += 1) {
            const at = (y * width + x) * 4;
            for (let channel = 0; channel < 3; channel += 1) {
              if (data[at + channel] !== data[first + channel]) return false;
            }
          }
        }
        return true;
      };
      const sharpInside = areas.map((area) => {
        let sharp = 0;
        let blocks = 0;
        const startX = Math.floor(Math.max(0, area.x) / block) * block;
        const startY = Math.floor(Math.max(0, area.y) / block) * block;
        for (let top = startY; top < Math.min(height, area.y + area.height); top += block) {
          for (let left = startX; left < Math.min(width, area.x + area.width); left += block) {
            blocks += 1;
            if (!uniform(left, top)) sharp += 1;
          }
        }
        return { blocks, sharp };
      });
      let sharpAnywhere = 0;
      for (let top = 0; top < height; top += block) {
        for (let left = 0; left < width; left += block) {
          if (!uniform(left, top)) sharpAnywhere += 1;
        }
      }
      return { width, height, sharpInside, sharpAnywhere };
    },
    { source, areas, block },
  );
}

test("the feedback screenshot is blurred over the slide and the patient banner before it is sent", async ({
  page,
}) => {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/feedback" && request.method() === "POST") {
      sent.push(request.postData() ?? "");
    }
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/projects/${p03}?tab=slides`);
  await page.getByTestId("slide-row").first().click();
  const banner = page.getByTestId("patient-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
  const areas = [
    await boxOf(page, "[data-testid='patient-banner']"),
    await boxOf(page, "[data-testid='case-header']"),
    await boxOf(page, "canvas"),
  ];

  await openFeedbackFromPalette(page);
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  const preview = dialog.getByTestId("feedback-screenshot");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  const source = (await preview.getAttribute("src")) ?? "";
  expect(source.startsWith("data:image/png;base64,")).toBe(true);

  const report = await blockReport(page, source, areas);
  expect([report.width, report.height]).toEqual([1280, 800]);
  for (const inside of report.sharpInside) {
    expect(inside.blocks).toBeGreaterThan(0);
    expect(inside.sharp).toBe(0);
  }
  expect(report.sharpAnywhere).toBeGreaterThan(20);

  await dialog.getByRole("textbox").fill("The overlay toggle is hard to find");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("dialog", { name: "Thanks, the team has it" })).toBeVisible();
  expect(sent).toHaveLength(1);
  const body = JSON.parse(sent[0] ?? "{}") as Record<string, unknown>;
  expect(body["screenshot_png"]).toBe(source.slice("data:image/png;base64,".length));
  expect(body["route"]).toBe("/projects/$projectId/slides/$slideId_/live");
  expect(body).not.toHaveProperty("path");
});

test("the account menu opens the feedback dialog", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Send feedback" }).click();
  await expect(page.getByRole("dialog", { name: "Send feedback" })).toBeVisible({
    timeout: 15_000,
  });
});

test("a scrolled list is captured at its scroll position so the blur lands on the right rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.evaluate(() => {
    const box = document.createElement("div");
    box.id = "scrolled-fixture";
    box.style.cssText =
      "position:fixed;left:40px;top:120px;width:320px;height:300px;overflow:auto;z-index:2147483646";
    const band = (height: number, colour: string, phi = false) => {
      const part = document.createElement("div");
      part.style.cssText = `height:${height}px;background:${colour}`;
      if (phi) {
        part.setAttribute("data-phi", "");
        part.textContent = "Fake Patient 9 FAKE-0009";
      }
      return part;
    };
    box.append(
      band(500, "rgb(255, 0, 0)"),
      band(100, "rgb(0, 255, 0)"),
      band(100, "rgb(255, 255, 255)", true),
      band(500, "rgb(0, 0, 255)"),
    );
    document.body.append(box);
    box.scrollTop = 500;
  });
  const phi = await boxOf(page, "#scrolled-fixture [data-phi]");
  expect(Math.round(phi.y)).toBe(220);

  await openFeedbackFromPalette(page);
  const preview = page
    .getByRole("dialog", { name: "Send feedback" })
    .getByTestId("feedback-screenshot");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  const source = (await preview.getAttribute("src")) ?? "";
  const [green, blue] = await pixelsAt(page, source, [
    [200, 140],
    [200, 380],
  ]);
  expect(green).toEqual([0, 255, 0]);
  expect(blue).toEqual([0, 0, 255]);
  const report = await blockReport(page, source, [phi]);
  expect(report.sharpInside[0]?.sharp).toBe(0);
});
