import { round5Tasks } from "../src/study/study-model.ts";
import { expect, test } from "./a11y.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const firstTask = round5Tasks[0]?.instruction ?? "";

test("the moderator prepares the code the participant page shows and task 1 starts", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/study");
  const code = (await page.getByTestId("study-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^P-[A-Z0-9]{4}$/);
  await page.getByRole("button", { name: "I agree and start" }).click();
  await expect(page.getByTestId("study-goal-big")).toHaveText(firstTask);
  await expect(page.getByTestId("study-start-blocked")).toContainText(code, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Start task", exact: true })).toBeDisabled({
    timeout: 15_000,
  });

  await page.goto("/study/console");
  const field = page.getByRole("textbox", { name: "Code to prepare" });
  await expect(field).toHaveValue(code);
  await page.getByRole("button", { name: "Prepare the participant" }).click();
  await expect(page.getByTestId("study-prepare-status")).toHaveText(
    `Study ${code} is ready in ČVUT · Usability study.`,
  );

  await page.goto("/study");
  await expect(page.getByTestId("study-goal-big")).toHaveText(firstTask);
  await expect(page.getByTestId("study-start-blocked")).toHaveCount(0);
  const start = page.getByRole("button", { name: "Start task", exact: true });
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+\?tab=slides$/);
  await expect(page.getByTestId("study-goal")).toHaveText(firstTask);
});

test("removing a prepared code turns Start task off again with the reason", async ({ page }) => {
  await page.goto("/study/console");
  await page.getByRole("textbox", { name: "Code to prepare" }).fill("p-gone");
  await page.getByRole("button", { name: "Prepare the participant" }).click();
  await expect(page.getByTestId("study-prepare-status")).toHaveText(
    "Study P-GONE is ready in ČVUT · Usability study.",
  );
  await page.getByRole("button", { name: "Remove the project" }).click();
  await expect(page.getByTestId("study-prepare-status")).toHaveText(
    "The project of P-GONE is removed.",
  );
  await page.goto("/study");
  await expect(page.getByTestId("study-code")).toHaveText("P-GONE");
  await page.getByRole("button", { name: "I agree and start" }).click();
  await expect(page.getByTestId("study-start-blocked")).toContainText("P-GONE", {
    timeout: 15_000,
  });
});
