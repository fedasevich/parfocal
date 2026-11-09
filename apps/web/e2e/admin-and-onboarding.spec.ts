import { expect, type Page, test } from "@playwright/test";

const badge = (page: Page) => page.getByTestId("fake-data-badge");

const scenes: { path: string; heading: string; shows: string }[] = [
  { path: "/sign-in", heading: "Sign in to Parfocal", shows: "After you sign in:" },
  { path: "/sign-in?scene=magic", heading: "Check your email", shows: "Resend in 0:" },
  {
    path: "/sign-in?scene=sso",
    heading: "Continue with your institution",
    shows: "Matches your email",
  },
  { path: "/sign-in?scene=forgot", heading: "Reset your password", shows: "Send reset link" },
  {
    path: "/sign-in?scene=reset",
    heading: "Choose a new password",
    shows: "Not found in known leaks",
  },
  {
    path: "/sign-in?scene=passkey",
    heading: "Sign in to Parfocal",
    shows: "Use your passkey for parfocal.eu",
  },
  {
    path: "/sign-in?scene=passkeyqr",
    heading: "Sign in to Parfocal",
    shows: "Waiting for your phone or key",
  },
  { path: "/sign-in?scene=lock", heading: "", shows: "Locked after 15 minutes without input" },
  { path: "/sign-in?scene=lockkey", heading: "", shows: "Use your passkey for parfocal.eu" },
  {
    path: "/sign-in?scene=expired",
    heading: "Sign in to Parfocal",
    shows: "Your session ended after 8 hours",
  },
  {
    path: "/sign-in?scene=noaccess",
    heading: "No access to Lymph nodes 2026",
    shows: "Ask Lenka Malá, its owner",
  },
  { path: "/sign-up", heading: "Create your Parfocal account", shows: "Review AI results" },
  { path: "/sign-up?scene=verify", heading: "Confirm your email", shows: "Resend the code" },
  { path: "/invite", heading: "You're invited", shows: "Round 2 · CAMELYON v1.0" },
  {
    path: "/invite?scene=account",
    heading: "Join Sentinel node AI evaluation",
    shows: "from the invite",
  },
  { path: "/setup", heading: "What do you do in Parfocal?", shows: "Specialties" },
  { path: "/setup?step=workspace", heading: "Your workspace", shows: "You join at once" },
  { path: "/setup?step=project", heading: "Start with a project", shows: "Recommended" },
  {
    path: "/setup?step=device",
    heading: "How do you move around a slide?",
    shows: "Viewer you are used to",
  },
  { path: "/setup?step=done", heading: "You're set, Lenka", shows: "Account and email confirmed" },
  { path: "/admin", heading: "Overview", shows: "3 invites waiting" },
  {
    path: "/admin?scene=people",
    heading: "People and roles",
    shows: "What each role is responsible for",
  },
  { path: "/admin?scene=projects", heading: "Projects", shows: "Who can create one" },
  { path: "/admin?scene=models", heading: "AI models", shows: "Running now" },
  { path: "/admin?scene=templates", heading: "Report templates", shows: "Study templates" },
  { path: "/admin?scene=storage", heading: "Storage and sources", shows: "Rules for sources" },
  { path: "/admin?scene=api", heading: "API and webhooks", shows: "pf_live_…3f9a" },
  {
    path: "/admin?scene=audit",
    heading: "Audit log",
    shows: "Rejected a call with a bad signature",
  },
  { path: "/admin?scene=security", heading: "Security", shows: "Lock after inactivity" },
  { path: "/admin?scene=settings", heading: "Workspace settings", shows: "Lock times" },
  { path: "/admin?scene=tplnew", heading: "", shows: "Opens in the editor." },
  { path: "/admin?scene=tpledit", heading: "CAMELYON rounds", shows: "Back to the library" },
  { path: "/admin?scene=addmodel", heading: "Connect your own model", shows: "Test connection" },
];

for (const { path, heading, shows } of scenes) {
  test(`${path} opens on fake data`, async ({ page }) => {
    await page.goto(path);
    if (heading) {
      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText(shows).first()).toBeVisible();
    await expect(badge(page)).toContainText("Fake data");
  });
}

