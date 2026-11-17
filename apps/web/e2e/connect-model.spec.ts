import { expect, type Page, test } from "./a11y.ts";

const badge = (page: Page) => page.getByTestId("fake-data-badge");
const flow = (page: Page) => page.getByTestId("connect-model");

const scenes: { scene: string; shows: string }[] = [
  { scene: "addmodel", shows: "The outlines your server sends back show here" },
  { scene: "addtested", shows: "Follows the contract" },
  { scene: "addfail", shows: "38 cells came back without a" },
  { scene: "addmap", shows: "Who can run it" },
];

test("every Connect a model scene opens on fake data", async ({ page }) => {
  for (const { scene, shows } of scenes) {
    await page.goto(`/admin?scene=${scene}`);
    await expect(flow(page)).toHaveAttribute("data-scene", scene);
    await expect(page.getByRole("heading", { name: "Connect your own model" })).toBeVisible();
    await expect(page.getByText(shows).first()).toBeVisible();
    await expect(badge(page)).toContainText("Fake data");
  }
  await page.goto("/admin?scene=addmodel&modal=contract");
  const contract = page.getByRole("dialog", { name: "The model contract" });
  await expect(contract).toContainText("Every object needs a class and a polygon");
});

test("the prototype index opens the Connect a model scenes", async ({ page }) => {
  await page.goto("/prototype");
  const screens = page.getByRole("list", { name: "Screens" });
  await screens.getByRole("link", { name: "Admin · addfail" }).click();
  await expect(page.getByText("Not Parfocal JSON yet")).toBeVisible();
  await page.goBack();
  await screens.getByRole("link", { name: "Admin · contract" }).click();
  await expect(page.getByRole("dialog", { name: "The model contract" })).toBeVisible();
});

test("a test, then classes and access, adds the model", async ({ page }) => {
  await page.goto("/admin?scene=addmodel");
  const next = page.getByRole("button", { name: "Next: classes and access" });
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: "Read the contract" }).click();
  const contract = page.getByRole("dialog", { name: "The model contract" });
  await expect(contract).toContainText("POST https://ml.cuailab.cz/parfocal/infer");
  await contract.getByRole("button", { name: "Close" }).first().click();
  await expect(contract).toBeHidden();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page).toHaveURL(/scene=addtested/);
  await expect(page.getByText("2 regions, 38 cells")).toBeVisible();
  await page.getByRole("button", { name: "Try another tile" }).click();
  await expect(page.getByText("Tile from a lymph node edge")).toBeVisible();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page).toHaveURL(/scene=addmap/);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Lab HoVer-Net fork");
  await expect(page.getByText("Choose a class for")).toBeVisible();
  await page.getByRole("combobox", { name: "Class for dead" }).click();
  await page.getByRole("option", { name: "Leave out of results" }).click();
  await expect(page.getByText("Every class has a match.")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/scene=addtested/);
  await page.getByRole("button", { name: "Next: classes and access" }).click();
  await expect(page.getByText("Every class has a match.")).toBeVisible();
  await page.getByRole("button", { name: "Add model" }).click();
  await expect(page).toHaveURL(/section=models$/);
  await expect(page.getByText("Lab HoVer-Net fork v2.1 added.")).toBeVisible();
});

test("a failing test can be tested again and Cancel goes back to AI models", async ({ page }) => {
  await page.goto("/admin?scene=addfail");
  await expect(page.getByRole("button", { name: "Next: classes and access" })).toBeDisabled();
  await page.getByRole("button", { name: "Test again" }).click();
  await expect(page).toHaveURL(/scene=addtested/);
  await expect(page.getByText("Follows the contract")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/section=models$/);
  await expect(page.getByRole("heading", { name: "AI models" })).toBeVisible();
});

test("Run a model links to Connect your own model", async ({ page }) => {
  await page.goto("/prototype");
  await page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: /Run a model · menu/ })
    .click();
  await page.getByRole("link", { name: "Connect your own model" }).click();
  await expect(page).toHaveURL(/\/admin\?scene=addmodel/);
  await expect(page.getByRole("heading", { name: "Where it runs" })).toBeVisible();
});

