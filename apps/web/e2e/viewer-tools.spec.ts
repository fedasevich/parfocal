import { expect, type Page, test } from "./a11y.ts";
import { chromeBudget, chromeShare } from "./chrome-share.ts";
import { inPart, parts } from "./parts.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const toolLink =
  /^(Smart minimap|Measuring|Annotate workspace|Compare slides|Focus mode|Whole-slide peek)/;

async function toolLinks(page: Page) {
  await page.goto("/prototype");
  const links = page.getByRole("list", { name: "Screens" }).getByRole("link", { name: toolLink });
  await expect(links).toHaveCount(13, { timeout: 20_000 });
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
  plain.searchParams.set("scene", "objects");
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
  "Compare slides": "Show on the right",
  "Focus mode": "AI score 52%. Still open.",
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
      if (name === "Focus mode") {
        await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
          timeout: 30_000,
        });
      }
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
  await expect(page.getByText("7.70 mm").first()).toBeVisible();
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

test("picking the reading slide for the right side swaps the sides", async ({ page }) => {
  const links = await toolLinks(page);
  await page.goto(hrefOf(links, "Compare slides"));
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  const right = page.getByRole("listbox", { name: "Slide for the right side" });
  const before = await page.locator('[data-slot="compare-home"]').getAttribute("aria-label");
  await right.getByRole("option", { name: /swaps the sides/ }).click();
  await expect(right).toHaveCount(0);
  await expect(page).toHaveURL(/layout=compare/);
  await expect(page.locator('[data-pane="right"]')).toHaveAccessibleName(
    (before ?? "").replace(/^Left/, "Right"),
  );
});

test("focus mode answers from the keys and the key in the pill brings the interface back", async ({
  page,
}) => {
  const links = await toolLinks(page);
  await page.goto(hrefOf(links, "Focus mode"));
  await expect(page.getByTestId("focus-mode")).toBeVisible();
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  const card = page.locator('[data-slot="focus-card"]');
  await expect(card).toContainText("T5");
  const put = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().includes("/decisions/T5"),
  );
  await card.getByRole("button", { name: /agree/ }).first().click();
  await put;
  await expect(card.getByText(/Decided\. Press a key again to change it\./)).toBeVisible();
  await page.getByRole("button", { name: "Show the interface" }).click();
  await expect(page.getByTestId("focus-mode")).toHaveCount(0);
  await expect(page.getByTestId("stage-review-objects")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("focus")).toBeNull();
  expect(new URL(page.url()).searchParams.get("layout")).toBeNull();
});

test("in focus mode Shift+N on a decided object opens its note editor with the interface back", async ({
  page,
}) => {
  const links = await toolLinks(page);
  await page.goto(hrefOf(links, "Focus mode"));
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("focus-notices")).toBeAttached();
  const card = page.locator('[data-slot="focus-card"]');
  await expect(card).toContainText("T5");
  await page.keyboard.press("Shift+N");
  await expect(page.getByTestId("focus-mode")).toBeVisible();
  await card.getByRole("button", { name: /agree/ }).first().click();
  await expect(card.getByText(/Decided\. Press a key again to change it\./)).toBeVisible();
  await page.keyboard.press("Shift+N");
  await expect(page.getByTestId("focus-mode")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Note on your decision for T5" })).toBeFocused();
});

