import { expect, type Page } from "@playwright/test";

export const parts = [1, 2, 3, 4] as const;

export function inPart<T>(items: readonly T[], part: number): T[] {
  return items.filter((_, index) => index % parts.length === part - 1);
}

export async function hidePanelWhilePanning(page: Page, persona?: string) {
  await page.goto(persona ? `/settings/layout?as=${persona}` : "/settings/layout");
  const hides = page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("radiogroup", { name: "Panel while moving" })
    .getByRole("radio", { name: "Hides while panning" });
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && response.url().endsWith("/api/me/setting-layers"),
  );
  await hides.click();
  await expect(hides).toBeChecked();
  await saved;
}