test("sign-in moves between its scenes and lands on the deep link", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/scene=forgot/);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await page.goto("/sign-in?scene=passkey");
  await page.getByRole("button", { name: "Use a phone or security key" }).click();
  await expect(
    page.getByRole("img", { name: "QR code for signing in with a phone" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "The phone answered" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/slides\/[0-9a-f-]+\?task=/);
});

test("the lock unlocks to the same slide and no access asks the owner", async ({ page }) => {
  await page.goto("/sign-in?scene=lock");
  await page.getByRole("button", { name: "Unlock with a passkey" }).click();
  await expect(page).toHaveURL(/scene=lockkey/);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/slides\//);
  await page.goto("/sign-in?scene=noaccess");
  await expect(badge(page)).toContainText("viewing as Anna Kopecká");
  await page.getByRole("button", { name: "Ask for access" }).click();
  await expect(page.getByText("Asked Lenka Malá to add you to Lymph nodes 2026")).toBeVisible();
  await expect(page.getByRole("button", { name: /Asked, 11:02/ })).toBeDisabled();
});

test("the invite joins in one step and opens the first slide", async ({ page }) => {
  await page.goto("/invitations/rt14-simona");
  await expect(page).toHaveURL(/\/invite\?token=rt14-simona$/);
  await expect(page.getByText("12 slides, about 3 hours")).toBeVisible();
  await expect(page.getByText("This project is de-identified")).toBeVisible();
  await page.getByRole("button", { name: "Accept and create my account" }).click();
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue("simona@fnvltava.example");
  await page.getByRole("button", { name: "Join and open my first slide" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/slides\/[0-9a-f-]+\?task=/);
});

test("an invite link that does not work says so and offers sign in", async ({ page }) => {
  await page.goto("/invite?token=gone-token");
  await expect(page.getByRole("heading", { name: "This invite link does not work" })).toBeVisible();
  await page.getByRole("button", { name: "Go to sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});

const startSetup = async (page: Page) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Good afternoon, Lenka" })).toBeVisible();
  await page.evaluate(() => window.history.pushState(null, "", "/setup"));
};

const reachFirstProject = async (page: Page, role: RegExp) => {
  await startSetup(page);
  await page.getByRole("radio", { name: role }).click();
  await page.getByRole("button", { name: "Next: Workspace" }).click();
  await page.getByRole("button", { name: "Next: First project" }).click();
};

test("setup carries the role into the first project and ends in the sample project", async ({
  page,
}) => {
  await startSetup(page);
  await page.getByRole("radio", { name: /Researcher/ }).click();
  await expect(page.getByText("Home opens on your projects")).toBeVisible();
  await page.getByRole("button", { name: "Next: Workspace" }).click();
  await page.getByRole("radio", { name: /Create a new workspace/ }).click();
  await expect(page.getByText("gives you admin rights on it as a researcher")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create it and continue" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Name" }).fill("Brno AI group");
  await page.getByRole("button", { name: "Create it and continue" }).click();
  const create = page.getByRole("radio", { name: /Create a project/ });
  await expect(create).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: /Open the sample project/ }).click();
  await page.getByRole("button", { name: "Skip this step" }).click();
  await page.getByRole("button", { name: "Next: Done" }).click();
  await expect(page.getByText("Created Brno AI group")).toBeVisible();
  await expect(page.getByText("Upload slides and their AI results")).toBeVisible();
  await page.getByRole("button", { name: "Open the sample project", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/00000000-0000-4000-8003-000000000001(\?|$)/);
});

test("setup saves the specialties and joins the workspace that matches the email", async ({
  page,
}) => {
  const saved: unknown[] = [];
  const joined: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().endsWith("/api/me")) {
      saved.push(request.postDataJSON());
    }
    if (request.method() === "POST" && request.url().includes("/api/me/joinable-workspaces/")) {
      joined.push(new URL(request.url()).pathname.split("/").at(-1) ?? "");
    }
  });
  await startSetup(page);
  await page.getByRole("button", { name: "+ Other" }).click();
  await page.getByRole("textbox", { name: "Another specialty" }).fill("Neuropathology");
  await page.getByRole("button", { name: "Next: Workspace" }).click();
  await expect(page.getByText("You join at once")).toBeVisible();
  await page.getByRole("button", { name: "Next: First project" }).click();
  await expect(page.getByRole("heading", { name: "Start with a project" })).toBeVisible();
  expect(saved).toContainEqual(
    expect.objectContaining({ specialties: ["Breast", "Lymph nodes", "Neuropathology"] }),
  );
  expect(joined).toEqual(["membership"]);
  await page.getByRole("button", { name: "Next: Viewer" }).click();
  await page.getByRole("button", { name: "Next: Done" }).click();
  await expect(page.getByText("Joined Fakultní nemocnice Vltava")).toBeVisible();
});

