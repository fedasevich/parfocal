import { expect, type Page, test } from "@playwright/test";

const projectId = "00000000-0000-4000-8003-000000000007";

const goInApp = async (page: Page, path: string) => {
  await page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
};

const catalogue = (page: Page, name: string) =>
  page
    .getByRole("complementary", { name: "Block catalogue" })
    .locator("button")
    .filter({ has: page.getByText(name, { exact: true }) });

test("a template is created, previewed, used in a review task and retired", async ({ page }) => {
  await page.goto("/admin?section=templates");
  await expect(page.getByRole("heading", { name: "Report templates" })).toBeVisible();

  await page.getByRole("button", { name: "New template" }).click();
  const modal = page.getByRole("dialog", { name: "New study template" });
  await modal.getByRole("button", { name: "Create and open" }).click();
  await expect(modal.getByText("Give the template a name.").first()).toBeVisible();
  await modal.getByRole("textbox").fill("Lab reader study");
  await modal.getByRole("radio", { name: "US Letter" }).click();
  await modal.getByRole("button", { name: "Create and open" }).click();

  await expect(page.getByRole("heading", { name: "Lab reader study" })).toBeVisible();
  await expect(page.getByText("An empty page. Drag a block here")).toBeVisible();
  await catalogue(page, "Text").click();
  await catalogue(page, "Headline numbers").click();
  await page.getByRole("group", { name: "Block 1, Text" }).locator("button[aria-pressed]").click();
  await page.getByRole("textbox", { name: "Text" }).fill("Two blind readers.");
  await page.getByRole("tab", { name: "Page and format" }).click();
  await expect(page.getByRole("radio", { name: "US Letter" })).toBeChecked();
  await page.getByRole("tab", { name: "Task presets" }).click();
  await page.getByRole("switch", { name: "First read without the AI" }).click();

  await page.getByRole("button", { name: "Preview the PDF" }).click();
  await expect(page.getByText("Lab_reader_study_sample.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Close the preview" }).click();

  const saved = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/api/study-templates"),
  );
  await page.getByRole("button", { name: "Save template" }).click();
  const body = (await saved).postDataJSON() as {
    name: string;
    blocks: { kind: string; body?: string }[];
    format: { paper: string };
    presets: { first_read: boolean };
  };
  expect(body.name).toBe("Lab reader study");
  expect(body.blocks.map((block) => block.kind)).toEqual(["text", "headline-numbers"]);
  expect(body.blocks[0]?.body).toBe("Two blind readers.");
  expect(body.format.paper).toBe("letter");
  expect(body.presets.first_read).toBe(true);

  const row = page.getByRole("row", { name: /Lab reader study/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("v1");
  await expect(row).toContainText("Headline numbers");

  await goInApp(page, `/projects/${projectId}/tasks/new`);
  const flow = page.getByTestId("new-task");
  await flow.getByRole("button", { name: "Next" }).click();
  await flow.getByRole("combobox", { name: "Study template" }).click();
  await expect(page.getByRole("option", { name: /Lab reader study/ })).toBeVisible();
  await page.getByRole("option", { name: /Lab reader study/ }).click();
  await expect(flow.getByRole("combobox", { name: "Study template" })).toContainText(
    "Lab reader study",
  );

  await goInApp(page, "/admin?section=templates");
  await page.getByRole("button", { name: "More for Lab reader study" }).click();
  await page.getByRole("menuitem", { name: "Retire" }).click();
  await expect(page.getByText("Lab reader study is retired.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Lab reader study/ })).toContainText("Retired");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("row", { name: /Lab reader study/ })).not.toContainText("Retired");
  await page.getByRole("button", { name: "More for Lab reader study" }).click();
  await page.getByRole("menuitem", { name: "Retire" }).click();
  await expect(page.getByRole("row", { name: /Lab reader study/ })).toContainText("Retired");
});

test("Use for new projects makes a template the default and undo puts the old one back", async ({
  page,
}) => {
  await page.goto("/admin?section=templates");
  const row = page.getByRole("row", { name: /Detection study/ });
  await expect(row).not.toContainText("Default");
  await page.getByRole("button", { name: "More for Detection study" }).click();
  await page.getByRole("menuitem", { name: "Use for new projects" }).click();
  await expect(page.getByText("Detection study is now the default for new projects")).toBeVisible();
  await expect(row).toContainText("Default");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row).not.toContainText("Default");
});

test("a built-in template is duplicated, changed and saved as a new template", async ({ page }) => {
  await page.goto("/admin?section=templates");
  await page.getByRole("button", { name: "Duplicate Detection study" }).click();
  await expect(page.getByRole("heading", { name: "Detection study copy" })).toBeVisible();
  await page.getByRole("tab", { name: "Page and format" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Detection study, landscape");
  await page.getByRole("radio", { name: "Landscape" }).click();
  const saved = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/api/study-templates"),
  );
  await page.getByRole("button", { name: "Save template" }).click();
  const body = (await saved).postDataJSON() as { name: string; format: { orientation: string } };
  expect(body.name).toBe("Detection study, landscape");
  expect(body.format.orientation).toBe("landscape");
  await expect(page.getByRole("row", { name: /Detection study, landscape/ })).toBeVisible();
});

test("the workspace default cannot be retired", async ({ page }) => {
  await page.goto("/admin?section=templates");
  await page.getByRole("button", { name: "More for Detection study" }).click();
  await page.getByRole("menuitem", { name: "Use for new projects" }).click();
  await expect(page.getByRole("row", { name: /Detection study/ })).toContainText("Default");
  await page.getByRole("button", { name: "More for Detection study" }).click();
  await page.getByRole("menuitem", { name: "Retire" }).click();
  await expect(page.getByText("Pick another default first.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Detection study/ })).not.toContainText("Retired");
});
