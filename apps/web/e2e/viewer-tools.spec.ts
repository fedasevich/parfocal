import { expect, type Page, test } from "./a11y.ts";
import { chromeBudget, chromeShare } from "./chrome-share.ts";
import { inPart, parts } from "./parts.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const toolLink =
  /^(Smart minimap|Measuring|Annotate workspace|Compare slides|Focus mode|Whole-slide peek)/;

async function toolLinks(page: Page) {
  await page.goto("/prototype");
  const links = page.getByRole("list", { name: "Screens" }).getByRole("link", { name: toolLink });
  await expect(links).toHaveCount(14, { timeout: 20_000 });
  return links.evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      name: anchor.textContent ?? "",
      href: anchor.getAttribute("href") ?? "",
    })),
  );
}

const hrefOf = (links: { name: string; href: string }[], name: string) => {
  const found = links.find((link) => link.name === name);
  if (found === undefined) throw new Error(`no link named ${name}`);
  return found.href;
};

async function plainViewer(page: Page) {
  const links = await toolLinks(page);
  const plain = new URL(hrefOf(links, "Smart minimap · Reading at 10x"), "http://localhost");
  plain.searchParams.delete("scene");
  await page.goto(`${plain.pathname}${plain.search}`);
  await expect(page.getByTitle("Progress on this slide and in the whole task")).toBeVisible({
    timeout: 20_000,
  });
}

const minimap = (page: Page) => page.locator('[data-slot="smart-minimap"]');

const shows: Record<string, string> = {
  "Smart minimap · Whole slide on screen": "Go to T5, the first open object",
  "Smart minimap · Reading at 10x": "21% seen",
  "Smart minimap · Measuring in its corner": "1.62 mm",
  "Smart minimap · Going to the next area": "Going to area 3",
  "Smart minimap · Checking cells at 40x": "4 of 12 checked",
  "Smart minimap · One-cell focus": "Cell 6 of 12",
  "Smart minimap · Pointer comes close": "21% seen",
  Measuring: "Drawn with the ruler across T1",
  "Annotate workspace · Auto region": "Accept as tumor",
  "Annotate workspace · Choosing a model": "Model for outlining nuclei",
  "Compare slides · Slides picked": "Slides on screen",
  "Compare slides · Picking the right side": "Show on the right",
  "Focus mode": "T5 · Tumor region",
  "Whole-slide peek": "26% of tissue seen",
};