test("setup asks to join a workspace that needs an admin to say yes", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/me/joinable-workspaces/")) {
      asked.push(new URL(request.url()).pathname.split("/").at(-1) ?? "");
    }
  });
  await startSetup(page);
  await page.getByRole("button", { name: "Next: Workspace" }).click();
  await page.getByRole("radio", { name: /Charles University AI Lab/ }).click();
  await page.getByRole("button", { name: "Send the request and continue" }).click();
  await expect(page.getByRole("heading", { name: "Start with a project" })).toBeVisible();
  expect(asked).toEqual(["access-requests"]);
  await page.getByRole("button", { name: "Next: Viewer" }).click();
  await page.getByRole("button", { name: "Next: Done" }).click();
  await expect(page.getByText("Asked to join Charles University AI Lab")).toBeVisible();
});

test("setup ends on the new project form when you choose to create a project", async ({ page }) => {
  await reachFirstProject(page, /Researcher/);
  await expect(page.getByRole("radio", { name: /Create a project/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("button", { name: "Next: Viewer" }).click();
  await page.getByRole("button", { name: "Next: Done" }).click();
  await page.getByRole("button", { name: "Create my first project" }).click();
  await expect(page).toHaveURL(/\/projects\/new$/);
});

test("setup ends on the home when you choose to wait for an invite", async ({ page }) => {
  await reachFirstProject(page, /Reviewer/);
  await expect(page.getByRole("radio", { name: /Open the sample project/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("radio", { name: /Wait for an invite/ }).click();
  await page.getByRole("button", { name: "Next: Viewer" }).click();
  await page.getByRole("radio", { name: "Trackpad" }).click();
  await page.getByRole("button", { name: "Next: Done" }).click();
  await page.getByRole("button", { name: "Go to my home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Good afternoon, Lenka" })).toBeVisible();
});

test("admin is Daniel's, with its own sections and the app's top bar", async ({ page }) => {
  await page.goto("/admin");
  await expect(badge(page)).toContainText("viewing as Daniel Hruška");
  const nav = page.getByRole("navigation", { name: "Admin sections" });
  await expect(nav.getByRole("link")).toHaveCount(11);
  await nav.getByRole("link", { name: "People and roles" }).click();
  await expect(page).toHaveURL(/section=people/);
  await expect(page.getByRole("row", { name: /ondrej@fnvltava.example/ })).toContainText(
    "Invite sent",
  );
  await expect(page.getByRole("row", { name: /simona@fnvltava.example/ })).toContainText("Active");
  await expect(page.getByRole("switch", { name: "Admin rights for Simona Marková" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("switch", { name: "Admin rights for Daniel Hruška" })).toBeDisabled();
  await page.getByRole("combobox", { name: "Role of Tomáš Beneš" }).click();
  await page.getByRole("option", { name: "Researcher" }).click();
  await expect(page.getByText("Tomáš Beneš is a researcher now.")).toBeVisible();
  const tomas = page.getByRole("switch", { name: "Admin rights for Tomáš Beneš" });
  await expect(tomas).not.toBeChecked();
  await tomas.click();
  await expect(page.getByText("Tomáš Beneš has admin rights now")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Admin rights for Daniel Hruška" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(tomas).not.toBeChecked();
  await nav.getByRole("link", { name: "Back to Parfocal" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("Invite people sends an invite that shows in the list", async ({ page }) => {
  await page.goto("/admin?section=people");
  await page.getByRole("button", { name: "Invite people" }).click();
  const modal = page.getByRole("dialog", { name: "Invite people" });
  await modal.getByRole("button", { name: "Send invite" }).click();
  await expect(modal.getByText("Enter an email address.").first()).toBeVisible();
  await modal.getByRole("textbox", { name: "Email" }).fill("Petr@Lab.example");
  await modal.getByRole("radio", { name: "Researcher" }).click();
  await modal.getByRole("switch").click();
  await modal.getByRole("button", { name: "Send invite" }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("row", { name: /petr@lab.example/ })).toContainText("Invite sent");
  await expect(page.getByText("4 invites waiting")).toBeVisible();
});

test("Resend sends a pending invite again and keeps one row for it", async ({ page }) => {
  await page.goto("/admin?section=people");
  const row = page.getByRole("row", { name: /karel@cuailab.example/ });
  await expect(row).toContainText("Invite sent");
  await row.getByRole("button", { name: "Resend the invite to karel@cuailab.example" }).click();
  await expect(
    page.getByText("Invite sent again to karel@cuailab.example. The earlier link no longer works."),
  ).toBeVisible();
  await expect(page.getByRole("row", { name: /karel@cuailab.example/ })).toHaveCount(1);
  await expect(page.getByText("3 invites waiting")).toBeVisible();
});

test("role changes, admin rights and resends are audited", async ({ page }) => {
  await page.goto("/admin?section=people");
  const daniel = page.getByRole("switch", { name: "Admin rights for Daniel Hruška" });
  await expect(daniel).toBeDisabled();
  await page.getByRole("combobox", { name: "Role of Tomáš Beneš" }).click();
  await page.getByRole("option", { name: "Researcher" }).click();
  await expect(page.getByText("Tomáš Beneš is a researcher now.")).toBeVisible();
  const tomas = page.getByRole("switch", { name: "Admin rights for Tomáš Beneš" });
  await tomas.click();
  await expect(tomas).toBeChecked();
  await expect(daniel).toBeEnabled();
  await tomas.click();
  await expect(page.getByText("Tomáš Beneš no longer has admin rights")).toBeVisible();
  await expect(tomas).not.toBeChecked();
  await expect(daniel).toBeDisabled();
  await page
    .getByRole("row", { name: /karel@cuailab.example/ })
    .getByRole("button", { name: "Resend the invite to karel@cuailab.example" })
    .click();
  await expect(page.getByText("Invite sent again to karel@cuailab.example")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Admin sections" })
    .getByRole("link", { name: "Audit log" })
    .click();
  const log = page.getByRole("table");
  await expect(log.getByRole("row", { name: /Changed a role/ })).toHaveCount(1);
  await expect(log.getByRole("row", { name: /Gave admin rights/ })).toHaveCount(1);
  await expect(log.getByRole("row", { name: /Removed admin rights/ })).toHaveCount(1);
  await expect(log.getByRole("row", { name: /Sent an invitation again/ })).toHaveCount(1);
});

test("a new template opens in the editor and blocks are added by click", async ({ page }) => {
  await page.goto("/admin?section=templates");
  await expect(page.getByRole("row", { name: /Sentinel node AI evaluation/ })).toContainText(
    "Headline numbers",
  );
  await page.getByRole("button", { name: "New template" }).click();
  const modal = page.getByRole("dialog", { name: "New study template" });
  await modal.getByRole("textbox", { name: "Name" }).fill("Lymph node detection");
  await modal.getByRole("button", { name: "Create and open" }).click();
  await expect(page).toHaveURL(/scene=tpledit/);
  await expect(page.getByRole("heading", { name: "Lymph node detection" })).toBeVisible();
  await page
    .getByLabel("Block catalogue")
    .getByRole("button", { name: /Headline numbers/ })
    .click();
  await expect(
    page.getByRole("button", { name: /Headline numbers The metrics you pick/ }).last(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to the library" }).click();
  await expect(page).toHaveURL(/section=templates$/);
});

test("the template editor sets the decision question and Counts as", async ({ page }) => {
  await page.goto("/admin?scene=tpledit");
  await page.getByRole("tab", { name: "Task presets" }).click();
  const group = page.getByRole("radiogroup", { name: "Decision question" });
  await group.getByRole("radio", { name: /5-point certainty/ }).click();
  await expect(
    page.getByText("4 and 5 count as agree with the AI, 3 as not sure, and 1 and 2 as disagree."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Raise Agree starts at" }).click();
  await expect(
    page.getByText("5 counts as agree with the AI, 3 and 4 as not sure, and 1 and 2 as disagree."),
  ).toBeVisible();
  await group.getByRole("radio", { name: /Pick the class blind/ }).click();
  await expect(
    page.getByText("The same class as the AI's counts as agree, another class as disagree."),
  ).toBeVisible();
});

test("Connect your own model opens the flow page from AI models", async ({ page }) => {
  await page.goto("/admin?section=models");
  await page.getByRole("button", { name: "Connect your own model" }).click();
  await expect(page).toHaveURL(/scene=addmodel/);
  await expect(page.getByRole("heading", { name: "Where it runs" })).toBeVisible();
});

test("the workspace settings console saves lock times, defaults, tiers and announcements", async ({
  page,
}) => {
  await page.goto("/admin?section=settings");
  await expect(page.getByRole("combobox", { name: "Lock after inactivity" })).toContainText(
    "15 minutes",
  );
  await page.getByRole("combobox", { name: "Lock after inactivity" }).click();
  await page.getByRole("option", { name: "30 minutes" }).click();
  await expect(page.getByText("Screens lock after 30 minutes without activity.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Lock after inactivity" })).toContainText(
    "30 minutes",
  );

  await page.getByRole("radio", { name: "Clinical" }).click();
  await expect(page.getByText("New projects start clinical.")).toBeVisible();
  await page.getByRole("combobox", { name: "Classes of new projects" }).click();
  await page.getByRole("option", { name: "PanNuke" }).click();
  await expect(page.getByRole("combobox", { name: "Classes of new projects" })).toContainText(
    "PanNuke",
  );
  await page.getByRole("combobox", { name: "Study template of new tasks" }).click();
  await page.getByRole("option").nth(1).click();
  await expect(page.getByText("New review tasks start from that template.")).toBeVisible();

  const tumorGood = page.getByRole("combobox", { name: "Tumor regions, Good" });
  await tumorGood.click();
  await page.getByRole("option", { name: "CAMELYON tumor model" }).click();
  await expect(tumorGood).toContainText("CAMELYON tumor model · v1.0");

  await page.getByRole("textbox", { name: "Announcement text" }).fill("Rounds move to 09:00");
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByText("Rounds move to 09:00").first()).toBeVisible();
  await page.getByRole("button", { name: "End: Rounds move to 09:00" }).click();
  await expect(page.getByRole("button", { name: "End: Rounds move to 09:00" })).toHaveCount(0);
});

test("the security contact is changed, removed and restored from workspace settings", async ({
  page,
}) => {
  await page.goto("/admin?section=settings");
  const contact = page.getByRole("textbox", { name: "Security contact" });
  const save = page.getByRole("button", { name: "Save" });
  await expect(contact).toHaveValue("security@lab.example");
  await expect(save).toBeDisabled();
  await contact.fill("not an address");
  await expect(save).toBeDisabled();
  await contact.fill(" Breach@Hospital.Example ");
  await save.click();
  await expect(
    page.getByText("Security incidents are reported to breach@hospital.example."),
  ).toBeVisible();
  await expect(contact).toHaveValue("breach@hospital.example");
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Security contact removed.")).toBeVisible();
  await expect(contact).toHaveValue("");
  await expect(page.getByText("Needed before any project holds clinical data.")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(contact).toHaveValue("breach@hospital.example");
});
