import { type TypeStyle, typeScale } from "#index.ts";

export interface TypeScaleProblem {
  readonly line: number;
  readonly found: string;
  readonly reason: string;
}

const styleBySize = new Map<number, TypeStyle>(
  Object.entries(typeScale).map(([style, spec]) => [spec.size, style as TypeStyle]),
);

const tailwindSizes: Record<string, TypeStyle | undefined> = {
  xs: "caption",
  sm: "body",
  base: "lead",
  lg: "title-sm",
  xl: "title",
  "2xl": "page-title",
};

const arbitraryClass = /(?<![\w-])text-\[(?:length:)?(-?[\d.]+)(px|rem|em|pt|%)?\]/g;
const namedClass = /(?<![\w-])text-(xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g;
const cssDeclaration = /(?<![\w-])font-size\s*:\s*([^;}"'`]+)/g;
const styleProperty = /\bfontSize\s*:\s*([^,}\n]+)/g;

function sizeInPx(value: number, unit: string | undefined): number | null {
  if (unit === undefined || unit === "px") return value;
  if (unit === "rem" || unit === "em") return value * 16;
  return null;
}

function advice(px: number | null): string {
  if (px === null) return "font sizes come from the type scale only";
  const style = styleBySize.get(px);
  return style ? `${px} px is on the scale, write text-${style}` : `${px} px is off the type scale`;
}

export function typeScaleProblems(source: string, kind: "css" | "script"): TypeScaleProblem[] {
  const problems: TypeScaleProblem[] = [];
  source.split("\n").forEach((text, index) => {
    const line = index + 1;
    for (const match of text.matchAll(arbitraryClass)) {
      const px = sizeInPx(Number(match[1]), match[2]);
      problems.push({ line, found: match[0], reason: advice(px) });
    }
    for (const match of text.matchAll(namedClass)) {
      const style = tailwindSizes[match[1] ?? ""];
      problems.push({
        line,
        found: match[0],
        reason: style ? `write text-${style}` : "larger than the display size",
      });
    }
    if (kind === "css") {
      for (const match of text.matchAll(cssDeclaration)) {
        const value = (match[1] ?? "").trim();
        if (/^var\(--text-[\w-]+\)$/.test(value) || value === "inherit") continue;
        problems.push({ line, found: match[0].trim(), reason: "use a --text-* token" });
      }
    }
    if (kind === "script") {
      for (const match of text.matchAll(styleProperty)) {
        const value = (match[1] ?? "").trim();
        const px = /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;
        problems.push({
          line,
          found: match[0].trim(),
          reason: px === null ? "a computed font size is off the scale" : advice(px),
        });
      }
    }
  });
  return problems;
}
