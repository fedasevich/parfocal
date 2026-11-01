import { expect, type Page, test } from "@playwright/test";

const p03 = "00000000-0000-4000-8003-000000000003";
const a1 = "00000000-0000-4000-8005-000000000001";
const report = `/projects/${p03}/slides/${a1}/report`;
const coSign = `/projects/${p03}/slides/${a1}/co-sign`;

const scenes: { scene: string; step: string; sees: string }[] = [
  {
    scene: "findings",
    step: "Findings",
    sees: "3 deposits in 1 node, largest D1 at 8.0 mm, T1 on A1",
  },
  { scene: "staging", step: "Staging", sees: "Largest, sets the category" },
  { scene: "deposits", step: "Staging", sees: "Node 2 · measured by hand" },
  { scene: "deprm", step: "Staging", sees: "D2 removed" },
  { scene: "contra", step: "Staging", sees: "A deposit of 8.0 mm is a macrometastasis." },
  { scene: "text", step: "Report text", sees: "From the slide" },
  { scene: "sign", step: "Sign out", sees: "Check before you sign" },
  {
    scene: "cosign",
    step: "Sign out",
    sees: "You cannot sign out in this project. Lenka Malá can.",
  },
  { scene: "nostaging", step: "Report text", sees: "REACTIVE FOLLICULAR HYPERPLASIA" },
  { scene: "missing", step: "Sign out", sees: "Final diagnosis is empty" },
  { scene: "unmeasured", step: "Findings", sees: "D1, T1 on A1, not measured yet" },
];

const flow = (page: Page) => page.getByTestId("clinical-report");

for (const { scene, step, sees } of scenes) {
  test(`the ${scene} scene opens on ${step}`, async ({ page }) => {
    await page.goto(`${report}?scene=${scene}`);
    await expect(flow(page).getByRole("heading", { name: "Clinical report" })).toBeVisible();
    await expect(flow(page).locator('[aria-current="step"]')).toHaveText(new RegExp(step));
    await expect(flow(page).getByText(sees).first()).toBeVisible();
  });
}

test("the scenes that open a small modal show it on load", async ({ page }) => {
  await page.goto(`${report}?scene=depadd`);
  await expect(page.getByRole("dialog", { name: "Add a deposit" })).toBeVisible();
  await expect(page.getByText("T4 on A1 · H&E")).toBeVisible();

  await page.goto(`${report}?scene=dephand`);
  const hand = page.getByRole("dialog", { name: "Add a deposit" });
  await expect(hand.getByText("Use a number above 0, for example 1.5.")).toBeVisible();
  await expect(hand.getByText("Pick the slide you measured on.")).toBeVisible();

  await page.goto(`${report}?scene=ssofail`);
  const sign = page.getByRole("dialog", { name: "Sign out S26-04812" });
  await expect(
    sign.getByText("Vltava single sign-on did not answer. Nothing was signed."),
  ).toBeVisible();
  await sign.getByRole("button", { name: "Use my password instead" }).click();
  await expect(sign.getByLabel("Password for l.mala@fnvltava.cz")).toBeVisible();

  await page.goto(`${report}?scene=amend`);
  const amend = page.getByRole("dialog", { name: "Amend the report" });
  await expect(amend.getByText("Give a reason of at least 10 characters.")).toBeVisible();
});

test("the signed, amended and sent scenes show their state", async ({ page }) => {
  await page.goto(`${report}?scene=signed`);
  await expect(flow(page).getByText("Signed out 15 Oct 11:42 by Lenka Malá")).toBeVisible();
  await expect(flow(page).getByRole("button", { name: "Download PDF" })).toBeVisible();

  await page.goto(`${report}?scene=amended`);
  await expect(flow(page).getByText("AMENDED REPORT")).toBeVisible();
  await flow(page).getByRole("button", { name: "Open v1" }).click();
  await expect(flow(page).getByText("Final report, version 1")).toBeVisible();

  await page.goto(`${report}?scene=sent`);
  await expect(flow(page).getByText("Sent to Lenka Malá, 15 Oct 11:20 · waiting")).toBeVisible();
  await expect(flow(page).getByRole("button", { name: "Withdraw the request" })).toBeVisible();
});