for (const part of parts) {
  test(`every viewer tool scene opens from the prototype index, part ${part}`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (response.status() >= 400 && path !== "/favicon.ico") {
        errors.push(`${response.status()} ${path}`);
      }
    });
    const links = await toolLinks(page);
    expect(links.map((link) => link.name).sort()).toEqual(Object.keys(shows).sort());
    for (const { name, href } of inPart(links, part)) {
      await page.goto(href);
      await expect(page.getByText(shows[name] ?? "").first(), name).toBeVisible();
      await expect(page.getByText(/^Placeholder\. The screen is built by/), name).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

test("the minimap leaves the corner the ruler is in, and travel shows the route", async ({
  page,
}) => {
  const links = await toolLinks(page);
  await page.goto(hrefOf(links, "Smart minimap · Reading at 10x"));
  await expect(minimap(page)).toHaveAttribute("data-corner", "bottom-right");
  await page.goto(hrefOf(links, "Smart minimap · Measuring in its corner"));
  await expect(minimap(page)).not.toHaveAttribute("data-corner", "bottom-right");
  await page.goto(hrefOf(links, "Smart minimap · Reading at 10x"));
  await page.getByRole("button", { name: /Area 3/ }).click();
  await expect(page).toHaveURL(/scene=travel/);
  await expect(minimap(page)).toHaveAttribute("data-size", "travel");
  await page.keyboard.press("]");
  await expect(page).toHaveURL(/object=T3/);
});

test("the edge cues point off screen and fly back to the previous area", async ({ page }) => {
  const links = await toolLinks(page);
  await page.goto(hrefOf(links, "Smart minimap · Reading at 10x"));
  const back = page.getByRole("button", { name: /^T1 · \d+\.\d mm away$/ });
  await expect(back).toHaveAttribute("data-side", /left|bottom/);
  await expect(page.getByRole("button", { name: /^Area 3 · \d+\.\d mm away$/ })).toHaveAttribute(
    "data-side",
    /right|top/,
  );
  await back.click();
  await expect(page).toHaveURL(/object=T1/);
});

test("the minimap opens the whole-slide peek and Esc returns", async ({ page }) => {
  const links = await toolLinks(page);
  await page.goto(hrefOf(links, "Smart minimap · Reading at 10x"));
  await page.getByRole("button", { name: "Open the whole slide" }).click();
  await expect(page.getByRole("dialog", { name: "Whole slide" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Whole slide" })).toHaveCount(0);
  await page.keyboard.press("z");
  await expect(page.getByRole("dialog", { name: "Whole slide" })).toBeVisible();
  const handle = await page.getByRole("separator", { name: "Resize the side panel" }).boundingBox();
  expect(handle).not.toBeNull();
  const onTop = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.getAttribute("aria-label") ?? "",
    [(handle?.x ?? 0) + (handle?.width ?? 0) / 2, (handle?.y ?? 0) + 120] as const,
  );
  expect(onTop).not.toBe("Resize the side panel");
  await page.getByRole("button", { name: "Back to the view" }).click();
  await expect(page).not.toHaveURL(/peek=true/);
});

test("holding Z peeks at the whole slide until the key is released", async ({ page }) => {
  const links = await toolLinks(page);
  await page.goto(hrefOf(links, "Smart minimap · Reading at 10x"));
  const peek = page.getByRole("dialog", { name: "Whole slide" });
  await expect(page.getByRole("button", { name: "Open the whole slide" })).toBeVisible();
  await page.keyboard.down("z");
  await expect(peek).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.up("z");
  await expect(peek).toHaveCount(0);
});

test("a tap on Z latches the peek with a return hint until Z again", async ({ page }) => {
  await plainViewer(page);
  const peek = page.getByRole("dialog", { name: "Whole slide" });
  await page.keyboard.down("z");
  await expect(peek.getByText(/release/)).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.up("z");
  await expect(peek).toHaveCount(0);
  await page.keyboard.press("z");
  await expect(peek).toBeVisible();
  await expect(peek.getByText(/press/)).toBeVisible();
  await page.keyboard.press("z");
  await expect(peek).toHaveCount(0);
});

test("the progress ring opens the whole-slide peek", async ({ page }) => {
  await plainViewer(page);
  await page.getByTitle("Progress on this slide and in the whole task").click();
  await page.getByRole("button", { name: "Whole slide", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Review progress" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Whole slide" })).toBeVisible();
  await expect(page).toHaveURL(/peek=true/);
});

test("a click on the peek goes there and the view back key returns", async ({ page }) => {
  await plainViewer(page);
  await page.keyboard.press("z");
  const slide = page.getByRole("img", { name: "The whole slide. Click a place to go there" });
  await expect(slide).toBeVisible();
  const box = await slide.boundingBox();
  if (box === null) throw new Error("the whole slide has no box");
  await slide.click({ position: { x: box.width / 2, y: box.height / 4 } });
  await expect(page.getByRole("dialog", { name: "Whole slide" })).toHaveCount(0);
  await expect(page).not.toHaveURL(/peek=true/);
  const centreY = (url: URL) => Math.abs(Number(url.searchParams.get("y")) - 0.25) < 0.01;
  await expect(page).toHaveURL(centreY);
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page).not.toHaveURL(centreY);
});

test("the ruler adds M1, and Remove takes it away with Undo", async ({ page }) => {
  const links = await toolLinks(page);
  await page.goto(hrefOf(links, "Smart minimap · Reading at 10x"));
  await page.getByRole("button", { name: "Measure (L)" }).click();
  await expect(page).toHaveURL(/tool=ruler/);
  await expect(page.getByText("8.00 mm").first()).toBeVisible();
  await page.getByRole("button", { name: "Remove M1" }).click();
  await expect(page).not.toHaveURL(/tool=ruler/);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page).toHaveURL(/tool=ruler/);
});

test("the tier pill opens the model picker, and Accept adds the proposals", async ({ page }) => {
  const links = await toolLinks(page);
  await page.goto(hrefOf(links, "Annotate workspace · Auto region"));
  await page.getByRole("button", { name: /Best/ }).click();
  await expect(page).toHaveURL(/scene=models/);
  await page.getByRole("radio", { name: /Good/ }).click();
  await expect(page).toHaveURL(/scene=auto/);
  await expect(page.getByRole("button", { name: /Good/ })).toBeVisible();
  await page.getByRole("button", { name: /Accept as tumor/ }).click();
  await expect(page.getByText("46 nuclei added to Area 2 tumor nuclei")).toBeVisible();
  await expect(page.getByText("458")).toBeVisible();
  await page.getByRole("radio", { name: "Full viewer" }).click();
  await expect(page).not.toHaveURL(/annotate/);
});

