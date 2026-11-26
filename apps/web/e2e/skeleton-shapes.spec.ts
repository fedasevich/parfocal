import type { Page } from "./a11y.ts";
import { holdApi, releaseApi } from "./hold-api.ts";
import { expect, test } from "./telemetry-capture.ts";

const p03 = "00000000-0000-4000-8003-000000000003";
const p07 = "00000000-0000-4000-8003-000000000007";
const sentinelCase = "00000000-0000-4000-8004-000000000006";

type Edge = "left" | "top" | "width" | "height";
type Box = Record<Edge, number>;
type Part = {
  name: string;
  skeleton: string;
  loaded: string;
  edges: Edge[];
  tolerance?: number;
};
type Shape = {
  name: string;
  path: string;
  hold?: string;
  waiting: string;
  settled: string;
  parts: Part[];
};

const flowHeader = (name: string, tolerance = 1): Part => ({
  name,
  skeleton: '[data-slot="flow-page-skeleton"] > header',
  loaded: '[data-slot="flow-page"] > header',
  edges: ["left", "top", "width", "height"],
  tolerance,
});

const flowDock: Part = {
  name: "bar dock",
  skeleton: '[data-slot="flow-page-skeleton"] [data-slot="flow-bar-dock"]',
  loaded: '[data-slot="flow-page"] [data-slot="flow-bar-dock"]',
  edges: ["left", "top", "width", "height"],
};

const firstZone: Part = {
  name: "first block",
  skeleton: '[data-slot="flow-page-skeleton"] [data-slot="flow-main"] > :first-child',
  loaded: '[data-slot="flow-page"] [data-slot="flow-main"] > :first-child',
  edges: ["left", "top", "width"],
};

const firstZoneOfMain = (loadedFirst: string, edges: Edge[] = ["left", "width"]): Part => ({
  name: "first zone",
  skeleton: '[data-slot="skeleton-zone"]',
  loaded: loadedFirst,
  edges,
});

const formZone = (heading: string, loading: string): Part => ({
  name: `the ${heading} zone`,
  skeleton: `[data-slot="skeleton-form-zone"]:has(.sr-only:text-is("${loading}"))`,
  loaded: `[data-slot="zone"]:has(h3:text-is("${heading}"))`,
  edges: ["left", "top", "width"],
});

