import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const cellsSlide = "00000000-0000-4000-8005-000000000008";

test.use({ viewport: { width: 1440, height: 900 } });

async function watchCalls(page: Page) {
  await page.addInitScript(() => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : (init?.method ?? "GET");
      const path = new URL(url, window.location.href).pathname;
      const kind = path.endsWith("/decisions/batch")
        ? "batch"
        : /\/decisions\/[^/]+$/.test(path) && method === "PUT"
          ? "single"
          : path.endsWith("/submit") && method === "POST"
            ? "submit"
            : null;
      if (kind !== null) {
        sessionStorage.setItem(kind, String(Number(sessionStorage.getItem(kind)) + 1));
      }
      if (kind === "submit" && sessionStorage.getItem("refuse")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ type: "about:blank", title: "Failed", status: 500, code: "server" }),
            { status: 500, headers: { "content-type": "application/problem+json" } },
          ),
        );
      }
      return real(input, init);
    };
  });
}

const callsOf = (page: Page, kind: string) =>
  page.evaluate((name) => Number(sessionStorage.getItem(name)), kind);

test("agree with the rest is one call, and a refused submit stays on the slide with Try again", async ({
  page,
}) => {
  await watchCalls(page);
  await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt14}&mode=cells`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  const grid = page.getByTestId("stage-cells-grid");
  await grid.getByRole("button", { name: /Agree with the rest/ }).click();
  await grid.getByRole("button", { name: /Agree with 3/ }).click();
  await expect(page.getByText("3 cells marked agree")).toBeVisible();
  expect(await callsOf(page, "batch")).toBe(1);
  expect(await callsOf(page, "single")).toBe(0);

  await page.evaluate(() => sessionStorage.setItem("refuse", "yes"));
  const submit = page.getByTestId("top-submit");
  await expect(submit).toBeEnabled();
  const before = page.url();
  await submit.click();
  await expect.poll(() => callsOf(page, "submit")).toBe(1);
  await expect(page.getByTestId("top-submit-failed")).toHaveText(
    "The slide was not submitted. Nothing was lost.",
  );
  await expect(submit).toHaveText("Try again");
  expect(page.url()).toBe(before);
  await expect(page.getByRole("dialog", { name: /submitted/ })).toHaveCount(0);

  await page.evaluate(() => sessionStorage.removeItem("refuse"));
  await submit.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${rt14}/submitted`));
});
