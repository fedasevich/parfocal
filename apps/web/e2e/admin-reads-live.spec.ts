import { expect, test } from "./a11y.ts";
import { area, call, realTags, roleCredentials, signIn } from "./real.ts";

const adminReads = [
  "/api/tenant/overview",
  "/api/tenant/storage",
  "/api/tenant/webhooks",
  "/api/tenant/security",
  "/api/tenant/retention",
  "/api/tenant/legal-holds",
  "/api/tenant/security-contact",
  "/api/tenant/join-settings",
  "/api/tenant/service-accounts",
  "/api/tenant/ai-usage",
  "/api/tenant/models",
  "/api/tenant/audit-events",
];

test(
  "a researcher without admin rights is refused by the page and by every admin read",
  realTags(area.admin),
  async ({ page }) => {
    const researcher = roleCredentials("researcher");
    test.skip(researcher === null, "PARFOCAL_ROLE_RESEARCHER_EMAIL and _PASSWORD are not set");
    if (researcher === null) return;
    await signIn(page, "/my-work", researcher);
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "You do not have admin rights in this workspace" }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin sections" })).toHaveCount(0);
    for (const path of adminReads) {
      expect((await call(page, "GET", path)).status, path).toBe(403);
    }
    expect((await call(page, "GET", "/api/tenant/import-sources")).status).toBe(200);
  },
);
