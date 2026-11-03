import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

type StoryIndex = {
  entries: Record<string, { id: string; type: "story" | "docs"; title: string }>;
};

const index = JSON.parse(
  readFileSync(new URL("../storybook-static/index.json", import.meta.url), "utf8"),
) as StoryIndex;

const stories = Object.values(index.entries).filter((entry) => entry.type === "story");

const tabsPerStory = 12;

type Stop = { control: string; ring: boolean };

for (const theme of ["dark", "light"] as const) {
  for (const story of stories) {
    test(`${story.id} draws a visible focus ring on every tab stop in ${theme}`, async ({
      page,
    }) => {
      await page.goto(
        `/iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme};a11y.manual:!true`,
      );
      await page.locator("#storybook-root > *").first().waitFor();
      await page.evaluate(() =>
        Promise.race([
          Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]),
      );
      await page.addStyleTag({
        content:
          "*, *::before, *::after { transition: none !important; animation: none !important; }",
      });
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      const stops: Stop[] = [];
      const seen = new Set<string>();
      for (let step = 0; step < tabsPerStory; step += 1) {
        await page.keyboard.press("Tab");
        const stop = await page.evaluate(() => {
          const active = document.activeElement;
          if (!(active instanceof HTMLElement) || active === document.body) return null;
          if (
            active.hasAttribute("data-base-ui-focus-guard") ||
            active.getAttribute("data-state") === "focus"
          ) {
            return { skip: true } as const;
          }
          const name = (active.getAttribute("aria-label") ?? active.textContent ?? active.tagName)
            .trim()
            .slice(0, 40);
          const path: string[] = [];
          for (let node: Element | null = active; node; node = node.parentElement) {
            path.push(
              `${node.tagName}:${Array.prototype.indexOf.call(node.parentElement?.children ?? [], node)}`,
            );
          }
          const transparent = (color: string) =>
            color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color) || /\/\s*0\)$/.test(color);
          const chain: Element[] = [];
          for (
            let node: Element | null = active;
            node && chain.length < 4;
            node = node.parentElement
          ) {
            chain.push(node);
          }
          const look = () =>
            chain.map((element) => {
              const style = getComputedStyle(element);
              const outline =
                style.outlineStyle !== "none" &&
                Number.parseFloat(style.outlineWidth) >= 1 &&
                !transparent(style.outlineColor);
              const border = ["top", "right", "bottom", "left"].some(
                (side) => Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) >= 1,
              );
              return {
                outline: outline
                  ? `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor} ${style.outlineOffset}`
                  : "",
                shadow: style.boxShadow === "none" ? "" : style.boxShadow,
                border: border
                  ? ["top", "right", "bottom", "left"]
                      .map((side) => style.getPropertyValue(`border-${side}-color`))
                      .join(" ")
                  : "",
              };
            });
          const focused = look();
          active.blur();
          const blurred = look();
          active.focus({ focusVisible: true });
          const ring = focused.some(
            (now, at) =>
              (now.outline !== "" && now.outline !== blurred[at]?.outline) ||
              (now.shadow !== "" && now.shadow !== blurred[at]?.shadow) ||
              (now.border !== "" && now.border !== blurred[at]?.border),
          );
          return {
            skip: false,
            key: path.join("/"),
            control: `${active.tagName.toLowerCase()} "${name}"`,
            ring,
          } as const;
        });
        if (stop === null) break;
        if (stop.skip) continue;
        if (seen.has(stop.key)) break;
        seen.add(stop.key);
        stops.push({ control: stop.control, ring: stop.ring });
      }
      const missing = stops.filter((stop) => !stop.ring).map((stop) => stop.control);
      expect(missing).toEqual([]);
    });
  }
}
