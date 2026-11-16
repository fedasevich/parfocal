import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";

const sampleSlide = "test_065";
const galleryTour = "Format gallery tour";

type Listed = { readonly id: string; readonly label: string; readonly project: { id: string } };
type Tour = { readonly slide: string; readonly project: string; readonly task: string };

async function tourToOpen(page: Page): Promise<Tour> {
  return page.evaluate(
    async ({ wanted, tour }) => {
      const found = await fetch(`/api/me/slides?q=${encodeURIComponent(wanted)}`);
      if (!found.ok) throw new Error(`/api/me/slides answered ${found.status}`);
      const { slides } = (await found.json()) as { slides: Listed[] };
      const slide = slides.find((each) => each.label === wanted);
      if (slide === undefined) throw new Error(`The test user sees no slide named ${wanted}`);
      const listed = await fetch(`/api/projects/${slide.project.id}/review-tasks`);
      if (!listed.ok) throw new Error(`review-tasks answered ${listed.status}`);
      const tasks = (await listed.json()) as { id: string; name: string }[];
      const task = tasks.find((each) => each.name === tour);
      if (task === undefined) throw new Error(`The gallery has no task named ${tour}`);
      return { slide: slide.id, project: slide.project.id, task: task.id };
    },
    { wanted: sampleSlide, tour: galleryTour },
  );
}

async function drawThroughWorker(page: Page): Promise<string> {
  const tour = await tourToOpen(page);
  const served: number[] = [];
  page.on("response", (response) => {
    if (response.url().includes(`/tiles/${tour.slide}/original`)) served.push(response.status());
  });
  const path = `/projects/${tour.project}/slides/${tour.slide}/live?task=${tour.task}`;
  await page.goto(path);
  const stage = page.getByTestId("slide-stage");
  await stage.waitFor({ timeout: 60_000 });
  await page
    .locator('[data-testid="slide-stage"][data-state="ready"]')
    .waitFor({ timeout: 90_000 });
  const ranged = served.filter((status) => status === 206).length;
  if (ranged === 0) {
    throw new Error(
      `The viewer drew ${sampleSlide} without the edge Worker: ${JSON.stringify(served)}`,
    );
  }
  const fitted = await stage.getAttribute("data-fitted-ms");
  return `The viewer drew ${sampleSlide} from the parfocal-dev bucket in ${fitted} ms after ${ranged} ranged reads through the edge Worker at ${page.url()}`;
}

const root = fileURLToPath(new URL("../..", import.meta.url));
process.loadEnvFile(`${root}.zitadel/e2e.env`);

const origin = `http://localhost:${process.env["PARFOCAL_WEB_PORT"] ?? "5173"}`;
const username = String(process.env["ZITADEL_TEST_USERNAME"]);
const password = readFileSync(`${root}.zitadel/test-password`, "utf8").trim();

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ baseURL: origin });
  await page.goto("/sign-in?return_to=/");
  await page.getByLabel("Work email").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 60_000 });
  await page.getByText("Start something", { exact: true }).waitFor({ timeout: 60_000 });
  if (await page.getByLabel("No workspace yet").isVisible()) {
    throw new Error("The home screen shows no workspace, so the seed did not reach the test user");
  }
  const session = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session");
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  });
  if (session.status !== 200) {
    throw new Error(`The session endpoint answered ${session.status}`);
  }
  const heading = await page.getByRole("heading", { level: 1 }).first().textContent();
  console.log(
    `Signed in as ${String(session.body["email"])} on ${page.url()}, heading "${heading}"`,
  );
  if (process.env["PARFOCAL_EDGE_DEV"] !== "off") {
    console.log(await drawThroughWorker(page));
  }
} finally {
  await browser.close();
}