test("picking a slide on one side swaps when it is on the other", async ({ page }) => {
  const links = await toolLinks(page);
  await page.goto(hrefOf(links, "Compare slides · Picking the right side"));
  const right = page.getByRole("listbox", { name: "Slide for the right side" });
  await right.getByRole("option", { name: /On the left now/ }).click();
  await expect(right).toHaveCount(0);
  await expect(page.getByRole("region", { name: /^Right: A1 · H&E/ })).toBeVisible();
  await page.getByRole("button", { name: "Swap sides" }).click();
  await expect(page.getByRole("region", { name: /^Left: A1 · H&E/ })).toBeVisible();
  await page.getByRole("button", { name: "Change the right slide" }).click();
  await expect(page.getByRole("listbox", { name: "Slide for the right side" })).toBeVisible();
});

test("focus mode answers from the keys and the key in the pill brings the interface back", async ({
  page,
}) => {
  const links = await toolLinks(page);
  await page.goto(hrefOf(links, "Focus mode"));
  await expect(page.getByTestId("focus-mode")).toBeVisible();
  await expect(page.getByRole("banner")).toHaveCount(0);
  await page.getByRole("button", { name: /agree/ }).first().click();
  await expect(page.getByText("Decided. Press a key again to change it.")).toBeVisible();
  await page.getByRole("button", { name: "Show the interface" }).click();
  await expect(page.getByTestId("full-viewer")).toBeVisible();
});

test("the focus key hides the top bar, rail and inspector and brings them back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const links = await toolLinks(page);
  const viewer = new URL(hrefOf(links, "Focus mode"), "http://localhost");
  viewer.searchParams.delete("focus");
  await page.goto(`${viewer.pathname}${viewer.search}`);
  await expect(page.getByTestId("full-viewer")).toBeVisible();
  await expect(page.locator("header")).toBeVisible();
  await expect(page.locator('[data-slot="tool-rail"]')).toBeVisible();
  await expect(page.locator('[data-slot="side-panel"]')).toBeVisible();
  const before = await chromeShare(page);
  expect(before).toBeGreaterThan(0);
  expect(before).toBeLessThan(chromeBudget);

  await page.keyboard.press("Control+Backslash");
  await expect(page.getByTestId("focus-mode")).toBeVisible();
  await expect(page.locator("header")).toHaveCount(0);
  await expect(page.locator('[data-slot="tool-rail"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="side-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="floating-pill"]')).toBeVisible();
  await expect(page.locator('[data-slot="focus-card"]')).toBeVisible();
  await expect(minimap(page)).toBeVisible();
  await expect(page.locator('[data-slot="magnification-bar"]')).toBeVisible();
  expect(await chromeShare(page)).toBe(0);

  await page.keyboard.press("Control+Backslash");
  await expect(page.getByTestId("full-viewer")).toBeVisible();
  await expect(page.locator("header")).toBeVisible();
  await expect(page.locator('[data-slot="side-panel"]')).toBeVisible();
});

test("focus mode opens from the More menu of the annotate workspace", async ({ page }) => {
  const links = await toolLinks(page);
  await page.goto(hrefOf(links, "Annotate workspace · Auto region"));
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: /Focus mode/ }).click();
  await expect(page.getByTestId("focus-mode")).toBeVisible();
  await expect(page.locator("header")).toHaveCount(0);
});

test("a layer set on one side draws only in that pane", async ({ page }) => {
  const links = await toolLinks(page);
  await page.goto(hrefOf(links, "Compare slides · Slides picked"));
  const left = page.getByRole("region", { name: /^Left:/ });
  const right = page.getByRole("region", { name: /^Right:/ });
  const outline = (pane: typeof left) => pane.locator("path[stroke='var(--c-tumor)']");
  await expect(outline(left)).toHaveCount(1);
  await expect(outline(right)).toHaveCount(0);
  await page.getByRole("button", { name: "Swap sides" }).click();
  await expect(outline(left)).toHaveCount(0);
  await expect(outline(right)).toHaveCount(1);
});
