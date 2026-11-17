import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, type PreviewServer, preview } from "vite";
import { expect, test } from "./a11y.ts";

const port = Number(process.env["PARFOCAL_E2E_PORT"] ?? 5183) + 2;
const origin = `http://127.0.0.1:${port}`;

let outDir = "";
let server: PreviewServer | undefined;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  outDir = mkdtempSync(join(tmpdir(), "parfocal-production-scenes-"));
  process.env["PARFOCAL_PUBLIC_APP_ENV"] = "dev";
  process.env["PARFOCAL_PUBLIC_FAKE_API"] = "off";
  process.env["PARFOCAL_PUBLIC_DEV_TOOLS"] = "off";
  await build({ logLevel: "silent", build: { outDir, emptyOutDir: true } });
  server = await preview({
    logLevel: "silent",
    build: { outDir },
    preview: { port, strictPort: true, host: "127.0.0.1" },
  });
});

test.afterAll(async () => {
  delete process.env["PARFOCAL_PUBLIC_FAKE_API"];
  delete process.env["PARFOCAL_PUBLIC_DEV_TOOLS"];
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

test("the deployed build opens the live upload for an upload scene", async ({ page }) => {
  await page.route(`${origin}/api/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") {
      return route.fulfill({
        json: {
          user_id: "u-1",
          display_name: "Test Person",
          initials: "TP",
          avatar_colour: 0,
          title: null,
          email: "test@parfocal.test",
          specialties: [],
          active_tenant_id: null,
          workspaces: [],
        },
      });
    }
    if (path === "/api/projects/p-1") return new Promise<void>(() => undefined);
    return route.fulfill({ status: 404, json: { detail: "Not here" } });
  });
  await page.goto(`${origin}/projects/p-1/upload?scene=allgood`);
  await expect(page.getByRole("status").filter({ hasText: "Loading the upload" })).toBeVisible();
  await expect(page.getByText("Mock only")).toHaveCount(0);
  await expect(page.getByText("Jump to the end")).toHaveCount(0);
});

test("the fake API build still runs the same scene", async ({ page }) => {
  await page.goto("/sign-in?scene=noaccess");
  await expect(page.getByTestId("issue-no-access")).toBeVisible();
});