const shapes: Shape[] = [
  {
    name: "the clinical report page",
    path: `/projects/${p03}/cases/${sentinelCase}/report?scene=signed`,
    hold: "/clinical-report",
    waiting: '[data-slot="flow-page-skeleton"]',
    settled: '[data-testid="clinical-report"]',
    parts: [
      flowHeader("header"),
      {
        name: "sign-out banner",
        skeleton: '[data-slot="skeleton-banner"]',
        loaded: '[data-slot="flow-main"] > [data-slot="zone"]',
        edges: ["left", "top", "width", "height"],
      },
      {
        name: "report sheet",
        skeleton: '[data-slot="skeleton-sheet"]',
        loaded: '[data-slot="report-document"]',
        edges: ["left", "top", "width"],
      },
      flowDock,
    ],
  },
  {
    name: "the co-sign page",
    path: `/projects/${p03}/cases/${sentinelCase}/co-sign?scene=review`,
    hold: "/clinical-report",
    waiting: '[data-slot="flow-page-skeleton"]',
    settled: '[data-testid="co-sign"]',
    parts: [flowHeader("header"), firstZone, flowDock],
  },
  {
    name: "the new review task form",
    path: `/projects/${p07}/tasks/new?scene=slides`,
    waiting: '[data-slot="flow-page-skeleton"]',
    settled: '[data-testid="new-task"]',
    parts: [flowHeader("header"), firstZone, flowDock],
  },
  {
    name: "the upload page",
    path: `/projects/${p07}/upload`,
    waiting: '[data-slot="flow-page-skeleton"]',
    settled: '[data-testid="upload-page"] [data-slot="flow-page"]',
    parts: [flowHeader("header"), firstZone, { ...flowDock, edges: ["left", "width", "height"] }],
  },
  {
    name: "the admin overview",
    path: "/admin",
    hold: "/api/tenant/overview",
    waiting: '[data-slot="skeleton-zones"]',
    settled: '[data-slot="stat-strip"]',
    parts: [
      {
        name: "stat strip",
        skeleton: '[data-slot="skeleton-stat-strip"]',
        loaded: '[data-slot="stat-strip"]',
        edges: ["left", "top", "width", "height"],
        tolerance: 8,
      },
      firstZoneOfMain("main [data-slot='zone']"),
    ],
  },
  {
    name: "the admin storage section",
    path: "/admin?section=storage",
    hold: "/api/tenant/storage",
    waiting: '[data-slot="skeleton-zones"]',
    settled: '[data-slot="zone"]:has(h3:text-is("Space"))',
    parts: [firstZoneOfMain("main [data-slot='zone']", ["left", "top", "width"])],
  },
  {
    name: "the retention form",
    path: "/admin?section=storage",
    hold: "/api/tenant/retention",
    waiting: '[data-slot="skeleton-form-zone"]',
    settled: '[data-slot="zone"]:has(h3:text-is("Retention"))',
    parts: [formZone("Retention", "Loading retention")],
  },
  {
    name: "the logo and joining form",
    path: "/admin?section=settings",
    hold: "/api/tenant/join-settings",
    waiting: '[data-slot="skeleton-form-zone"]',
    settled: '[data-slot="zone"]:has(h3:text-is("Logo and joining"))',
    parts: [formZone("Logo and joining", "Loading join settings")],
  },
  {
    name: "the security contact form",
    path: "/admin?section=settings",
    hold: "/api/tenant/security-contact",
    waiting: '[data-slot="skeleton-form-zone"]',
    settled: '[data-slot="zone"]:has(h3:text-is("Security contact"))',
    parts: [formZone("Security contact", "Loading the security contact")],
  },
  {
    name: "the admin models section",
    path: "/admin?section=models",
    hold: "/api/tenant/models",
    waiting: '[data-slot="skeleton-zones"]',
    settled: '[data-slot="zone"]:has(h3:text-is("Parfocal models"))',
    parts: [firstZoneOfMain("main [data-slot='zone']", ["left", "top", "width"])],
  },
  {
    name: "the team page",
    path: "/team",
    waiting: '[data-slot="skeleton-zones"]',
    settled: '[data-slot="task-block"]',
    parts: [
      {
        name: "tabs",
        skeleton: 'main [data-slot="tabs-list"]',
        loaded: 'main [data-slot="tabs-list"]',
        edges: ["left", "top", "width", "height"],
      },
      firstZoneOfMain('[data-slot="task-block"]', ["left", "top", "width"]),
    ],
  },
  {
    name: "the notifications page",
    path: "/notifications",
    hold: "/api/me/notifications",
    waiting: '[data-testid="notifications-skeleton-row"]',
    settled: '[data-testid="notification"]',
    parts: [
      {
        name: "first row",
        skeleton: '[data-testid="notifications-skeleton-row"]',
        loaded: '[data-testid="notification"]',
        edges: ["left", "top", "width"],
      },
    ],
  },
];

async function boxOf(page: Page, selector: string): Promise<Box | null> {
  const box = await page.locator(selector).first().boundingBox();
  return box ? { left: box.x, top: box.y, width: box.width, height: box.height } : null;
}

for (const shape of shapes) {
  test(`${shape.name} skeleton lines up with the page that replaces it`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1011 });
    await holdApi(page, shape.hold);
    await page.goto(shape.path);
    await expect(page.locator(shape.waiting).first()).toBeVisible();
    const before: Box[] = [];
    for (const part of shape.parts) {
      await expect(page.locator(part.skeleton).first(), `${part.name} skeleton`).toBeVisible();
      before.push((await boxOf(page, part.skeleton)) as Box);
    }
    await releaseApi(page);
    await expect(page.locator(shape.settled).first()).toBeVisible();
    await expect(page.locator(shape.waiting)).toHaveCount(0);
    const mismatches: string[] = [];
    for (const [index, part] of shape.parts.entries()) {
      const wanted = before[index] as Box;
      const found = await boxOf(page, part.loaded);
      if (!found) {
        mismatches.push(`${part.name}: nothing loaded at ${part.loaded}`);
        continue;
      }
      for (const edge of part.edges) {
        const gap = Math.abs(wanted[edge] - found[edge]);
        if (gap > (part.tolerance ?? 1)) {
          mismatches.push(
            `${part.name} ${edge}: skeleton ${Math.round(wanted[edge])}, page ${Math.round(found[edge])}`,
          );
        }
      }
    }
    expect(mismatches, mismatches.join("\n")).toEqual([]);
  });
}