test("a stub server is tested with the typed token and connected with its class map", async ({
  page,
}) => {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/tenant/models")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      sent.push({ url: new URL(request.url()).pathname, body });
    }
  });
  await page.goto("/admin?scene=addmodel");
  await page.getByRole("textbox", { name: "Address" }).fill("https://stub.example.org/infer");
  await page.getByLabel("Token").fill("stub-token-7c41");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page).toHaveURL(/scene=addtested/);
  await expect(page.getByText("Follows the contract")).toBeVisible();
  await page.getByRole("button", { name: "Next: classes and access" }).click();
  await page.getByRole("combobox", { name: "Class for dead" }).click();
  await page.getByRole("option", { name: "Leave out of results" }).click();
  await page.getByRole("button", { name: "Add model" }).click();
  await expect(page.getByText("Lab HoVer-Net fork v2.1 added.")).toBeVisible();
  expect(sent.map((call) => call.url.replace(/^.*\/api\//, "/api/"))).toEqual([
    "/api/tenant/models/test",
    "/api/tenant/models",
  ]);
  expect(sent[0]?.body).toMatchObject({
    address: "https://stub.example.org/infer",
    sign_in: "token",
    secret: "stub-token-7c41",
    tile_size: 512,
    magnification: 40,
  });
  expect(sent[1]?.body).toMatchObject({
    name: "Lab HoVer-Net fork",
    address: "https://stub.example.org/infer",
    secret: "stub-token-7c41",
    taxonomy: "sentinel-node",
  });
  expect(sent[1]?.body["class_map"]).toContainEqual({ sent: "dead", becomes: null });
});

test("a stub server that breaks the contract shows the failed test", async ({ page }) => {
  await page.goto("/admin?scene=addmodel");
  await page.getByRole("textbox", { name: "Address" }).fill("https://broken.example.org/infer");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page).toHaveURL(/scene=addfail/);
  await expect(page.getByText("38 cells came back without a")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next: classes and access" })).toBeDisabled();
});

test("a clinical project asks its owner to confirm that tiles go to the server", async ({
  page,
}) => {
  const connected: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/tenant/models")) {
      connected.push(request.postDataJSON() as Record<string, unknown>);
    }
  });
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== "/api/projects" || (init?.method ?? "GET") !== "GET") return response;
      const listed = (await response.clone().json()) as { name: string; my_role: string }[];
      const owned = listed.map((project) =>
        project.name === "Lymph nodes 2026" ? { ...project, my_role: "owner" } : project,
      );
      return new Response(JSON.stringify(owned), {
        status: response.status,
        headers: response.headers,
      });
    };
  });
  await page.goto("/admin?scene=addmodel");
  await page.getByRole("textbox", { name: "Address" }).fill("https://stub.example.org/infer");
  await page.getByLabel("Token").fill("stub-token-7c41");
  await page.getByRole("button", { name: "Test connection" }).click();
  await page.getByRole("button", { name: "Next: classes and access" }).click();
  await page.getByRole("combobox", { name: "Class for dead" }).click();
  await page.getByRole("option", { name: "Leave out of results" }).click();
  const clinical = page.getByRole("checkbox", { name: /Lymph nodes 2026/ });
  const ask = page.getByRole("dialog", {
    name: "Send tiles of Lymph nodes 2026 to stub.example.org?",
  });
  await clinical.click();
  await expect(ask).toContainText("sends tiles of the project's slides to stub.example.org");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toBeHidden();
  await expect(clinical).not.toBeChecked();
  await clinical.click();
  await ask.getByRole("button", { name: "Send tiles to this server" }).click();
  await expect(clinical).toBeChecked();
  await expect(page.getByText("Tiles go to stub.example.org")).toBeVisible();
  await page.getByRole("button", { name: "Add model" }).click();
  await expect(page.getByText("Lab HoVer-Net fork v2.1 added.")).toBeVisible();
  const [body] = connected;
  const confirmed = body?.["confirmed_project_ids"] as string[];
  expect(confirmed).toHaveLength(1);
  expect(body?.["project_ids"]).toContain(confirmed[0]);
});

test("the owner of a clinical project confirms a lab model an admin added", async ({ page }) => {
  const p03 = "00000000-0000-4000-8003-000000000003";
  await page.goto(`/projects/${p03}?tab=settings&as=SM`);
  const zone = page.getByRole("region", { name: "Lab models" });
  await expect(zone).toContainText("Waiting for the owner");
  await expect(zone.getByRole("button", { name: "Confirm tile sharing" })).toHaveCount(0);
  await page.goto(`/projects/${p03}?tab=settings`);
  await expect(zone).toContainText("It runs here only after you confirm its server.");
  await zone.getByRole("button", { name: "Confirm tile sharing" }).click();
  const ask = page.getByRole("dialog", {
    name: "Send tiles of Lymph nodes 2026 to ml.cuailab.cz?",
  });
  await expect(ask).toContainText("sends tiles of the project's slides to ml.cuailab.cz");
  await ask.getByRole("button", { name: "Send tiles to this server" }).click();
  await expect(ask).toBeHidden();
  await expect(zone).toContainText("Confirmed");
  await expect(
    page.getByText("Lab HoVer-Net fork v2.1 can now run in this project."),
  ).toBeVisible();
});
