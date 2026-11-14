import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const baseline = new Set(
  JSON.parse(readFileSync(new URL("./raw-jsx-strings-baseline.json", import.meta.url), "utf8")),
);

const textProps = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "description",
  "label",
  "placeholder",
  "title",
]);
const translating = new Set(["Trans", "Plural", "Select", "SelectOrdinal"]);
const letter = /\p{L}/u;
const message = "Raw string in JSX. Wrap it with <Trans> or the t macro.";

function hasLetters(value) {
  return typeof value === "string" && letter.test(value);
}

function rawStrings(node) {
  if (node === null || node === undefined) return [];
  if (node.type === "Literal") return hasLetters(node.value) ? [node] : [];
  if (node.type === "TemplateLiteral") {
    return node.quasis.some((quasi) => hasLetters(quasi.value.cooked)) ? [node] : [];
  }
  if (node.type === "ConditionalExpression") {
    return [...rawStrings(node.consequent), ...rawStrings(node.alternate)];
  }
  if (node.type === "LogicalExpression") {
    return [...rawStrings(node.left), ...rawStrings(node.right)];
  }
  return [];
}

function insideTranslation(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type !== "JSXElement") continue;
    const name = parent.openingElement.name;
    if (name.type === "JSXIdentifier" && translating.has(name.name)) return true;
  }
  return false;
}

function repoPath(filename) {
  return relative(repoRoot, filename).split(sep).join("/");
}

const rule = {
  meta: { type: "problem", schema: [] },
  create(context) {
    if (baseline.has(repoPath(context.filename))) return {};
    const report = (node) => context.report({ node, message });
    return {
      JSXText(node) {
        if (hasLetters(node.value) && !insideTranslation(node)) report(node);
      },
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || !textProps.has(node.name.name)) return;
        const value = node.value;
        const held = value?.type === "JSXExpressionContainer" ? value.expression : value;
        for (const raw of rawStrings(held)) report(raw);
      },
      JSXExpressionContainer(node) {
        if (node.parent.type !== "JSXElement" && node.parent.type !== "JSXFragment") return;
        if (insideTranslation(node)) return;
        for (const raw of rawStrings(node.expression)) report(raw);
      },
    };
  },
};

export default {
  meta: { name: "parfocal-i18n" },
  rules: { "no-raw-jsx-strings": rule },
};
