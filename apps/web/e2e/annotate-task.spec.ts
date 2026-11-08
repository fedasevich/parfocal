import { expect, type Page, test } from "@playwright/test";
import { inPart, parts } from "./parts.ts";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(() => {
  test.setTimeout(60_000);
});

const linkName = /^(Annotate task|New annotate task) ·/;

async function taskLinks(page: Page) {
  await page.goto("/prototype");
  const links = page.getByRole("list", { name: "Screens" }).getByRole("link", { name: linkName });
  await expect(links).toHaveCount(15, { timeout: 20_000 });
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
  "Annotate task · Origin marks": "Edited by",
  "Annotate task · AI result hidden": "AI result hidden",
  "Annotate task · Checking AI objects": "21 of 46 checked",
  "Annotate task · Slide checked": "You checked this slide",
  "Annotate task · Nothing to mark": "This slide has no objects.",
  "Annotate task · Owner sign-off": "Sign off this slide",
  "Annotate task · Whole-slide run": "Running on the whole slide",
  "Annotate task · Run cancelled": "Run cancelled, finished tiles kept",
  "Annotate task · Colleagues' changes": "3 changes by Anna Kopecká and Simona Marková",
  "New annotate task · Kind and presets": "Check a whole-slide run",
  "New annotate task · What to check · whole-slide run": "least sure first",
  "New annotate task · What to check · a sample": "Check a random sample",
  "New annotate task · What to check · by hand": "has no result set",
  "New annotate task · How it runs · blind first": "Blind first",
  "New annotate task · Send": "The cells the AI was least sure of",
};

