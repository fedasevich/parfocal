import { test as base, expect, type Page } from "@playwright/test";
import { call, field, readSession, signIn } from "./support.ts";
import { purgeWorkspace, researcherWorkspace } from "./workspaces.ts";

export interface Researcher {
  me: string;
  subject: string;
  tenantId: string;
}

export const test = base.extend<{ researcher: Researcher }>({
  researcher: [
    async ({ page }, use) => {
      await signIn(page, "/");
      const profile = await call(page, "GET", "/api/me");
      const me = field(profile, "user_id");
      const home: unknown = Reflect.get(profile.json ?? {}, "active_tenant_id");
      const { subject } = await readSession(page);
      const tenantId = researcherWorkspace(me);
      try {
        const switched = await call(page, "PUT", "/api/me/workspace", { tenant_id: tenantId });
        expect(switched.status, JSON.stringify(switched.json)).toBe(200);
        await use({ me, subject, tenantId });
      } finally {
        if (typeof home === "string" && !page.isClosed()) {
          await call(page, "PUT", "/api/me/workspace", { tenant_id: home }).catch(() => undefined);
        }
        purgeWorkspace(tenantId);
      }
    },
    { timeout: 120_000 },
  ],
});

export { expect };

export async function debugHandle(page: Page, member: string): Promise<void> {
  await page.waitForFunction((name) => {
    const handle: unknown = Reflect.get(globalThis, "__parfocal");
    return typeof handle === "object" && handle !== null && name in handle;
  }, member);
}
