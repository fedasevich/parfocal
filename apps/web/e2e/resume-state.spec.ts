import { type Browser, type BrowserContext, expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const p07 = "00000000-0000-4000-8003-000000000007";

const stored = (page: Page) => page.evaluate(() => localStorage.getItem("parfocal.fake.resume"));

type Saved = Awaited<ReturnType<BrowserContext["storageState"]>>;

const freshBrowser = (browser: Browser, baseURL: string | undefined, state?: Saved) =>
  browser.newContext({
    ...(baseURL === undefined ? {} : { baseURL }),
    locale: "en-GB",
    timezoneId: "Europe/Prague",
    ...(state === undefined ? {} : { storageState: state }),
  });

test("closing the browser mid-review resumes guided review at the same object", async ({
  browser,
  baseURL,
}) => {
  const before = await freshBrowser(browser, baseURL);
  const page = await before.newPage();
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&object=T2`);
  await expect(page.getByText(/The AI says T2 is/)).toBeVisible();
  await page.getByRole("button", { name: /Skip for now|Next/ }).click();
  await expect(page.getByText(/The AI says T3 is/)).toBeVisible();
  await expect.poll(() => stored(page)).toContain('"object_id":"T3"');
  const state = await before.storageState();
  await before.close();

  const after = await freshBrowser(browser, baseURL, state);
  const again = await after.newPage();
  await again.goto("/");
  await again.getByRole("button", { name: "Continue ↵" }).click();
  await expect(again).toHaveURL(new RegExp(`/tasks/${rt14}/guided\\?.*object=T3`));
  await expect(again.getByText(/The AI says T3 is/)).toBeVisible();
  await after.close();
});

test("a slide left in the full viewer resumes there with its camera", async ({
  browser,
  baseURL,
}) => {
  const before = await freshBrowser(browser, baseURL);
  const page = await before.newPage();
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&x=0.3&y=0.4&z=2`);
  await expect.poll(() => stored(page)).toMatch(/"mode":"viewer".*"camera":\{"x"/);
  const camera = (JSON.parse((await stored(page)) ?? "{}") as { camera: { z: number } }).camera;
  const state = await before.storageState();
  await before.close();

  const after = await freshBrowser(browser, baseURL, state);
  const again = await after.newPage();
  await again.goto("/");
  await again.getByRole("button", { name: "Continue ↵" }).click();
  await expect(again).toHaveURL(new RegExp(`/projects/${p07}/slides/${a1}\\?task=${rt14}`));
  expect(new URL(again.url()).searchParams.get("z")).toBe(String(camera.z));
  await after.close();
});
