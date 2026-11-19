import { expect, type Locator, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const p03 = "00000000-0000-4000-8003-000000000003";
const sentinelCase = "00000000-0000-4000-8004-000000000006";

const sizes = [
  { width: 1280, height: 800 },
  { width: 1024, height: 700 },
] as const;

const longLabel = `Block_A1_${"really_long_slide_label_without_spaces_".repeat(3)}end`;

test.setTimeout(120_000);

async function documentDoesNotScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      vertical: root.scrollHeight - root.clientHeight,
      horizontal: root.scrollWidth - root.clientWidth,
      body: document.body.scrollHeight - document.body.clientHeight,
    };
  });
  expect(overflow.vertical).toBeLessThanOrEqual(0);
  expect(overflow.horizontal).toBeLessThanOrEqual(0);
  expect(overflow.body).toBeLessThanOrEqual(0);
}

async function insideWindow(page: Page, target: Locator) {
  const view = page.viewportSize();
  const box = await target.boundingBox();
  if (!view || !box) throw new Error("nothing to measure");
  expect(box.x).toBeGreaterThanOrEqual(-0.5);
  expect(box.y).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height + 0.5);
}

async function fits(page: Page, panel: Locator, actions: Locator[]) {
  await expect(panel).toBeVisible();
  await insideWindow(page, panel);
  for (const action of actions) {
    await expect(action).toBeInViewport({ ratio: 1 });
    await insideWindow(page, action);
  }
  await documentDoesNotScroll(page);
}

