import { expect, type Page, test } from "@playwright/test";

const rt17 = "00000000-0000-4000-8007-000000000017";
const a1 = "00000000-0000-4000-8005-000000000001";
const p07 = "00000000-0000-4000-8003-000000000007";
const camName = "CAMELYON";

test.use({ viewport: { width: 1440, height: 1000 } });

const firstReadOf = (page: Page) =>
  page.evaluate(
    async ([task, slide]) => {
      const response = await fetch(`/api/review-tasks/${task}/slides/${slide}/first-read`);
      return { status: response.status, body: (await response.json()) as unknown };
    },
    [rt17, a1] as const,
  );

test("the AI is absent before the first read, appears after it, and the first read stays as recorded", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(`/tasks/${rt17}/guided?slide=${a1}`);
  const hidden = page.locator('main[data-ai="hidden"]');
  await expect(hidden).toBeVisible();
  await expect(page.getByTestId("first-read-panel")).toContainText("Read the slide without the AI");
  await expect(page.getByRole("button", { name: "Whole slide" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Objects" })).toHaveCount(0);
  await expect(page.getByText(/The AI says/)).toHaveCount(0);
  expect((await firstReadOf(page)).status).toBe(404);

  const record = page.getByRole("button", { name: "Record my first read" });
  await expect(record).toBeDisabled();
  await page.getByRole("button", { name: "Tumor present" }).click();
  await expect(record).toBeEnabled();

  await page.getByRole("button", { name: "Add an object" }).click();
  const stage = page.locator("[data-slot=slide-still]");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  for (const [x, y] of [
    [0.3, 0.3],
    [0.6, 0.32],
    [0.58, 0.6],
  ] as const) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  await expect(page.getByTestId("redraw-vertex")).toHaveCount(3);
  const added = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/added"),
  );
  await page.getByRole("button", { name: "Finish outline" }).click();
  await added;
  await expect(page.getByTestId("first-read-added")).toHaveText("1 added.");

  await record.click();
  await expect(page.locator('main[data-ai="shown"]')).toBeVisible();
  await expect(hidden).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Objects" })).toBeVisible();
  await expect(page.getByTestId("first-read-panel")).toHaveCount(0);

  const recorded = await firstReadOf(page);
  expect(recorded.status).toBe(200);
  const first = recorded.body as { answers: Record<string, unknown>; added: unknown[] };
  expect(first.answers["findings"]).toBe("Tumor present");
  expect(first.added).toHaveLength(1);

  const gotIt = page.getByRole("button", { name: "Got it, start" });
  if (await gotIt.isVisible()) await gotIt.click();
  const submit = page.getByRole("button", { name: "Submit", exact: true }).first();
  const agree = page.getByRole("button", { name: /^Agree/ }).first();
  for (let answered = 0; answered < 80 && (await submit.isDisabled()); answered += 1) {
    await agree.click();
  }
  await submit.click();
  const card = page.locator('[data-slot="slide-done-card"]');
  await expect(card).toBeVisible();
  await card.getByRole("radio", { name: "4" }).click();
  await expect(card.getByRole("radio", { name: "4" })).toBeChecked();

  expect(await firstReadOf(page)).toEqual(recorded);
});

test("a server error from the first read neither shows the first-read step nor the AI", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith("/first-read") && (init?.method ?? "GET") === "GET")
        return Promise.resolve(
          new Response(
            JSON.stringify({ type: "about:blank", title: "Failed", status: 500, code: "server" }),
            { status: 500, headers: { "content-type": "application/problem+json" } },
          ),
        );
      return real(input, init);
    };
  });
  await page.goto(`/tasks/${rt17}/guided?slide=${a1}`);
  await expect(page.getByTestId("first-read-unavailable")).toBeVisible();
  await expect(page.getByTestId("first-read-panel")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Objects" })).toHaveCount(0);
  await expect(page.locator('main[data-ai="shown"]')).toHaveCount(0);
});

const setsOf = (page: Page, path: string) =>
  page.evaluate(async (url) => {
    const response = await fetch(url);
    const body = (await response.json()) as { name: string }[];
    return body.map((set) => set.name);
  }, path);

for (const [name, extra] of [
  ["full viewer", ""],
  ["paged screen", "&pagedCells=2000"],
] as const) {
  test(`the ${name} of a hide-the-AI task shows the first read notice and its link before the first read`, async ({
    page,
  }) => {
    await page.goto(`/projects/${p07}/slides/${a1}?task=${rt17}${extra}`);
    const notice = page.getByTestId("first-read-notice");
    await expect(notice).toBeVisible({ timeout: 60_000 });
    await expect(notice).toContainText("The AI stays hidden until your first read");
    await expect(page.getByRole("group", { name: "Objects" })).toHaveCount(0);
    const link = page.getByTestId("first-read-link");
    await expect(link).toHaveAttribute("href", new RegExp(`/tasks/${rt17}/guided\\?slide=${a1}`));
    await link.click();
    await expect(page.getByTestId("first-read-panel")).toBeVisible();
  });
}

test("the scene search parameter never skips the first read gate on a hide-the-AI task", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt17}/guided?slide=${a1}&scene=region`);
  await expect(page.locator('main[data-ai="hidden"]')).toBeVisible();
  await expect(page.getByTestId("first-read-panel")).toBeVisible();
  await expect(page.getByRole("group", { name: "Objects" })).toHaveCount(0);
});

test("the slide and project result set lists hide the AI result of an open first read only on the task page", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt17}/guided?slide=${a1}`);
  await expect(page.getByTestId("first-read-panel")).toBeVisible();
  const slideList = `/api/slides/${a1}/result-sets`;
  const projectList = `/api/projects/${p07}/result-sets`;
  expect((await setsOf(page, slideList)).some((name) => name.includes(camName))).toBe(false);
  expect((await setsOf(page, projectList)).some((name) => name.includes(camName))).toBe(false);

  await page.goto(`/projects/${p07}/slides/${a1}`);
  await expect(page.getByRole("main").first()).toBeVisible();
  expect((await setsOf(page, slideList)).some((name) => name.includes(camName))).toBe(true);
  expect((await setsOf(page, projectList)).some((name) => name.includes(camName))).toBe(true);
});