test("the my work skeleton holds the two columns the to review tab loads into", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1011 });
  await holdApi(page);
  await page.goto("/my-work");
  const list = '[data-testid="work-skeleton-list"]';
  const side = '[data-testid="work-skeleton-side"]';
  await expect(page.locator(list)).toBeVisible();
  const columns = [(await boxOf(page, list)) as Box, (await boxOf(page, side)) as Box];
  await releaseApi(page);
  await expect(page.locator(list)).toHaveCount(0);
  const grid = 'main div[class*="grid-cols-[1fr_340px]"]';
  await expect(page.locator(grid).first()).toBeVisible();
  const loaded = [
    (await boxOf(page, `${grid} > :nth-child(1)`)) as Box,
    (await boxOf(page, `${grid} > :nth-child(2)`)) as Box,
  ];
  for (const [index, name] of ["list", "side column"].entries()) {
    for (const edge of ["left", "top", "width"] as const) {
      const gap = Math.abs((columns[index] as Box)[edge] - (loaded[index] as Box)[edge]);
      expect(gap, `${name} ${edge}`).toBeLessThanOrEqual(1);
    }
  }
});

const tables = [
  { name: "slides", path: `/projects/${p07}?tab=slides`, hold: "/me/slides" },
  { name: "tasks", path: `/projects/${p07}?tab=tasks`, hold: "/review-tasks" },
];

for (const table of tables) {
  test(`the project ${table.name} table skeleton rows use the columns of its header`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1011 });
    await holdApi(page, table.hold);
    await page.goto(table.path);
    const rows = page.locator('tbody tr[data-slot="skeleton-rows"]');
    await expect(rows).toBeVisible();
    const columns = await page.evaluate(() => {
      const head = Array.from(document.querySelectorAll("thead th")).map((cell) => {
        const box = cell.getBoundingClientRect();
        return { left: box.left, width: box.width };
      });
      const row = Array.from(
        document.querySelectorAll('tbody tr[data-slot="skeleton-rows"] td'),
      ).map((cell) => {
        const box = cell.getBoundingClientRect();
        return { left: box.left, width: box.width };
      });
      return { head, row };
    });
    expect(columns.row.length).toBe(columns.head.length);
    for (const [index, cell] of columns.row.entries()) {
      const head = columns.head[index];
      expect(Math.abs(cell.left - (head?.left ?? 0)), `column ${index} left`).toBeLessThanOrEqual(
        1,
      );
      expect(
        Math.abs(cell.width - (head?.width ?? 0)),
        `column ${index} width`,
      ).toBeLessThanOrEqual(1);
    }
    await releaseApi(page);
    await expect(page.locator('tbody tr[data-slot^="skeleton-row"]')).toHaveCount(0);
  });
}

test("the project page header and the home grid hold their place while data loads", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1011 });
  await holdApi(page);
  await page.goto(`/projects/${p07}?tab=slides`);
  const skeletonHeader = 'main > div > header:has([data-slot="skeleton-line"])';
  await expect(page.locator(skeletonHeader)).toBeVisible();
  const before = (await boxOf(page, skeletonHeader)) as Box;
  await releaseApi(page);
  const loadedHeader = '[data-testid="project-page"] header';
  await expect(page.locator(loadedHeader).first()).toBeVisible();
  const after = (await boxOf(page, loadedHeader)) as Box;
  for (const edge of ["left", "top", "width"] as const) {
    expect(Math.abs(before[edge] - after[edge]), `project header ${edge}`).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(before.height - after.height), "project header height").toBeLessThanOrEqual(8);

  await page.goto("/");
  const skeletonGrid = '[data-testid="home-skeleton"]';
  await expect(page.locator(skeletonGrid)).toBeVisible();
  const homeBefore = (await boxOf(page, skeletonGrid)) as Box;
  await releaseApi(page);
  const loadedGrid =
    'main > div[class*="grid-cols-[minmax(0,1fr)_320px]"]:not([data-testid="home-skeleton"])';
  await expect(page.locator(loadedGrid).first()).toBeVisible();
  const homeAfter = (await boxOf(page, loadedGrid)) as Box;
  for (const edge of ["left", "width"] as const) {
    expect(Math.abs(homeBefore[edge] - homeAfter[edge]), `home grid ${edge}`).toBeLessThanOrEqual(
      1,
    );
  }
});
