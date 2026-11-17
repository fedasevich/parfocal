import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

for (const width of [1280, 1920]) {
  test(`the slide row's file and open buttons sit side by side at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/projects/${p07}?tab=slides&as=DH`);
    const row = page.getByTestId("slide-row").filter({ hasText: "tumor_031" });
    const file = row.getByRole("button", { name: "File into a case" });
    const open = row.getByRole("button", { name: "Open" });
    await expect(file).toBeVisible();
    await expect(open).toBeVisible();
    const a = await file.boundingBox();
    const b = await open.boundingBox();
    if (!a || !b) throw new Error("buttons have no box");
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    expect(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2))).toBeLessThan(2);
  });
}
