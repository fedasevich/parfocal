import { type Frame, type FrameNode, maskText } from "./trace-model.ts";

export type DomNodeLike = {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<DomNodeLike>;
  attributes?: ArrayLike<{ name: string; value: string }>;
};

const elementNode = 1;
const textNode = 3;

const skippedTags = new Set([
  "script",
  "noscript",
  "style",
  "iframe",
  "object",
  "embed",
  "template",
]);
const emptyTags = new Set(["canvas", "video", "audio"]);
const droppedAttributes = new Set(["value", "srcset", "nonce", "integrity", "checked", "selected"]);
const maskedScopeAttributes = new Set(["placeholder", "title", "alt", "aria-label"]);
const nodeBudget = 5000;
const depthLimit = 60;

function attributesOf(node: DomNodeLike): Record<string, string> {
  const result: Record<string, string> = {};
  for (const attribute of Array.from(node.attributes ?? []))
    result[attribute.name] = attribute.value;
  return result;
}

const attributeValue = (attrs: Record<string, string>, name: string): string | undefined =>
  attrs[name];

function inMaskedScope(tag: string, attrs: Record<string, string>): boolean {
  if (tag === "textarea") return true;
  if ("data-private" in attrs) return true;
  const editable = attributeValue(attrs, "contenteditable");
  if (editable !== undefined && editable !== "false") return true;
  return attributeValue(attrs, "role") === "textbox";
}

function safeAttributes(
  tag: string,
  attrs: Record<string, string>,
  masked: boolean,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (droppedAttributes.has(name) || name.startsWith("on")) continue;
    if ((name === "src" || name === "href") && /^(?:data|blob|javascript):/i.test(value)) continue;
    result[name] = masked && maskedScopeAttributes.has(name) ? maskText(value) : value;
  }
  if (tag === "input" || tag === "textarea" || tag === "select") result["data-masked"] = "true";
  return result;
}

export function serialiseNode(root: DomNodeLike, scopeMasked = false): FrameNode | undefined {
  let budget = nodeBudget;
  const visit = (node: DomNodeLike, masked: boolean, depth: number): FrameNode | undefined => {
    if (budget <= 0 || depth > depthLimit) return undefined;
    if (node.nodeType === textNode) {
      budget -= 1;
      const text = node.nodeValue ?? "";
      return masked ? maskText(text) : text;
    }
    if (node.nodeType !== elementNode) return undefined;
    const tag = node.nodeName.toLowerCase();
    if (skippedTags.has(tag)) return undefined;
    budget -= 1;
    const attrs = attributesOf(node);
    const childMasked = masked || inMaskedScope(tag, attrs);
    const safe = safeAttributes(tag, attrs, childMasked);
    if (emptyTags.has(tag) || tag === "input") return [tag, safe, []];
    const children: FrameNode[] = [];
    for (const child of Array.from(node.childNodes)) {
      const converted = visit(child, childMasked, depth + 1);
      if (converted !== undefined) children.push(converted);
    }
    return [tag, safe, children];
  };
  return visit(root, scopeMasked, 0);
}

export type DomDocumentLike = {
  body: DomNodeLike | null;
  documentElement: DomNodeLike;
  defaultView: { scrollX: number; scrollY: number } | null;
};

export function captureFrame(doc: DomDocumentLike): Frame | undefined {
  if (doc.body === null) return undefined;
  const body = serialiseNode(doc.body);
  if (body === undefined) return undefined;
  return {
    body,
    rootAttrs: attributesOf(doc.documentElement),
    scrollX: doc.defaultView?.scrollX ?? 0,
    scrollY: doc.defaultView?.scrollY ?? 0,
  };
}

const headLimit = 400_000;

export function captureHead(doc: Document): string[] {
  const parts: string[] = [];
  let size = 0;
  for (const element of Array.from(doc.head.querySelectorAll('link[rel="stylesheet"], style'))) {
    const html =
      element.tagName === "LINK"
        ? `<link rel="stylesheet" href="${(element as HTMLLinkElement).href.replace(/"/g, "%22")}">`
        : `<style>${(element.textContent ?? "").replace(/<\/style/gi, "")}</style>`;
    size += html.length;
    if (size > headLimit) break;
    parts.push(html);
  }
  return parts;
}
