import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

const pages = [
  { name: "my work", path: "/my-work" },
  { name: "project slides", path: `/projects/${p07}?tab=slides` },
  { name: "project upload", path: `/projects/${p07}/upload` },
  { name: "settings", path: "/settings" },
];

const layouts = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, hasTouch: false, minimum: 24 },
  { name: "tablet", viewport: { width: 1024, height: 768 }, hasTouch: true, minimum: 44 },
];

const interactiveSelector = [
  "button",
  "a[href]",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[role=button]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=menuitemcheckbox]",
  "[role=menuitemradio]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=switch]",
  "[role=combobox]",
  "[role=option]",
  "[role=link]",
].join(",");

const undersized = (page: Page, minimum: number) =>
  page.evaluate(
    ({ selector, limit }) => {
      const describe = (element: Element) => {
        const label =
          element.getAttribute("aria-label") ?? (element.textContent ?? "").trim().slice(0, 30);
        return `${element.tagName.toLowerCase()}[${label}]`;
      };
      const isVisible = (element: Element, rect: DOMRect) => {
        const style = getComputedStyle(element);
        return (
          rect.width > 1 &&
          rect.height > 1 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          element.closest("[aria-hidden=true], [inert], canvas") === null
        );
      };
      const sitsInSentence = (element: Element) =>
        [...(element.parentElement?.childNodes ?? [])].some(
          (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
        );
      const isInlineProse = (element: Element) =>
        sitsInSentence(element) ||
        (getComputedStyle(element).display === "inline" &&
          element.closest("p, li, dd, td, label") !== null);
      const rectOf = (element: Element) => {
        const wrapper = element.closest("[data-slot=input-group], [data-slot=slider-control]");
        if (wrapper !== null) return wrapper.getBoundingClientRect();
        const label = element.closest("label");
        if (label !== null && element instanceof HTMLInputElement) {
          return label.getBoundingClientRect();
        }
        return element.getBoundingClientRect();
      };
      const failures: string[] = [];
      for (const element of document.querySelectorAll(selector)) {
        const rect = rectOf(element);
        if (!isVisible(element, rect) || isInlineProse(element)) continue;
        if (Math.round(rect.width) < limit || Math.round(rect.height) < limit) {
          failures.push(
            `${describe(element)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          );
        }
      }
      return [...new Set(failures)];
    },
    { selector: interactiveSelector, limit: minimum },
  );

for (const layout of layouts) {
  test.describe(`${layout.name} layout`, () => {
    test.use({ viewport: layout.viewport, hasTouch: layout.hasTouch });
    test.setTimeout(60_000);

    for (const target of pages) {
      test(`${target.name} has no target under ${layout.minimum} px`, async ({ page }) => {
        await page.goto(target.path);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(500);
        expect(await undersized(page, layout.minimum)).toEqual([]);
      });
    }
  });
}
