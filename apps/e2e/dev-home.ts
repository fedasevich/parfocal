import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";

const gallerySlide = "CMU-1-Small-Region";

type Listed = { readonly id: string; readonly label: string; readonly project: { id: string } };

async function slideToOpen(page: Page): Promise<{ project: string; slide: Listed }> {
  return page.evaluate(async (wanted) => {
    const response = await fetch(`/api/me/slides?q=${encodeURIComponent(wanted)}`);
    if (!response.ok) throw new Error(`/api/me/slides answered ${response.status}`);
    const { slides } = (await response.json()) as { slides: Listed[] };
    const slide = slides.find((each) => each.label.includes(wanted));
    if (slide === undefined) {
      throw new Error(`The test user sees no gallery slide named ${wanted}`);
    }
    return { project: slide.project.id, slide };
  }, gallerySlide);
}

async function readThroughWorker(page: Page): Promise<string> {
  const { slide } = await slideToOpen(page);
  const read = await page.evaluate(async (id) => {
    const access = await fetch(`/api/slides/${id}/tile-access`);
    if (!access.ok) throw new Error(`tile-access answered ${access.status}`);
    const { token, base_path, original } = (await access.json()) as Record<string, string>;
    const response = await fetch(`${base_path}${original}`, {
      headers: { Authorization: `Bearer ${token}`, Range: "bytes=0-1023" },
    });
    return {
      status: response.status,
      cache: response.headers.get("Cache-Control") ?? "",
      resource: response.headers.get("Cross-Origin-Resource-Policy") ?? "",
      bytes: (await response.arrayBuffer()).byteLength,
    };
  }, slide.id);
  if (read.status !== 206 || !read.cache.startsWith("private") || read.resource === "") {
    throw new Error(`The edge Worker did not serve ${slide.label}: ${JSON.stringify(read)}`);
  }
  return `The edge Worker served ${read.bytes} bytes of ${slide.label} from the parfocal-dev bucket`;
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
    console.log(await readThroughWorker(page));
  }
} finally {
  await browser.close();
}
