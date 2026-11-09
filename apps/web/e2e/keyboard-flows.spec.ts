import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const p03 = "00000000-0000-4000-8003-000000000003";
const sentinelCase = "00000000-0000-4000-8004-000000000006";
const report = `/projects/${p03}/cases/${sentinelCase}/report`;

test.use({ viewport: { width: 1280, height: 1100 } });

async function plainFullViewerUrl(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  const href = (await link.getAttribute("href")) ?? "";
  const url = new URL(href, "http://localhost");
  return `${url.pathname}?task=${rt14}`;
}

test("review: a reviewer picks an object and decides it with the keyboard only", async ({
  page,
}) => {
  await page.goto(await plainFullViewerUrl(page));
  const panel = page.getByRole("complementary", { name: "Side panel" });
  const rowOf = (object: string) =>
    panel.getByRole("button", { name: new RegExp(`^${object} Tumor region`) });
  const decide = async (object: string, key: string, shown: string) => {
    await rowOf(object).focus();
    await expect(rowOf(object)).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press(key);
    await expect(rowOf(object)).toContainText(shown);
  };
  await decide("T5", "x", "disagree");
  await decide("T4", "k", "agree");
  await decide("T3", "u", "not sure");
});

test("review: the comment composer takes a note from the keyboard and releases focus on Tab", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/comments?slide=${a1}&thread=T2`);
  const composer = page
    .getByRole("region", { name: "Thread on T2" })
    .getByRole("textbox", { name: "Comment on T2" });
  await expect(composer).toBeEditable({ timeout: 20_000 });
  await composer.focus();
  await page.keyboard.type("Checked with the keyboard");
  await expect(composer).toHaveValue("Checked with the keyboard");
  await page.keyboard.press("Tab");
  await expect(composer).not.toBeFocused();
});

test("sign out: the report dialog is reached, kept inside and closed without a pointer", async ({
  page,
}) => {
  await page.goto(`${report}?scene=sign`);
  const signOut = page
    .getByTestId("clinical-report")
    .getByRole("button", { name: "Sign out", exact: true });
  await signOut.focus();
  await expect(signOut).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Sign out S26-04812" });
  await expect(dialog).toBeVisible();
  const sso = dialog.getByRole("button", { name: /Sign with Vltava SSO/ });
  await sso.focus();
  await expect(sso).toBeFocused();
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        dialog.evaluate((node) => {
          const active = document.activeElement;
          return node.contains(active) || active?.hasAttribute("data-base-ui-focus-guard") === true;
        }),
      )
      .toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("sign out: log out from the account menu with the keyboard only", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Account menu" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const logOut = page.getByRole("menuitem", { name: "Log out" });
  await expect(logOut).toBeVisible();
  for (let step = 0; step < 20; step++) {
    if (await logOut.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(logOut).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in to Parfocal" })).toBeVisible();
});
