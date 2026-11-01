import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mockPath = fileURLToPath(new URL("../../../docs/design/ux-mock/index.html", import.meta.url));
const outputPath = fileURLToPath(new URL("../src/components/icon-set.tsx", import.meta.url));

const camel = (name: string) =>
  name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

function attributes(source: string): Array<[string, string]> {
  return [...source.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((match) => [
    match[1] ?? "",
    match[2] ?? "",
  ]);
}

function jsxValue(name: string, value: string) {
  return name === "stroke-width" ? `{${value}}` : JSON.stringify(value);
}

function element(tag: string, attrs: string) {
  const props = attributes(attrs)
    .map(([name, value]) => `${camel(name)}=${jsxValue(name, value)}`)
    .join(" ");
  return `<${tag} ${props} />`;
}

const mock = readFileSync(mockPath, "utf8");
const symbols = [...mock.matchAll(/<symbol id="i-([a-z0-9-]+)"([^>]*)>([\s\S]*?)<\/symbol>/g)];

const entries = symbols.map((match) => {
  const name = match[1] ?? "";
  const rootAttrs = attributes(match[2] ?? "").filter(([attr]) => attr !== "viewBox");
  const children = [...(match[3] ?? "").matchAll(/<([a-z]+)([^>]*?)\/?>(?:<\/\1>)?/g)].map(
    (child) => element(child[1] ?? "", child[2] ?? ""),
  );
  const svg = rootAttrs
    .map(
      ([attr, value]) =>
        `${camel(attr)}: ${attr === "stroke-width" ? value : JSON.stringify(value)}`,
    )
    .join(", ");
  const body = children.length === 1 ? children[0] : `<>${children.join("")}</>`;
  return `  ${JSON.stringify(name)}: { svg: { ${svg} }, body: ${body} },`;
});

const output = `import type { ReactElement, SVGProps } from "react";

type IconShape = { svg: SVGProps<SVGSVGElement>; body: ReactElement };

export const iconSet = {
${entries.join("\n")}
} satisfies Record<string, IconShape>;

export type IconName = keyof typeof iconSet;

export const iconNames = Object.keys(iconSet) as IconName[];
`;

writeFileSync(outputPath, output);
console.log(`wrote ${symbols.length} icons to ${outputPath}`);
