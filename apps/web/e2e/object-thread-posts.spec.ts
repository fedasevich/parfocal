import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const daniel = "00000000-0000-4000-8001-000000000009";

test.use({ viewport: { width: 1280, height: 900 } });

const composer = (page: Page) => page.getByRole("textbox", { name: "Comment on T5" });

test("a comment written on an object in guided review survives a reload and shows in the Comments tab", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await page.getByRole("tab", { name: /Comments/ }).click();
  await expect(page.getByText("No comments on T5 yet")).toBeVisible();
  await composer(page).pressSequentially("Check the capsule fold @Dan");
  await expect(page.getByRole("listbox", { name: "Mention someone" })).toBeVisible();
  await page.keyboard.press("Enter");
  const created = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/threads"),
  );
  await composer(page).pressSequentially("before the next slide");
  await page.keyboard.press("Enter");
  const sent = (await created).postDataJSON() as {
    body: string;
    anchor: { kind: string; object_id: string };
  };
  expect(sent.anchor).toMatchObject({ kind: "object", object_id: "T5" });
  expect(sent.body).toBe(`Check the capsule fold @[${daniel}] before the next slide`);
  const text = "Check the capsule fold @Daniel Hruška before the next slide";
  await expect(page.locator("p").filter({ hasText: text })).toBeVisible();
  await expect(composer(page)).toHaveValue("");

  await page.reload();
  await page.getByRole("tab", { name: /Comments/ }).click();
  await expect(page.locator("p").filter({ hasText: text })).toBeVisible();

  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&tab=comments`);
  await expect(
    page.locator('[data-slot="thread-card"]', { hasText: "Check the capsule fold" }),
  ).toContainText("T5");
});

test("a second comment on the same object replies in the same thread", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await page.getByRole("tab", { name: /Comments/ }).click();
  await composer(page).fill("First note");
  await page.keyboard.press("Enter");
  const messages = page.locator("p");
  await expect(messages.filter({ hasText: "First note" })).toBeVisible();
  const reply = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/messages"),
  );
  await composer(page).fill("Second note");
  await expect(composer(page)).toHaveValue("Second note");
  await page.keyboard.press("Enter");
  await reply;
  await expect(messages.filter({ hasText: "Second note" })).toBeVisible();
  await expect(messages.filter({ hasText: "First note" })).toBeVisible();
});