test("Lenka fills Staging, removes a deposit with Undo and signs out with SSO", async ({
  page,
}) => {
  await page.goto(`${report}?scene=staging`);
  await flow(page).getByRole("button", { name: "Remove D2" }).click();
  await expect(flow(page).getByText("D2 removed")).toBeVisible();
  await flow(page).getByRole("button", { name: "Undo" }).click();
  await expect(flow(page).getByText("D2 removed")).toBeHidden();
  await flow(page)
    .getByRole("radio", { name: /Macrometastasis/ })
    .click();
  await flow(page).getByRole("radio", { name: "Absent" }).click();
  await flow(page).getByRole("button", { name: "Next" }).click();
  await expect(flow(page).locator('[aria-current="step"]')).toHaveText(/Report text/);
  await flow(page).getByRole("button", { name: "Next" }).click();
  await flow(page).getByRole("button", { name: "Sign out", exact: true }).click();
  const sign = page.getByRole("dialog", { name: "Sign out S26-04812" });
  await sign.getByRole("button", { name: /Sign with Vltava SSO/ }).click();
  await expect(flow(page).getByText("Signed out 15 Oct 11:42 by Lenka Malá")).toBeVisible();
});

test("a blocked Sign out lists what is missing", async ({ page }) => {
  await page.goto(`${report}?scene=missing`);
  const signOut = flow(page).getByRole("button", { name: "Sign out", exact: true });
  await expect(signOut).toHaveAttribute("aria-disabled", "true");
  await signOut.click({ force: true });
  await flow(page).getByRole("button", { name: "Go to Report text" }).click();
  await expect(flow(page).locator('[aria-current="step"]')).toHaveText(/Report text/);
  await expect(flow(page).getByText("Write the final diagnosis.")).toBeVisible();
});

test("Tomáš sends the report to Lenka for co-sign", async ({ page }) => {
  await page.goto(`${report}?scene=cosign`);
  await flow(page).getByPlaceholder("Type a name").click();
  await page.getByRole("option", { name: /Lenka Malá/ }).click();
  await flow(page).getByRole("button", { name: "Send for co-sign" }).click();
  await expect(flow(page).getByText("Sent to Lenka Malá, 15 Oct 11:20 · waiting")).toBeVisible();
});

test("the co-signer sees both values and either returns or co-signs", async ({ page }) => {
  await page.goto(`${coSign}?scene=review`);
  const review = page.getByTestId("co-sign");
  await expect(review.getByRole("heading", { name: "Co-sign the report" })).toBeVisible();
  await expect(
    review.getByText("Tomáš Beneš asks you to co-sign · sent 15 Oct 11:20"),
  ).toBeVisible();
  await expect(review.locator("[data-changed]").first()).toBeVisible();
  await review.getByRole("button", { name: "Return with a note" }).click();
  const back = page.getByRole("dialog", { name: "Return to Tomáš Beneš" });
  await back.getByLabel("Note to Tomáš").fill("Measure the widest extent across the capsule.");
  await back.getByRole("button", { name: /Return with the note/ }).click();
  await expect(review.getByText("Returned to Tomáš Beneš, 15 Oct 11:35").first()).toBeVisible();

  await page.goto(`${coSign}?scene=returned`);
  await expect(
    review.getByText("Measure the widest extent across the capsule, not inside the node."),
  ).toBeVisible();

  await page.goto(`${coSign}?scene=review`);
  await review.getByRole("button", { name: "Co-sign and sign out" }).click();
  const sign = page.getByRole("dialog", { name: "Co-sign and sign out S26-04812" });
  await sign.getByRole("button", { name: /Sign with Vltava SSO/ }).click();
  await expect(
    page.getByText("Reported by Tomáš Beneš, verified and signed by Lenka Malá").first(),
  ).toBeVisible();
});
