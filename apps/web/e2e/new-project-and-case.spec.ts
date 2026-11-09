import type { Page } from "./a11y.ts";
import { expect, test } from "./telemetry-capture.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const created = "00000000-0000-4000-8003-000000000012";

const networkNoise = /^(Failed to load resource|\[MSW\]|ZodError)/;

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !networkNoise.test(message.text())) {
      errors.push(message.text().split("\n")[0] ?? "");
    }
  });
  return errors;
}

test("a clinical project and a case with fake patient fields are created through the fake API", async ({
  page,
}) => {
  const errors = watchErrors(page);
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/(projects|cases)$/.test(request.url())) {
      bodies.push(request.postDataJSON() as Record<string, unknown>);
    }
  });

  await page.goto("/projects/new");
  const drawer = page.getByRole("dialog", { name: "New project" });
  await expect(drawer).toContainText("P12 when created");
  await drawer.getByRole("button", { name: "Create and upload" }).click();
  await expect(drawer).toContainText("Give the project a name.");

  await drawer.getByRole("textbox").fill("Fake study, model B");
  await drawer.getByRole("radio", { name: /^Clinical/ }).click();
  await drawer.getByRole("radio", { name: /^Cell review/ }).click();
  await expect(drawer.getByRole("radio", { name: /^PanNuke/ })).toBeChecked();
  await drawer.getByRole("button", { name: "Create and upload" }).click();

  await expect(page).toHaveURL(new RegExp(`/projects/${created}/upload`));
  await expect(page.getByText("Into Fake study, model B")).toBeVisible();
  expect(bodies[0]).toEqual({
    name: "Fake study, model B",
    privacy_mode: "clinical",
    template: "cell-review",
    taxonomy: "pannuke",
  });

  await page.getByRole("link", { name: "Fake study, model B" }).click();
  await expect(page.getByRole("heading", { name: "Fake study, model B" })).toBeVisible();
  await expect(page.getByTestId("project-page")).toContainText("Clinical");

  await page.getByRole("button", { name: "More project actions" }).click();
  await page.getByRole("menuitem", { name: "New case" }).click();
  const caseDrawer = page.getByRole("dialog", { name: "New case" });
  await expect(caseDrawer.getByTestId("case-patient")).toContainText("This is a clinical project");
  await caseDrawer.getByLabel("Case ID").fill("S26-90001");
  await caseDrawer.getByLabel("Specimen").fill("Fake lymph node, left");
  await caseDrawer.getByLabel("Name").fill("Fake Patient One");
  await caseDrawer.getByLabel("Birth number").fill("FAKE-0001");
  await caseDrawer.getByRole("button", { name: "Create case" }).click();

  await expect(caseDrawer).toBeHidden();
  await expect(page.getByTestId("project-page")).toContainText("1 case");
  await expect(page.getByRole("row", { name: /S26-90001/ })).toContainText(
    /fake lymph node, left/i,
  );
  expect(bodies[1]).toEqual({
    project_id: created,
    label: "S26-90001",
    specimens: [{ letter: "A", type: "Fake lymph node, left" }],
    patient: { name: "Fake Patient One", mrn: "FAKE-0001" },
  });
  expect(errors).toEqual([]);
});

test("a case in a de-identified project is created without patient fields", async ({ page }) => {
  const errors = watchErrors(page);
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/cases")) {
      bodies.push(request.postDataJSON() as Record<string, unknown>);
    }
  });

  await page.goto(`/projects/${p07}/cases/new`);
  const drawer = page.getByRole("dialog", { name: "New case" });
  await expect(drawer.getByTestId("case-patient")).toContainText("Off in a de-identified project");
  await expect(drawer.getByTestId("case-patient").getByRole("textbox")).toHaveCount(0);
  await drawer.getByRole("button", { name: "Create case" }).click();
  await expect(drawer).toContainText("Give the case an ID.");

  await drawer.getByLabel("Case ID").fill("S26-04812");
  await drawer.getByRole("button", { name: "Create case" }).click();
  await expect(drawer.getByRole("alert")).toContainText("A case with this ID already exists");

  await drawer.getByLabel("Case ID").fill("S26-90002");
  await drawer.getByRole("button", { name: "Create case" }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("row", { name: /S26-90002/ })).toBeVisible();
  expect(bodies.at(-1)).toEqual({ project_id: p07, label: "S26-90002", specimens: [] });
  expect(errors).toEqual([]);
});
