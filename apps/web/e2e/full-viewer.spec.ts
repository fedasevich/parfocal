import { expect, type Page, test } from "@playwright/test";

const viewer = (page: Page) => page.getByTestId("full-viewer");
const panel = (page: Page) => page.getByRole("complementary", { name: "Side panel" });

async function viewerLinks(page: Page) {
  await page.goto("/prototype");
  const links = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: /^(Full viewer|Visualize)/ });
  await expect(links).toHaveCount(30);
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

const shows: Record<string, string> = {
  "Full viewer · Objects tab": "Go to T5, the first open object",
  "Full viewer · Objects tab, filtered to open": "Cells, 6 open",
  "Full viewer · Cells panel open": "Cell in your sample",
  "Full viewer · AI still running": "Still reading this slide, 2 regions so far",
  "Full viewer · Tiles loading": "Loading sharper tiles · 12 left",
  "Full viewer · Not loaded yet": "Loading the slide",
  "Full viewer · Issue · submit failed": "The review could not be submitted",
  "Full viewer · Issue · connection lost": "Connection lost.",
  "Full viewer · Issue · slide fails to load": "could not be read at 20x and 40x",
  "Full viewer · Issue · no results": "Nothing to decide here yet.",
  "Full viewer · Issue · the task was withdrawn": "RT-14 was withdrawn.",
  "Full viewer · Read-only after sign-off": "Signed off 15 Oct.",
  "Full viewer · Issue · slow source": "Slow source.",
  "Full viewer · Issue · remote source offline": "Scanner archive is not answering",
  "Full viewer, one object · An open region, T5": "The AI says T5 is tumor",
  "Full viewer, one object · A decided region with a note, T2": "Note on decision",
  "Full viewer, one object · Your added region, T6⁺": "It sits outside the scope",
  "Visualize · Objects on the slide": "Ways to show results",
  "Visualize · Heatmap": "Tumor probability",
  "Visualize · Cell density": "Cells per 0.1 mm²",
  "Visualize · AI vs reviewed": "AI and reviewer agree",
  "Visualize · Model vs model": "Matched by overlap",
  "Visualize · Reviewer vs reviewer": "Cohen's kappa 0.71",
  "Visualize · Swipe between two sets": "B · PathoSAM v1.2",
  "Visualize · Object table and stats": "18,246 in all",
  "Visualize · Display panel, the task default": "How objects draw",
  "Visualize · Display, a setting locked by the task": "confidence hidden this round",
  "Visualize · Display, a preset switched": "Reset to the task default",
  "Visualize · Save a preset": "The display settings you have now",
  "Full viewer · a clinical case": "No review task asks about A1",
};

test("every full viewer and Visualize scene opens from the prototype index", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400 && path !== "/favicon.ico") {
      errors.push(`${response.status()} ${path}`);
    }
  });
  const links = await viewerLinks(page);
  expect(links.map((link) => link.name).sort()).toEqual(Object.keys(shows).sort());
  for (const { name, href } of links) {
    await page.goto(href);
    await expect(viewer(page), name).toBeVisible();
    await expect(page.getByText(shows[name] ?? "").first(), name).toBeVisible();
    await expect(page.getByText(/^Placeholder\. The screen is built by/), name).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("a row click opens the object, an answer lands in the list and Whole slide goes back", async ({
  page,
}) => {
  const links = await viewerLinks(page);
  await page.goto(hrefOf(links, "Full viewer · Objects tab"));
  await panel(page)
    .getByRole("button", { name: /^T5 Tumor region/ })
    .click();
  await expect(page).toHaveURL(/object=T5/);
  const answers = page.getByRole("group", { name: "Your answer on T5" });
  await answers.getByRole("button", { name: /Agree/ }).click();
  await expect(page.getByText("T5: agree")).toBeVisible();
  await expect(panel(page).getByRole("button", { name: /^T5 Tumor region/ })).toContainText(
    "agree",
  );
  await page.getByRole("button", { name: "Whole slide" }).click();
  await expect(page).not.toHaveURL(/object=/);
  await expect(page.getByRole("button", { name: /Go to|All decided/ })).toBeVisible();
});

test("the filter chips narrow the list and Show the cells opens the cells panel", async ({
  page,
}) => {
  const links = await viewerLinks(page);
  await page.goto(hrefOf(links, "Full viewer · Objects tab"));
  await panel(page).getByRole("button", { name: "Open 7" }).click();
  await expect(panel(page).getByRole("button", { name: /^T1 Tumor region/ })).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: /^T5 Tumor region/ })).toBeVisible();
  await panel(page).getByRole("button", { name: "Show the cells" }).click();
  await expect(page.getByText("Cells in your sample").first()).toBeVisible();
  await expect(page.getByText("Cell in your sample")).toBeVisible();
});

test("View in the Display tab switches between the ways to show results", async ({ page }) => {
  const links = await viewerLinks(page);
  await page.goto(hrefOf(links, "Visualize · Objects on the slide"));
  const views = page.getByRole("radiogroup", { name: "Ways to show results" });
  await views.getByRole("radio", { name: "Heatmap" }).click();
  await expect(page).toHaveURL(/scene=heat/);
  await expect(page.getByText("Tumor probability")).toBeVisible();
  await page
    .getByRole("radiogroup", { name: "Ways to show results" })
    .getByRole("radio", { name: "Object table and stats" })
    .click();
  await expect(page).toHaveURL(/scene=table/);
  await expect(page.getByRole("region", { name: "Objects on A1" })).toBeVisible();
  await page.getByRole("button", { name: "3 comments on T2" }).click();
  await expect(page).toHaveURL(/tab=comments/);
});

test("Save as opens Save a preset, which saves under a new name", async ({ page }) => {
  const links = await viewerLinks(page);
  await page.goto(hrefOf(links, "Visualize · Display, a preset switched"));
  await page.getByRole("menuitem", { name: "Save as" }).click();
  const modal = page.getByRole("dialog", { name: "Save a preset" });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /^Save/ }).click();
  await expect(modal.getByText("Name the preset.")).toBeVisible();
  await modal.getByRole("textbox").fill("Fill by score");
  await modal.getByRole("button", { name: /^Save/ }).click();
  await expect(modal).toBeHidden();
  await expect(page.getByText("Preset Fill by score saved.")).toBeVisible();
});

test("Submit opens the Slide done card in the Opinion tab and Try again clears the error", async ({
  page,
}) => {
  const links = await viewerLinks(page);
  await page.goto(hrefOf(links, "Full viewer · Issue · submit failed"));
  await expect(panel(page).getByRole("tab", { name: "Opinion" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: /Try again/ }).click();
  await expect(page.getByText("The review could not be submitted")).toHaveCount(0);
  await page.goto(hrefOf(links, "Full viewer · Objects tab"));
  await panel(page).getByRole("tab", { name: "Opinion" }).click();
  await expect(page.getByText("T5 is still open")).toBeVisible();
});

test("Guided and Full viewer switch between the two ways to review", async ({ page }) => {
  const links = await viewerLinks(page);
  await page.goto(hrefOf(links, "Full viewer · Objects tab"));
  await page.getByRole("radio", { name: "Guided" }).click();
  await expect(page).toHaveURL(/\/guided/);
  await page.getByRole("radio", { name: "Full viewer" }).click();
  await expect(viewer(page)).toBeVisible();
});

test("a clinical case opens its report from Open report", async ({ page }) => {
  const links = await viewerLinks(page);
  await page.goto(hrefOf(links, "Full viewer · a clinical case"));
  await page.getByRole("button", { name: "Open report" }).click();
  await expect(page).toHaveURL(/\/report/);
});
