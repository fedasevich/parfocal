import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fontFamilies, fontWeights, minRunningTextPx, typeScale } from "#index.ts";
import { typeScaleProblems } from "#type-scale-lint.ts";

const fonts = readFileSync(new URL("../src/fonts.css", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/theme.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");

const faces = [...fonts.matchAll(/@font-face \{([^}]+)\}/g)].map(([, body = ""]) => ({
  family: /font-family: "([^"]+)"/.exec(body)?.[1],
  weight: Number(/font-weight: (\d+)/.exec(body)?.[1]),
  display: /font-display: (\w+)/.exec(body)?.[1],
  file: /url\("\.\.\/fonts\/([^"]+)"\)/.exec(body)?.[1] ?? "",
}));

test("the scale has nine sizes and only labels go under 12 px", () => {
  const sizes = Object.values(typeScale).map((style) => style.size);
  assert.deepEqual(sizes, [11, 12, 13, 14, 16, 18, 20, 24, 28]);
  const small = Object.entries(typeScale).filter(([, style]) => style.size < minRunningTextPx);
  assert.deepEqual(
    small.map(([name]) => name),
    ["label"],
  );
});

test("titles default to 600 in the Tailwind theme", () => {
  for (const [style, { weight }] of Object.entries(typeScale)) {
    if (style === "label") continue;
    const declared = new RegExp(`--text-${style}--font-weight: (\\d+);`).exec(theme)?.[1];
    assert.equal(declared === undefined ? 400 : Number(declared), weight, style);
  }
  assert.match(theme, /--text-\*: initial;/);
});

test("both families are self hosted in every weight the app uses", () => {
  for (const [role, family] of Object.entries(fontFamilies)) {
    const weights = fontWeights[role as keyof typeof fontWeights];
    const shipped = faces.filter((face) => face.family === family).map((face) => face.weight);
    assert.deepEqual([...new Set(shipped)], [...weights], family);
    assert.match(tokens, new RegExp(`--font-${role}: "${family}",`));
  }
  for (const face of faces) {
    assert.ok(face.file.endsWith(".woff2"), face.file);
    assert.ok(existsSync(new URL(`../fonts/${face.file}`, import.meta.url)), face.file);
  }
  assert.ok(existsSync(new URL("../fonts/OFL.txt", import.meta.url)));
});

test("fonts never swap in late, so text does not shift", () => {
  assert.ok(faces.length > 0);
  for (const face of faces) assert.equal(face.display, "optional", face.file);
  assert.doesNotMatch(fonts, /https?:/);
});

test("the lint passes text on the scale", () => {
  const source = `<b className="text-title-sm text-fg">Run</b><span className="md:text-caption">x</span>`;
  assert.deepEqual(typeScaleProblems(source, "script"), []);
  assert.deepEqual(typeScaleProblems(".a { font-size: var(--text-body); }", "css"), []);
  assert.deepEqual(typeScaleProblems(`<p className="max-w-sm text-fg-dim">x</p>`, "script"), []);
});

test("the lint fails a font size off the scale", () => {
  const problems = typeScaleProblems(
    [
      `<b className="text-[15px]">a</b>`,
      `<b className="text-[0.8rem]">b</b>`,
      `<b className="hover:text-sm">c</b>`,
      `<b style={{ fontSize: 9 }}>d</b>`,
      `<b style={{ fontSize: size * 0.4 }}>e</b>`,
    ].join("\n"),
    "script",
  );
  assert.deepEqual(
    problems.map((problem) => [problem.line, problem.found]),
    [
      [1, "text-[15px]"],
      [2, "text-[0.8rem]"],
      [3, "text-sm"],
      [4, "fontSize: 9"],
      [5, "fontSize: size * 0.4"],
    ],
  );
  assert.match(problems[0]?.reason ?? "", /off the type scale/);
  assert.match(problems[2]?.reason ?? "", /text-body/);
});

test("the lint names the token for a raw size that is on the scale", () => {
  const [problem] = typeScaleProblems(`<h2 className="text-[20px]">x</h2>`, "script");
  assert.equal(problem?.reason, "20 px is on the scale, write text-title");
});

test("the lint checks CSS font-size declarations", () => {
  const problems = typeScaleProblems(".a {\n  font-size: 15px;\n}", "css");
  assert.deepEqual(
    problems.map((problem) => [problem.line, problem.found]),
    [[2, "font-size: 15px"]],
  );
});
