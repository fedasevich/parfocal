import { expect, type Locator, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;

type Out = { blocks: Record<string, unknown>[]; format: Record<string, unknown> };

const out = async (page: Page) =>
  JSON.parse((await page.getByTestId("out").textContent()) ?? "{}") as Out;

const kinds = async (page: Page) => (await out(page)).blocks.map((block) => block["kind"]);

const catalogue = (page: Page, name: string): Locator =>
  page
    .getByRole("complementary", { name: "Block catalogue" })
    .locator("button")
    .filter({ has: page.getByText(name, { exact: true }) });

const onPage = (page: Page, kind: string): Locator =>
  page.locator(`[data-kind="${kind}"]`).first().locator("button[aria-pressed]");

const open = async (page: Page, id = "components-report-editor--empty") => {
  await page.goto(story(id));
  await expect(page.getByTestId("out")).toBeVisible();
};

const pick = async (page: Page, label: string, option: string) => {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};

const catalogueNames: Record<string, string> = {
  "headline-numbers": "Headline numbers",
  "region-metrics": "Region metrics per slide",
  "confusion-matrix": "Cell type confusion matrix",
  "reviewer-agreement": "Agreement between reviewers",
  "disagreement-reasons": "Why reviewers disagreed",
  "opinion-answers": "Opinion answers",
  "worst-objects": "Objects, worst first",
  "slide-table": "Per-slide table",
  "slide-figure": "Slide figure",
  text: "Text",
  comparison: "Compare two result sets",
  "ai-changes": "How the experts changed the AI",
};

test("a block is dragged from the catalogue onto the page", async ({ page }) => {
  await open(page);
  await catalogue(page, "Per-slide table").dragTo(
    page.getByRole("region", { name: "Page 1 of 1" }),
  );
  expect(await kinds(page)).toEqual(["slide-table"]);
});

test("a block dragged to the empty part of a page goes to the end", async ({ page }) => {
  await open(page, "components-report-editor--with-blocks");
  await catalogue(page, "Text").dragTo(page.getByRole("region", { name: "Page 1 of 1" }), {
    targetPosition: { x: 260, y: 600 },
  });
  expect(await kinds(page)).toEqual([
    "headline-numbers",
    "region-metrics",
    "confusion-matrix",
    "text",
  ]);
});

test("a block dropped on the top half of another lands before it, on the bottom half after it", async ({
  page,
}) => {
  await open(page, "components-report-editor--with-blocks");
  const target = page.locator('[data-kind="region-metrics"]');
  await catalogue(page, "Text").dragTo(target, { targetPosition: { x: 20, y: 3 } });
  expect(await kinds(page)).toEqual([
    "headline-numbers",
    "text",
    "region-metrics",
    "confusion-matrix",
  ]);
  await catalogue(page, "Opinion answers").dragTo(target, { targetPosition: { x: 20, y: 90 } });
  expect(await kinds(page)).toEqual([
    "headline-numbers",
    "text",
    "region-metrics",
    "opinion-answers",
    "confusion-matrix",
  ]);
});

test("a block on the page is dragged to a new place", async ({ page }) => {
  await open(page, "components-report-editor--with-blocks");
  await onPage(page, "headline-numbers").dragTo(page.locator('[data-kind="confusion-matrix"]'), {
    targetPosition: { x: 20, y: 90 },
  });
  expect(await kinds(page)).toEqual(["region-metrics", "confusion-matrix", "headline-numbers"]);
});

test("a click adds a block after the selected one, or at the end", async ({ page }) => {
  await open(page, "components-report-editor--with-blocks");
  await catalogue(page, "Text").click();
  expect(await kinds(page)).toEqual([
    "headline-numbers",
    "region-metrics",
    "confusion-matrix",
    "text",
  ]);
  await onPage(page, "headline-numbers").click();
  await catalogue(page, "Slide figure").click();
  expect(await kinds(page)).toEqual([
    "headline-numbers",
    "slide-figure",
    "region-metrics",
    "confusion-matrix",
    "text",
  ]);
  await expect(page.getByRole("tab", { name: "Block" })).toHaveAttribute("aria-selected", "true");
});

test("the toolbar of a selected block moves, duplicates and removes it", async ({ page }) => {
  await open(page, "components-report-editor--with-blocks");
  await onPage(page, "region-metrics").click();
  const tools = page.getByRole("toolbar", { name: "Tools for Region metrics per slide" });
  await tools.getByRole("button", { name: "Move up" }).click();
  expect(await kinds(page)).toEqual(["region-metrics", "headline-numbers", "confusion-matrix"]);
  await expect(tools.getByRole("button", { name: "Move up" })).toBeDisabled();
  await tools.getByRole("button", { name: "Move down" }).click();
  await tools.getByRole("button", { name: "Move down" }).click();
  expect(await kinds(page)).toEqual(["headline-numbers", "confusion-matrix", "region-metrics"]);
  await expect(tools.getByRole("button", { name: "Move down" })).toBeDisabled();
  await tools.getByRole("button", { name: "Duplicate" }).click();
  expect(await kinds(page)).toEqual([
    "headline-numbers",
    "confusion-matrix",
    "region-metrics",
    "region-metrics",
  ]);
  await page
    .getByRole("toolbar", { name: "Tools for Region metrics per slide" })
    .getByRole("button", { name: "Remove" })
    .click();
  expect(await kinds(page)).toEqual(["headline-numbers", "confusion-matrix", "region-metrics"]);
  await expect(page.getByText("Click a block on the page to set its title")).toBeVisible();
});

test("the keyboard adds, moves and removes blocks", async ({ page }) => {
  await open(page, "components-report-editor--with-blocks");
  await catalogue(page, "Text").focus();
  await page.keyboard.press("Enter");
  expect(await kinds(page)).toEqual([
    "headline-numbers",
    "region-metrics",
    "confusion-matrix",
    "text",
  ]);
  await onPage(page, "text").focus();
  await page.keyboard.press("Alt+ArrowUp");
  expect(await kinds(page)).toEqual([
    "headline-numbers",
    "region-metrics",
    "text",
    "confusion-matrix",
  ]);
  await page.keyboard.press("Alt+ArrowDown");
  expect(await kinds(page)).toEqual([
    "headline-numbers",
    "region-metrics",
    "confusion-matrix",
    "text",
  ]);
  await page.keyboard.press("Delete");
  expect(await kinds(page)).toEqual(["headline-numbers", "region-metrics", "confusion-matrix"]);
});

test("the toolbar works from the keyboard", async ({ page }) => {
  await open(page, "components-report-editor--with-blocks");
  await onPage(page, "headline-numbers").click();
  await page.getByRole("button", { name: "Move down" }).focus();
  await page.keyboard.press("Enter");
  expect(await kinds(page)).toEqual(["region-metrics", "headline-numbers", "confusion-matrix"]);
  await page.getByRole("button", { name: "Duplicate" }).focus();
  await page.keyboard.press("Space");
  expect(await kinds(page)).toHaveLength(4);
});

test("the title, width and page break of a block are set", async ({ page }) => {
  await open(page);
  await catalogue(page, "Text").click();
  await page.getByLabel("Title", { exact: true }).fill("Methods");
  await page.getByRole("switch", { name: "Show the title" }).click();
  await page.getByRole("radio", { name: "Half" }).click();
  await page.getByRole("switch", { name: "Start on a new page" }).click();
  await catalogue(page, "Text").click();
  await page.getByRole("switch", { name: "Start on a new page" }).click();
  const { blocks } = await out(page);
  expect(blocks[0]).toMatchObject({
    title: "Methods",
    show_title: false,
    width: "half",
    page_break: true,
  });
  await expect(page.getByRole("region", { name: /^Page 2 of/ })).toBeVisible();
});

type Change = {
  kind: string;
  act: (page: Page) => Promise<void>;
  expected: Record<string, unknown>;
};

const changes: Change[] = [
  {
    kind: "headline-numbers",
    act: async (page) => {
      await page.getByRole("checkbox", { name: "Dice" }).click();
      await page.getByRole("checkbox", { name: "Cohen's κ" }).click();
      await page.getByRole("switch", { name: "95% confidence intervals" }).click();
    },
    expected: { metrics: ["sensitivity", "precision", "kappa"], confidence_intervals: true },
  },
  {
    kind: "region-metrics",
    act: async (page) => {
      await page.getByRole("checkbox", { name: "Precision" }).click();
      await pick(page, "Order", "Lowest sensitivity first");
      await pick(page, "Rows", "6 slides");
    },
    expected: { columns: ["sensitivity", "dice"], sort_by: "sensitivity", rows: 6 },
  },
  {
    kind: "confusion-matrix",
    act: async (page) => {
      await page.getByRole("radio", { name: "Share of row" }).click();
    },
    expected: { values: "share" },
  },
  {
    kind: "reviewer-agreement",
    act: async (page) => {
      await page.getByRole("checkbox", { name: "Cells" }).click();
    },
    expected: { parts: ["regions", "form"] },
  },
  {
    kind: "disagreement-reasons",
    act: async (page) => {
      await pick(page, "Show", "Top 3");
      await page.getByRole("radio", { name: "Table" }).click();
    },
    expected: { top: 3, style: "table" },
  },
  {
    kind: "opinion-answers",
    act: async (page) => {
      await page.getByRole("radio", { name: "Table" }).click();
    },
    expected: { style: "table" },
  },
  {
    kind: "worst-objects",
    act: async (page) => {
      await pick(page, "Rows", "20 objects");
      await page.getByRole("switch", { name: "Thumbnail of each object" }).click();
    },
    expected: { rows: 20, thumbnails: false },
  },
  {
    kind: "slide-table",
    act: async (page) => {
      await page.getByRole("checkbox", { name: "Review time" }).click();
      await pick(page, "Order", "Longest review first");
    },
    expected: { columns: ["objects", "disagreements"], sort_by: "time" },
  },
  {
    kind: "slide-figure",
    act: async (page) => {
      await page.getByRole("checkbox", { name: "AI result" }).click();
      await page.getByRole("textbox", { name: "Caption" }).fill("Object on slide A1");
    },
    expected: { layers: ["reviewed"], caption: "Object on slide A1" },
  },
  {
    kind: "text",
    act: async (page) => {
      await page.getByRole("textbox", { name: "Text" }).fill("Two blind readers.");
    },
    expected: { body: "Two blind readers." },
  },
  {
    kind: "comparison",
    act: async (page) => {
      await page.getByRole("checkbox", { name: "Dice" }).click();
    },
    expected: { metrics: ["sensitivity", "precision"] },
  },
  {
    kind: "ai-changes",
    act: async (page) => {
      await page.getByRole("radio", { name: "Slide" }).click();
      await page.getByRole("switch", { name: "Split by person" }).click();
    },
    expected: { group_by: "slide", people: false },
  },
];

for (const change of changes) {
  test(`the fields of ${change.kind} are set`, async ({ page }) => {
    await open(page);
    await catalogue(page, catalogueNames[change.kind] ?? "").click();
    await change.act(page);
    const { blocks } = await out(page);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: change.kind, ...change.expected });
  });
}