for (const part of parts) {
  test(`every annotate task screen opens from the prototype index, part ${part}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (response.status() >= 400 && path !== "/favicon.ico") {
        errors.push(`${response.status()} ${path}`);
      }
    });
    const links = await taskLinks(page);
    expect(links.map((link) => link.name).sort()).toEqual(Object.keys(shows).sort());
    for (const { name, href } of inPart(links, part)) {
      await page.goto(href);
      await expect(page.getByText(shows[name] ?? "").first(), name).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(/^Placeholder\. The screen is built by/), name).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

const progressLine = (page: Page) => page.getByTestId("check-progress-line");

test("a click on an object opens its origin, author and history", async ({ page }) => {
  const links = await taskLinks(page);
  await page.goto(hrefOf(links, "Annotate task · Checking AI objects"));
  await expect(page.getByRole("button", { name: /^Confirm O25/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /^O15/ }).click();
  const card = page.getByRole("region", { name: "O15 origin and history" });
  await expect(card).toContainText("Anna Kopecká");
  await expect(card.getByRole("list", { name: "History" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.locator('[data-object="O15"]')).toHaveAttribute("data-origin", "ai-edited");
  await page.locator('[data-object="H1"] path').first().click({ force: true });
  const hand = page.getByRole("region", { name: "H1 origin and history" });
  await expect(hand).toContainText("Drawn by");
  await expect(hand).toContainText("Anna Kopecká");
});

test("D confirms the selected AI object, marks it and the progress line follows", async ({
  page,
}) => {
  const links = await taskLinks(page);
  await page.goto(hrefOf(links, "Annotate task · Checking AI objects"));
  const object = page.locator('[data-object="O25"]');
  await expect(progressLine(page)).toHaveText("21 of 46 checked", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^Confirm O25/ })).toContainText("D");
  await page.keyboard.press("c");
  await expect(progressLine(page)).toHaveText("21 of 46 checked");
  await expect(object).toHaveAttribute("data-origin", "ai");
  await expect(object.locator("path[stroke-dasharray]")).toHaveCount(1);
  await page.keyboard.press("d");
  await expect(progressLine(page)).toHaveText("22 of 46 checked");
  await expect(object).toHaveAttribute("data-origin", "ai-confirmed");
  await expect(object.locator("path[stroke-dasharray]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Confirm O25/ })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Who made it" }).click();
  await expect(page.getByRole("checkbox", { name: "Who made it" })).toBeChecked();
  await expect(object.locator('[data-badge="ai-confirmed"]')).toHaveCount(1);
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(progressLine(page)).toHaveText("21 of 46 checked");
  await expect(object).toHaveAttribute("data-origin", "ai");
  await expect(object.locator("[data-badge]")).toHaveCount(0);
});

test("marking the slide checked waits for every AI object, then shows the checked card", async ({
  page,
}) => {
  const links = await taskLinks(page);
  await page.goto(hrefOf(links, "Annotate task · Checking AI objects"));
  const mark = page.getByRole("button", { name: /Mark slide checked/ });
  await expect(mark).toBeDisabled({ timeout: 20_000 });
  await page.goto(hrefOf(links, "Annotate task · Slide checked"));
  await expect(page.getByRole("region", { name: "Slide checked" })).toContainText(
    "46 AI objects checked",
  );
  await page.getByRole("button", { name: "Reopen for changes" }).click();
  await expect(page.getByRole("region", { name: "Slide checked" })).toHaveCount(0);
  await page.getByRole("button", { name: /Mark slide checked/ }).click();
  await expect(page.getByRole("region", { name: "Slide checked" })).toBeVisible();
});

test("an empty slide is checked with nothing to mark", async ({ page }) => {
  const links = await taskLinks(page);
  await page.goto(hrefOf(links, "Annotate task · Nothing to mark"));
  const card = page.getByRole("region", { name: "Slide checked" });
  await expect(card).toContainText("Nothing to mark", { timeout: 20_000 });
  await page.getByRole("button", { name: "Reopen for changes" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Nothing to mark" }).click();
  await expect(card).toBeVisible();
});

test("the AI result toggle hides every AI object and keeps the hand-drawn ones", async ({
  page,
}) => {
  const links = await taskLinks(page);
  await page.goto(hrefOf(links, "Annotate task · Origin marks"));
  await expect(page.locator('[data-object^="O"]').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: /Display/ }).click();
  await page.getByRole("switch", { name: "Show the AI result" }).click();
  await expect(page.locator('[data-object^="O"]')).toHaveCount(0);
  await expect(page.locator('[data-object^="H"]')).toHaveCount(3);
  await page.getByRole("switch", { name: "Show the AI result" }).click();
  await expect(page.locator('[data-object^="O"]').first()).toBeVisible();
});

test("the owner signs off with the open threads warning", async ({ page }) => {
  const links = await taskLinks(page);
  await page.goto(hrefOf(links, "Annotate task · Owner sign-off"));
  const card = page.getByRole("region", { name: "Sign off" });
  await expect(card).toContainText("2 threads are still open.", { timeout: 20_000 });
  await card.getByRole("button", { name: "Sign off anyway" }).click();
  await expect(card).toContainText("Signed off");
  await expect(page.getByText("The layer is locked")).toBeVisible();
});

test("a streamed run finishes tiles, then cancel keeps what is finished", async ({ page }) => {
  const links = await taskLinks(page);
  await page.goto(hrefOf(links, "Annotate task · Whole-slide run"));
  const tiles = page.locator('[data-slot="run-tiles"] [data-state="finished"]');
  await expect(tiles).toHaveCount(9, { timeout: 20_000 });
  await expect(page.locator('[data-slot="run-tiles"] [data-state="running"]')).toHaveCount(1);
  await expect(tiles).toHaveCount(10, { timeout: 5_000 });
  await page.getByRole("button", { name: "Cancel run" }).click();
  await expect(page.getByText("Run cancelled, finished tiles kept")).toBeVisible();
  const kept = await tiles.count();
  expect(kept).toBeGreaterThanOrEqual(10);
  await page.waitForTimeout(2_500);
  await expect(tiles).toHaveCount(kept);
  await expect(page.locator('[data-object^="R"]').first()).toBeVisible();
});

test("colleagues' changes wait behind a marker until you ask to see them", async ({ page }) => {
  const links = await taskLinks(page);
  await page.goto(hrefOf(links, "Annotate task · Colleagues' changes"));
  const marker = page.getByRole("button", { name: /3 changes by Anna Kopecká/ });
  await expect(marker).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-object="O30"]')).toHaveAttribute("data-origin", "ai");
  await expect(page.locator('[data-object="H4"]')).toHaveCount(0);
  await marker.click();
  await expect(marker).toHaveCount(0);
  await expect(page.locator('[data-object="O30"]')).toHaveAttribute("data-origin", "ai-confirmed");
  await expect(page.locator('[data-object="H4"]')).toHaveCount(1);
  await expect(page.locator('[data-changed="H4"]')).toHaveCount(1);
});

test("a preset fills in the check options and the stepper carries them to Send", async ({
  page,
}) => {
  const links = await taskLinks(page);
  await page.goto(hrefOf(links, "New annotate task · Kind and presets"));
  const flow = page.getByTestId("new-annotate-task");
  await flow.getByRole("radio", { name: /Annotate by hand/ }).click();
  await flow.getByRole("button", { name: "Next" }).click();
  await flow.getByRole("button", { name: "Next" }).click();
  await flow.getByRole("button", { name: "Next" }).click();
  await expect(flow.getByRole("radio", { name: "Check every AI cell" })).toBeDisabled();
  await page.goto(hrefOf(links, "New annotate task · What to check · whole-slide run"));
  await expect(
    page.getByRole("radio", { name: "The cells the AI was least sure of" }),
  ).toBeChecked();
  await page.getByRole("radio", { name: "Top left to bottom right" }).click();
  await page.getByRole("radio", { name: /Export them marked as not checked/ }).click();
  await expect(page.getByText(/exported marked as not checked/)).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("switch", { name: /Blind first/ }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Exported marked as not checked")).toBeVisible();
  await expect(page.getByText("Top left to bottom right").first()).toBeVisible();
});