test("the focus key hides the top bar, rail and inspector and brings them back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const links = await toolLinks(page);
  const viewer = new URL(hrefOf(links, "Focus mode"), "http://localhost");
  viewer.searchParams.delete("layout");
  await page.goto(`${viewer.pathname}${viewer.search}`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
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
  await expect(page.locator('[data-slot="magnification-bar"]')).toBeVisible();
  expect(await chromeShare(page)).toBe(0);
  await expect(minimap(page)).toBeVisible();
  await page.keyboard.press("0");
  await expect(minimap(page)).toHaveCount(0);
  const stage = await page.getByTestId("slide-stage").boundingBox();
  if (stage === null) throw new Error("the stage has no box");
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  for (let step = 0; step < 5; step += 1) {
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(60);
  }
  await expect(minimap(page)).toBeVisible();
  await expect(page.getByTestId("focus-mode")).toBeVisible();

  await page.keyboard.press("Control+Backslash");
  await expect(page.getByTestId("focus-mode")).toHaveCount(0);
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

const outlineToggle = (page: Page) =>
  page.getByRole("switch", { name: "Tumor map outline on the right" });

async function compareWithOptions(page: Page, href: string) {
  await page.goto(href);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Compare options" }).click();
}

test("the tumor map outline draws on the right once it holds the task slide", async ({ page }) => {
  const links = await toolLinks(page);
  await compareWithOptions(page, hrefOf(links, "Compare slides"));
  const engine = page.locator('[data-pane="right"]').getByTestId("still-engine");
  const drawn = () => engine.getAttribute("data-overlays").then((value) => Number(value ?? 0));
  await page.getByRole("button", { name: "Swap sides" }).click();
  await expect(page.locator('[data-pane="right"]')).toHaveAccessibleName(/^Right: A1/);
  await expect(engine).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  expect(await drawn()).toBe(0);
  if (!(await outlineToggle(page).isVisible())) {
    await page.getByRole("button", { name: "Compare options" }).click();
  }
  await expect(outlineToggle(page)).toBeEnabled({ timeout: 20_000 });
  await outlineToggle(page).click();
  await expect.poll(drawn).toBeGreaterThan(0);
  await outlineToggle(page).click();
  await expect.poll(drawn).toBe(0);
});

const outlineSetOf = (slide: string, id: string) => ({
  id,
  project_id: "00000000-0000-4000-8003-000000000007",
  slide_id: slide,
  name: "Outside model",
  model_version: null,
  source: "import",
  source_file: "outside.geojson",
  produced_at: null,
  status: "ready",
  error_code: null,
  cell_count: 0,
  region_count: 2,
  zone_count: 0,
  created_by_user_id: null,
  created_at: "2026-11-15T09:00:00+01:00",
});

test("the tumor map outline draws a slide outside the task from its own result set", async ({
  page,
}) => {
  const links = await toolLinks(page);
  const compare = hrefOf(links, "Compare slides");
  await page.goto(compare);
  const engine = page.locator('[data-pane="right"]').getByTestId("still-engine");
  await expect(engine).toBeAttached({ timeout: 30_000 });
  const slide = (await engine.getAttribute("data-slide")) ?? "";
  const setId = "00000000-0000-4000-8009-0000000000d1";
  await page.addInitScript(
    ({ set, status }) => {
      (window as unknown as { __parfocalFake: unknown }).__parfocalFake = {
        statuses: { "outside-run": status },
        chosen: [],
        left: [],
        sets: [set],
      };
    },
    {
      set: outlineSetOf(slide, setId),
      status: { kind: "result", status: "ready", slide_id: slide, result_set_id: setId },
    },
  );
  await compareWithOptions(page, compare);
  const toggle = outlineToggle(page);
  await expect(toggle).toBeEnabled({ timeout: 30_000 });
  await expect(engine).toHaveAttribute("data-objects", "0");
  await toggle.click();
  await expect
    .poll(async () => Number(await engine.getAttribute("data-objects")))
    .toBeGreaterThan(0);
  await toggle.click();
  await expect(engine).toHaveAttribute("data-objects", "0");
});

test("the tumor map outline toggle of a slide with no tumor map is disabled with a reason", async ({
  page,
}) => {
  const links = await toolLinks(page);
  await compareWithOptions(page, hrefOf(links, "Compare slides"));
  const toggle = outlineToggle(page);
  await expect(toggle).toBeDisabled({ timeout: 30_000 });
  await expect(toggle).toHaveAttribute("title", "This slide has no tumor map");
});