test("the last choice of a list cannot be switched off", async ({ page }) => {
  await open(page);
  await catalogue(page, "Compare two result sets").click();
  await page.getByRole("checkbox", { name: "Sensitivity" }).click();
  await page.getByRole("checkbox", { name: "Precision" }).click();
  await page.getByRole("checkbox", { name: "Dice" }).click();
  const { blocks } = await out(page);
  expect(blocks[0]?.["metrics"]).toEqual(["dice"]);
});

test("every format setting reaches the template", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Page and format" }).click();
  await page.getByRole("radio", { name: "US Letter" }).click();
  await page.getByRole("radio", { name: "Landscape" }).click();
  await page.getByRole("radio", { name: "Large" }).click();
  await page.getByRole("switch", { name: "Workspace logo" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Reader study");
  await page.getByLabel("Subtitle").fill("{task} and {model}");
  await page.getByRole("switch", { name: "Running header from page 2" }).click();
  await pick(page, "Page numbers", "None");
  await page.getByRole("switch", { name: "DRAFT watermark until signed off" }).click();
  await page.getByRole("switch", { name: "Signature block" }).click();
  await pick(page, "Language of labels", "Czech");
  await page.getByRole("radio", { name: "0.861" }).click();
  await page.getByRole("checkbox", { name: "How each metric is computed" }).click();
  await page.getByRole("checkbox", { name: "Every object with its full ID" }).click();
  await page.getByRole("checkbox", { name: "Word" }).click();
  await page.getByRole("checkbox", { name: "GeoJSON" }).click();
  await page.getByRole("checkbox", { name: "Web page" }).click();
  const { format } = await out(page);
  expect(format).toEqual({
    paper: "letter",
    orientation: "landscape",
    text_size: "large",
    logo: false,
    title: "Reader study",
    subtitle: "{task} and {model}",
    running_header: false,
    page_numbers: "none",
    draft_watermark: false,
    signature: false,
    label_language: "cs",
    decimals: 3,
    appendices: ["methods"],
    downloads: ["pdf", "html", "decisions", "objects"],
  });
  const paper = page.getByRole("region", { name: "Page 1 of 1" });
  const box = await paper.boundingBox();
  expect(box && box.width > box.height).toBe(true);
});

test("the format settings work from the keyboard", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Page and format" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("switch", { name: "Signature block" }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("checkbox", { name: "Word" }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("combobox", { name: "Page numbers" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const { format } = await out(page);
  expect(format).toMatchObject({ signature: false, page_numbers: "page" });
  expect(format["downloads"]).not.toContain("docx");
});

test("the task presets tab shows what the host puts in it", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Task presets" }).click();
  await expect(page.getByText("Presets are set by the screen")).toBeVisible();
});
