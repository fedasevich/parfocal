import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

const engineRequests = (page: Page) => {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("viewer-engine")) seen.push(request.url());
  });
  return seen;
};

const searchOf = (page: Page) => new URL(page.url()).searchParams;

test("the home page does not load the viewer engine", async ({ page }) => {
  const seen = engineRequests(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Good afternoon, Lenka" })).toBeVisible();
  expect(seen).toEqual([]);
});

test("a slide link carries project, task, camera and selected object and survives a reload", async ({
  page,
}) => {
  const seen = engineRequests(page);
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&x=0.25&y=0.75&z=6&object=T5`);
  await expect(page.getByTestId("full-viewer")).toBeVisible();
  expect(seen.length).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByTestId("full-viewer")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${p07}/slides/${a1}\\?`));
  const search = searchOf(page);
  expect(search.get("task")).toBe(rt14);
  expect(search.get("x")).toBe("0.25");
  expect(search.get("y")).toBe("0.75");
  expect(search.get("z")).toBe("6");
  expect(search.get("object")).toBe("T5");
});

test("My work keeps its tab in the link", async ({ page }) => {
  for (const [tab, shows] of [
    ["review", "Continue reviewing"],
    ["assigned", "7 disagreements"],
    ["all", "tumor_090"],
  ] as const) {
    await page.goto(`/my-work?tab=${tab}`);
    await expect(page.getByText(shows).first()).toBeVisible();
    await page.reload();
    expect(searchOf(page).get("tab")).toBe(tab);
  }
});

test("a project link keeps its tab and filters", async ({ page }) => {
  await page.goto(`/projects/${p07}?tab=tasks`);
  await expect(page).toHaveURL(/tab=tasks/);
  await page.goto(`/projects/${p07}?tab=slides&status=open&q=tumor`);
  await expect(page.getByRole("main").first()).toBeVisible();
  await page.reload();
  const search = searchOf(page);
  expect(search.get("tab")).toBe("slides");
  expect(search.get("status")).toBe("open");
  expect(search.get("q")).toBe("tumor");
});

test("guided review, the evaluation report, setup, settings and admin open from a link", async ({
  page,
}) => {
  const links: { path: string; shows: string | RegExp }[] = [
    {
      path: `/tasks/${rt14}/guided?slide=${a1}&scene=first`,
      shows: "The AI found this. It is outlined in white.",
    },
    { path: `/tasks/${rt14}/evaluation?scene=report`, shows: "Research output" },
    { path: "/setup", shows: /Set up|workspace/i },
    { path: "/settings/display", shows: "Display" },
    { path: "/settings/shortcuts", shows: "Shortcuts" },
    { path: "/admin?section=people", shows: /People/ },
  ];
  for (const { path, shows } of links) {
    await page.goto(path);
    await expect(page.getByText(shows).first()).toBeVisible();
  }
});

test("a settings link with an unknown section shows not found instead of the app", async ({
  page,
}) => {
  await page.goto("/settings/not-a-section");
  await expect(page.getByText(/not found/i).first()).toBeVisible();
});

test("admin is its own page and keeps its section in the link", async ({ page }) => {
  await page.goto("/admin?section=storage");
  await page.reload();
  expect(searchOf(page).get("section")).toBe("storage");
});
