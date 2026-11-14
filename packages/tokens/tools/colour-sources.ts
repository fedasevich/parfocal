import { readFileSync } from "node:fs";
import type { CheckInput, ColourLimits, Rgb } from "../src/colour-check.ts";
import { parseHex } from "../src/colour-check.ts";

const tokensCss = new URL("../src/tokens.css", import.meta.url);
const taxonomyPy = new URL("../../../apps/api/src/parfocal_api/taxonomy.py", import.meta.url);
const pixelsJson = new URL("../data/he-pixels.json", import.meta.url);

export function cssBlock(css: string, selector: string): Record<string, string> {
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((part) => part.trim());
    const alone = selectors.length === 1 && selectors[0] === selector;
    const inList = selector !== ":root" && selectors.includes(selector);
    if (!alone && !inList) continue;
    const entries = [...(match[2] ?? "").matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)];
    return Object.fromEntries(
      entries.map((entry) => [entry[1] ?? "", (entry[2] ?? "").toLowerCase()]),
    );
  }
  throw new Error(`No ${selector} block in tokens.css`);
}

export function readApiLimits(source: string): ColourLimits {
  const between = /^MIN_BETWEEN_CLASSES\s*=\s*([\d.]+)/m.exec(source);
  if (!between?.[1]) throw new Error("MIN_BETWEEN_CLASSES not found in taxonomy.py");
  const reserved = [
    ...source.matchAll(/\(\s*"(#[0-9a-fA-F]{6})",\s*"([^"]+)",\s*([\d.]+)\s*,?\s*\)/g),
  ].map((match) => ({
    colour: (match[1] ?? "").toLowerCase(),
    label: match[2] ?? "",
    minDistance: Number(match[3]),
  }));
  if (reserved.length === 0) throw new Error("RESERVED not found in taxonomy.py");
  return { betweenClasses: Number(between[1]), reserved };
}

export function readPixels(encoded: string): Rgb[] {
  const pixels: Rgb[] = [];
  for (let i = 0; i + 6 <= encoded.length; i += 6) {
    pixels.push(parseHex(`#${encoded.slice(i, i + 6)}`));
  }
  return pixels;
}

export function loadCheckInput(): CheckInput {
  const css = readFileSync(tokensCss, "utf8");
  const shared = cssBlock(css, ":root");
  const dark = { ...shared, ...cssBlock(css, '[data-theme="dark"]') };
  const light = { ...shared, ...cssBlock(css, '[data-theme="light"]') };
  const classes = {
    tumor: shared["c-tumor"],
    stroma: shared["c-stroma"],
    immune: shared["c-immune"],
    other: shared["c-other"],
  } as Record<string, string>;
  const sampled = JSON.parse(readFileSync(pixelsJson, "utf8")) as { pixels: string };
  return {
    themes: { dark, light },
    classes,
    proposal: shared["c-prop"] ?? "",
    proposalCasing: shared["c-prop-casing"] ?? "",
    limits: readApiLimits(readFileSync(taxonomyPy, "utf8")),
    pixels: readPixels(sampled.pixels),
  };
}