async function tableFitsItsWidth(page: Page) {
  const scroller = page.getByTestId("slides-table");
  const sizes = await scroller.evaluate((element) => ({
    scroll: element.scrollWidth,
    client: element.clientWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
  const rows = page.getByTestId("slide-row");
  for (let index = 0; index < (await rows.count()); index += 1) {
    const open = rows.nth(index).getByRole("button", { name: "Open", exact: true });
    const box = await open.boundingBox();
    const frame = await scroller.boundingBox();
    if (!box || !frame) continue;
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
  }
  await documentDoesNotScroll(page);
}

const group = (page: Page, key: string) =>
  page.locator(`[data-testid="case-group"][data-group="${key}"]`);

async function backToSlidesAsOwner(page: Page) {
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("as", "DH");
    url.searchParams.set("tab", "slides");
    window.history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

async function expand(page: Page, key: string) {
  const toggle = group(page, key).getByRole("button").first();
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}

const slideRow = (page: Page, text: string) =>
  page.getByTestId("slide-row").filter({ hasText: text });

for (const size of sizes) {
  test.describe(`${size.width} by ${size.height}`, () => {
    test.use({ viewport: size });

    test("a case is created, gets slides, moves one and takes an upload, all inside the window", async ({
      page,
    }) => {
      await page.goto(`/projects/${p07}?tab=slides&as=DH`);
      const newCase = page.getByRole("button", { name: "New case" });
      await expect(newCase).toBeVisible();
      await expect(newCase).toHaveAttribute("data-variant", "primary");
      await insideWindow(page, newCase);
      await newCase.click();

      const form = page.getByRole("dialog", { name: "New case" });
      await fits(page, form, [
        form.getByRole("button", { name: "Create case" }),
        form.getByRole("button", { name: "Cancel" }),
      ]);
      await form.getByLabel("Case ID").fill("S26-92001");
      await form.getByRole("button", { name: "Create case" }).click();
      await expect(form).toBeHidden();
      await documentDoesNotScroll(page);
      await backToSlidesAsOwner(page);

      await slideRow(page, "tumor_031").getByRole("button", { name: "File into a case" }).click();
      const file = page.getByRole("dialog", { name: "File into a case" });
      await fits(page, file, [file.getByRole("button", { name: /File slide/ })]);
      await file.getByRole("button", { name: /File slide/ }).click();
      await fits(page, file, [file.getByRole("button", { name: /File slide/ })]);
      await file.getByRole("combobox", { name: "Case" }).selectOption({ label: "S26-92001" });
      await file.getByLabel("Reason").fill("Belongs to the new case");
      await file.getByRole("button", { name: /File slide/ }).click();
      await expect(file).toBeHidden();
      await expand(page, "S26-92001");
      await expect(slideRow(page, "tumor_031")).toBeVisible();

      await group(page, "S26-92001").getByRole("button", { name: "Edit slides" }).click();
      const editor = page.getByRole("dialog", { name: "Edit slides" });
      await fits(page, editor, [editor.getByRole("button", { name: /Save slides/ })]);
      await editor.getByRole("button", { name: "Close" }).first().click();
      await expect(editor).toBeHidden();

      await slideRow(page, "tumor_031")
        .getByRole("button", { name: "Move to another case" })
        .click();
      const move = page.getByRole("dialog", { name: "Move to another case" });
      await fits(page, move, [move.getByRole("button", { name: /Move slide/ })]);
      await move
        .getByRole("combobox", { name: "Case" })
        .selectOption({ label: "Loose slides, no case" });
      await move.getByLabel("Reason").fill("Filed into the wrong case");
      await move.getByRole("button", { name: /Move slide/ }).click();
      await expect(move).toBeHidden();
      await expect(page.getByText("is now a loose slide")).toBeVisible();

      await group(page, "S26-92001").getByRole("button", { name: "Upload slides" }).click();
      const drawer = page.getByTestId("upload-drawer");
      await fits(page, drawer, [drawer.getByRole("button", { name: "Close" })]);
      await page.getByTestId("file-input").setInputFiles(
        ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].map((name) => ({
          name: `fake_${name}.svs`,
          mimeType: "application/octet-stream",
          buffer: Buffer.from("slide"),
        })),
      );
      await expect(page.getByTestId("upload-row").first()).toBeVisible();
      await fits(page, drawer, [drawer.getByRole("button", { name: "Close" })]);
    });

    test("the clinical report and the co-sign screen fit the window", async ({ page }) => {
      await page.goto(`/projects/${p03}/cases/${sentinelCase}/report?as=TB`);
      const flow = page.getByTestId("clinical-report");
      await expect(flow.getByRole("heading", { name: "Clinical report" })).toBeVisible();
      await fits(page, flow, [flow.getByRole("button", { name: "Next" })]);
      for (let step = 0; step < 3; step += 1) {
        await flow.getByRole("button", { name: "Next" }).click();
        await documentDoesNotScroll(page);
      }
      await insideWindow(page, flow);

      await page.goto(`/projects/${p03}/cases/${sentinelCase}/report?scene=sign&as=LM`);
      await flow
        .getByRole("button", { name: /Sign out/ })
        .last()
        .click();
      const sign = page.getByRole("dialog", { name: /Sign out/ });
      await fits(page, sign, []);
      await page.keyboard.press("Escape");

      await page.goto(`/projects/${p03}/cases/${sentinelCase}/co-sign?as=LM`);
      const review = page.getByTestId("co-sign");
      await expect(review).toBeVisible();
      await documentDoesNotScroll(page);
      await insideWindow(page, review);
    });

    test("the Slides tab fits its width with long slide and result set names", async ({ page }) => {
      await page.goto(`/projects/${p07}?tab=slides&as=DH`);
      await expect(page.getByTestId("slide-row").first()).toBeVisible();
      await tableFitsItsWidth(page);
      const chip = page.getByTestId("result-set-chip").first();
      await expect(chip).toHaveCSS("white-space", "normal");

      await expect(page.getByTestId("slide-title").first()).toHaveCSS("overflow-wrap", "anywhere");
      await page
        .getByTestId("result-set-chip")
        .first()
        .evaluate((element, name) => {
          element.lastChild?.replaceWith(name);
        }, longLabel);
      await page
        .getByTestId("slide-title")
        .first()
        .evaluate((element, name) => {
          element.textContent = name;
        }, longLabel);
      const box = await page.getByTestId("result-set-chip").first().boundingBox();
      expect(box?.height ?? 0).toBeGreaterThan(30);
      await tableFitsItsWidth(page);
    });
  });
}

test.describe("dragging slides", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a slide is dragged between two cases, back to Loose slides, and the move is undone", async ({
    page,
  }) => {
    await page.goto(`/projects/${p07}?tab=slides&as=DH`);
    await page.getByRole("button", { name: "New case" }).click();
    const form = page.getByRole("dialog", { name: "New case" });
    await form.getByLabel("Case ID").fill("S26-93001");
    await form.getByRole("button", { name: "Create case" }).click();
    await expect(form).toBeHidden();
    await backToSlidesAsOwner(page);

    const target = group(page, "S26-93001");
    await expect(target).toBeVisible();
    const row = slideRow(page, "tumor_031");
    await row.dragTo(target);
    await expect(page.getByText("is now in case S26-93001")).toBeVisible();
    await expand(page, "S26-93001");
    await expect(row).toBeVisible();

    const keys = await page
      .getByTestId("case-group")
      .evaluateAll((rows) => rows.map((item) => item.getAttribute("data-group")));
    const other = keys[keys.indexOf("S26-93001") - 1];
    if (!other) throw new Error("no second case");
    await row.dragTo(group(page, other));
    await expect(page.getByText(`is now in case ${other}`)).toBeVisible();
    await expand(page, other);
    await expect(row).toBeVisible();

    await row.dragTo(group(page, "loose"));
    await expect(page.getByText("is now a loose slide")).toBeVisible();
    await expect(row).toBeVisible();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText(`is now in case ${other}`)).toBeVisible();
    await expand(page, other);
    await expect(row).toBeVisible();
  });
});
