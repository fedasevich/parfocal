import type { Page } from "@playwright/test";
import { expect, test } from "./telemetry-capture.ts";

const p03 = "00000000-0000-4000-8003-000000000003";
const sentinelCase = "00000000-0000-4000-8004-000000000006";
const report = `/projects/${p03}/cases/${sentinelCase}/report`;
const coSign = `/projects/${p03}/cases/${sentinelCase}/co-sign`;

test.setTimeout(120_000);

const flow = (page: Page) => page.getByTestId("clinical-report");
const review = (page: Page) => page.getByTestId("co-sign");
const step = (page: Page) => flow(page).locator('[aria-current="step"]');

async function next(page: Page, to: RegExp) {
  await flow(page).getByRole("button", { name: "Next" }).click();
  await expect(step(page)).toHaveText(to);
}

async function sendToLenka(page: Page) {
  await flow(page).getByPlaceholder("Type a name").click();
  await page.getByRole("option", { name: /Lenka Malá/ }).click();
  await flow(page).getByRole("button", { name: "Send for co-sign" }).click();
  await expect(flow(page).getByText(/Sent to Lenka Malá, .* · waiting/)).toBeVisible();
}

test("Tomáš sends for co-sign, Lenka returns it with a note, then co-signs it", async ({
  page,
}) => {
  await page.goto(`${report}?as=TB`);
  await expect(step(page)).toHaveText(/Findings/);
  await next(page, /Staging/);
  await flow(page)
    .getByRole("radio", { name: /Macrometastasis/ })
    .click();
  await flow(page).getByRole("radio", { name: "Absent" }).click();
  await next(page, /Report text/);
  await next(page, /Sign out/);
  await sendToLenka(page);

  await page.goto("/my-work");
  await expect(page.getByText(/asks you to co-sign/)).toBeVisible();
  await page.getByRole("button", { name: "Open" }).first().click();
  await expect(review(page).getByRole("heading", { name: "Co-sign the report" })).toBeVisible();
  await expect(review(page).getByText(/Tomáš Beneš asks you to co-sign · sent /)).toBeVisible();
  await review(page).getByLabel("Nodes examined").fill("3");
  await expect(review(page).locator("[data-changed]").first()).toBeVisible();
  await review(page).getByRole("button", { name: "Return with a note" }).click();
  const back = page.getByRole("dialog", { name: "Return to Tomáš Beneš" });
  await back.getByLabel("Note to Tomáš").fill("Short");
  await back.getByRole("button", { name: /Return with the note/ }).click();
  await expect(back.getByText("Use at least 10 characters.")).toBeVisible();
  await back.getByLabel("Note to Tomáš").fill("Count the examined nodes again, I see three.");
  await back.getByRole("button", { name: /Return with the note/ }).click();
  await expect(
    review(page)
      .getByText(/Returned to Tomáš Beneš/)
      .first(),
  ).toBeVisible();

  await page.goto(`${report}?as=TB`);
  await expect(flow(page).getByText("Returned by Lenka Malá")).toBeVisible();
  await expect(flow(page).getByText("Count the examined nodes again, I see three.")).toBeVisible();
  await expect(flow(page).getByText(/Changed by Lenka: nodes examined/)).toBeVisible();
  await next(page, /Staging/);
  await next(page, /Report text/);
  await next(page, /Sign out/);
  await sendToLenka(page);

  await page.goto(coSign);
  await expect(review(page).getByText(/Tomáš Beneš asks you to co-sign/)).toBeVisible();
  await review(page).getByRole("button", { name: "Co-sign and sign out" }).click();
  const sign = page.getByRole("dialog", { name: "Co-sign and sign out S26-04812" });
  await sign.getByRole("button", { name: /Sign with Vltava SSO/ }).click();
  await expect(
    page.getByText("Co-signed and signed out. The report names you both."),
  ).toBeVisible();
});
