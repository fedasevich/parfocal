import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, type PreviewServer, preview } from "vite";
import { expect, test } from "./a11y.ts";

const firstPort = Number(process.env["PARFOCAL_E2E_PORT"] ?? 5183) + 2;
let origin = "";

let outDir = "";
let server: PreviewServer | undefined;

const deployedBuildEnv: Record<string, string | undefined> = {
  PARFOCAL_PUBLIC_APP_ENV: "prod",
  PARFOCAL_PUBLIC_FAKE_API: undefined,
  PARFOCAL_PUBLIC_DEV_TOOLS: undefined,
};
const runnerEnv = Object.fromEntries(
  Object.keys(deployedBuildEnv).map((key) => [key, process.env[key]]),
);

function useEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const developerPages = [
  "/prototype",
  "/flow-map",
  "/flow-map/walkthrough",
  "/spikes/hotkeys",
  "/spikes/input-traces",
  "/spikes/worklist",
  "/issue-states",
  "/issue-pages/not-found",
];

test.beforeAll(async () => {
  test.setTimeout(240_000);
  outDir = mkdtempSync(join(tmpdir(), "parfocal-production-scenes-"));
  useEnv(deployedBuildEnv);
  await build({ logLevel: "silent", build: { outDir, emptyOutDir: true } });
  server = await preview({
    logLevel: "silent",
    build: { outDir },
    preview: { port: firstPort, strictPort: false, host: "127.0.0.1" },
  });
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") throw new Error("The preview has no port");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  useEnv(runnerEnv);
  await server?.close();
  if (outDir !== "") rmSync(outDir, { recursive: true, force: true });
});

test("the deployed build shows the real sign-in for a prototype scene", async ({ page }) => {
  await page.route(`${origin}/api/**`, (route) =>
    new URL(route.request().url()).pathname === "/api/auth/password-sign-in"
      ? route.fulfill({ json: { available: true } })
      : route.fulfill({ status: 401, json: { detail: "Not signed in" } }),
  );
  await page.goto(`${origin}/sign-in?scene=noaccess`);
  await expect(page.getByRole("heading", { name: "Sign in to Parfocal" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Work email" })).toBeVisible();
  await expect(page.getByTestId("issue-no-access")).toHaveCount(0);
});

const signedIn = {
  user_id: "u-1",
  display_name: "Test Person",
  initials: "TP",
  avatar_colour: 0,
  title: null,
  email: "test@parfocal.test",
  specialties: [],
  active_tenant_id: null,
  workspaces: [],
};

test("the deployed build opens the live upload for an upload scene", async ({ page }) => {
  await page.route(`${origin}/api/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") return route.fulfill({ json: signedIn });
    if (path === "/api/projects/p-1") return new Promise<void>(() => undefined);
    return route.fulfill({ status: 404, json: { detail: "Not here" } });
  });
  await page.goto(`${origin}/projects/p-1/upload?scene=allgood`);
  await expect(page.getByRole("status").filter({ hasText: "Loading the upload" })).toBeVisible();
  await expect(page.getByText("Mock only")).toHaveCount(0);
  await expect(page.getByText("Jump to the end")).toHaveCount(0);
});

test("the deployed build reaches none of the mock routes", async ({ page }) => {
  await page.route(`${origin}/api/**`, (route) =>
    new URL(route.request().url()).pathname === "/api/me"
      ? route.fulfill({ json: signedIn })
      : route.fulfill({ status: 404, json: { detail: "Not here" } }),
  );
  for (const path of developerPages) {
    await page.goto(`${origin}${path}`);
    await expect(page.getByTestId("issue-not-found"), path).toBeVisible();
  }
});

test("the fake API build still runs the same scene", async ({ page }) => {
  await page.goto("/sign-in?scene=noaccess");
  await expect(page.getByTestId("issue-no-access")).toBeVisible();
});
