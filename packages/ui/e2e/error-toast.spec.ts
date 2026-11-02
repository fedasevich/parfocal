import { expect, test } from "@playwright/test";

const story = (name: string) =>
  `/iframe.html?id=components-error-toasts--${name}&viewMode=story&globals=a11y.manual:!true`;

const kinds = [
  { story: "bad-request", title: "That request could not be done", action: null },
  { story: "unauthenticated", title: "Your session has ended", action: "Sign in again" },
  { story: "forbidden", title: "You do not have access", action: null },
  { story: "not-found", title: "This was not found", action: null },
  { story: "conflict", title: "Someone changed this first", action: "Reload" },
  { story: "validation", title: "Some fields need a fix", action: null },
  { story: "server", title: "Something went wrong on our side", action: "Try again" },
  { story: "network", title: "You are offline", action: "Try again" },
];

for (const kind of kinds) {
  test(`the ${kind.story} toast is an alert with its own copy and no server internals`, async ({
    page,
  }) => {
    await page.goto(story(kind.story));
    const toast = page.getByRole("alert");
    await expect(toast).toContainText(kind.title);
    await expect(toast).not.toContainText("Traceback");
    await expect(toast).not.toContainText("/srv/");
    await expect(toast).not.toContainText("ApiError");
    if (kind.action) {
      await toast.getByRole("button", { name: kind.action }).click();
      await expect(page.getByText("Action pressed")).toBeVisible();
    } else {
      await expect(toast.getByRole("button")).toHaveCount(1);
    }
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("a client error shows the server's safe detail", async ({ page }) => {
  await page.goto(story("bad-request"));
  await expect(page.getByRole("alert")).toContainText("The slide is still being prepared.");
});

test("validation errors show inline under their fields", async ({ page }) => {
  await page.goto(story("validation-inline"));
  await expect(page.getByRole("textbox", { name: "Task name" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByText("Give the task a name.")).toBeVisible();
  await expect(page.getByText("The due date is in the past.")).toBeVisible();
});
