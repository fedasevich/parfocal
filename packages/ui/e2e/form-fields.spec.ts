import { expect, type Page, test } from "@playwright/test";

const open = async (page: Page, id: string, theme: "dark" | "light" = "dark") => {
  await page.goto(
    `/iframe.html?id=components-form-fields--${id}&viewMode=story&globals=theme:${theme};a11y.manual:!true`,
  );
  await page.locator("#storybook-root > *").first().waitFor();
};

test("text fields name their label and describe their help line or error", async ({ page }) => {
  await open(page, "text-field");
  const email = page.getByRole("textbox", { name: "Work email Required", exact: true });
  await expect(email).toBeFocused();
  await expect(email).toHaveAccessibleDescription("We send the sign in link here.");
  await expect(page.getByRole("textbox", { name: "Task name" })).toHaveAccessibleDescription(
    "Reviewers see it in My work.",
  );
  const endpoint = page.getByRole("textbox", { name: "Endpoint Required", exact: true });
  await expect(endpoint).toHaveAttribute("aria-invalid", "true");
  await expect(endpoint).toHaveAccessibleDescription(
    "The address needs to start with https://. Add it at the front.",
  );
  await expect(page.getByRole("textbox", { name: "Project" })).toBeDisabled();
});

test("the invalid field draws a red focus ring", async ({ page }) => {
  await open(page, "text-field");
  const endpoint = page.getByRole("textbox", { name: "Endpoint Required", exact: true });
  await endpoint.focus();
  const ring = await endpoint.evaluate((element) => getComputedStyle(element).boxShadow);
  const calm = await page.getByRole("textbox", { name: "Task name" }).evaluate((element) => {
    (element as HTMLElement).focus();
    return getComputedStyle(element).boxShadow;
  });
  expect(ring).not.toBe("none");
  expect(ring).not.toBe(calm);
});

test("the text area counts characters and ties its error", async ({ page }) => {
  await open(page, "text-area");
  const message = page.getByRole("textbox", { name: "Message to reviewers" });
  await expect(message).toBeFocused();
  await message.fill("Look at the margins.");
  await expect(page.getByText("20 of 300")).toBeVisible();
  await expect(message).toHaveAccessibleDescription("Shown above the first slide.");
  await expect(page.getByRole("textbox", { name: "Change note" })).toHaveAccessibleDescription(
    "The note is too short to explain the change. Use at least 10 characters.",
  );
  await expect(page.getByRole("textbox", { name: "Previous note" })).toBeDisabled();
});

test("the select names its label and describes its help line or error", async ({ page }) => {
  await open(page, "select-field");
  const stain = page.getByRole("combobox", { name: "Stain Required", exact: true });
  await expect(stain).toBeFocused();
  await expect(stain).toHaveAccessibleDescription("The model only reads this stain.");
  await expect(
    page.getByRole("combobox", { name: "Counter stain Required", exact: true }),
  ).toHaveAccessibleDescription("No stain is picked. Pick the stain the slides were cut with.");
  await expect(
    page.getByRole("combobox", { name: "Locked stain Required", exact: true }),
  ).toBeDisabled();
});

test("the checkbox names its label and describes its help line or error", async ({ page }) => {
  await open(page, "checkbox-states");
  const notify = page.getByRole("checkbox", { name: "Email me when the task is done" });
  await expect(notify).toBeFocused();
  await expect(notify).toHaveAccessibleDescription("One email per task, never more.");
  await expect(page.getByRole("checkbox", { name: "Hide the AI confidence" })).toBeChecked();
  const confirm = page.getByRole("checkbox", { name: /no patient names/ });
  await expect(confirm).toHaveAttribute("aria-invalid", "true");
  await expect(confirm).toHaveAccessibleDescription(
    "Confirm this before you send. Check the box once the slides are clean.",
  );
  await expect(page.getByRole("checkbox", { name: "Share with the whole lab" })).toBeDisabled();
});

test("the radio group names its legend and describes its help line or error", async ({ page }) => {
  await open(page, "radio-states");
  const order = page.getByRole("radiogroup", { name: "Object order" });
  await expect(order).toHaveAccessibleDescription("Decides what reviewers see first.");
  await expect(order.getByRole("radio", { name: /AI order/ })).toBeFocused();
  await expect(
    page.getByRole("radiogroup", { name: "Second order" }).getByRole("radio", { name: /Random/ }),
  ).toBeChecked();
  await expect(page.getByRole("radiogroup", { name: /Round order/ })).toHaveAccessibleDescription(
    "No order is picked. Pick one so every reviewer gets the same rule.",
  );
  await expect(
    page.getByRole("radiogroup", { name: "Locked order" }).getByRole("radio", { name: /AI/ }),
  ).toBeDisabled();
});

test("a disabled radio group dims every row's text", async ({ page }) => {
  await open(page, "radio-states");
  const locked = page.getByRole("radiogroup", { name: "Locked order" });
  await expect(locked.locator('[data-slot="radio-row"] > span:last-child').first()).toHaveCSS(
    "opacity",
    "0.4",
  );
  await expect(locked.getByRole("radio", { name: /AI/ })).toBeDisabled();
});

for (const theme of ["dark", "light"] as const) {
  test(`an error never clears what was typed in ${theme}`, async ({ page }) => {
    await open(page, "error-keeps-typing", theme);
    const email = page.getByRole("textbox", { name: /Work email/ });
    await email.fill("lena.example");
    await page.getByRole("button", { name: "Send the link" }).click();
    await expect(email).toHaveAccessibleDescription(
      "The email has no @ sign. Type the full address, like name@hospital.example.",
    );
    await expect(email).toHaveValue("lena.example");
    await email.fill("lena@hospital.example");
    await page.getByRole("button", { name: "Send the link" }).click();
    await expect(email).not.toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveValue("lena@hospital.example");
  });
}
