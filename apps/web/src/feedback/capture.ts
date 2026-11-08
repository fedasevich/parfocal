import {
  type Area,
  blurAreas,
  mediaSelector,
  mosaic,
  phiSelector,
  type Size,
} from "./phi-areas.ts";

const redactMark = "data-feedback-redact";
const mediaMark = "data-feedback-media";
const redactedFill = "#8b9099";

const redactionCss = `
[${redactMark}], [${redactMark}] * {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  text-shadow: none !important;
  fill: transparent !important;
  stroke: transparent !important;
  caret-color: transparent !important;
  background-image: none !important;
}
[${redactMark}] { background-color: ${redactedFill} !important; }
[${mediaMark}] { background: ${redactedFill} !important; display: block; }
`;

function rulesOf(sheet: CSSStyleSheet): string[] {
  try {
    return Array.from(sheet.cssRules, (rule) => rule.cssText);
  } catch {
    return [];
  }
}

function pageCss(doc: Document): string {
  return Array.from(doc.styleSheets)
    .flatMap(rulesOf)
    .filter((rule) => !rule.startsWith("@font-face"))
    .join("\n");
}

function markLive(doc: Document): { areas: Area[]; unmark: () => void } {
  const marked: Element[] = [];
  const areas: Area[] = [];
  for (const element of Array.from(doc.querySelectorAll(phiSelector))) {
    const box = element.getBoundingClientRect();
    areas.push({ x: box.left, y: box.top, width: box.width, height: box.height });
    element.setAttribute(redactMark, "");
    if (element.matches(mediaSelector)) {
      element.setAttribute(mediaMark, `${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    marked.push(element);
  }
  return {
    areas,
    unmark: () => {
      for (const element of marked) {
        element.removeAttribute(redactMark);
        element.removeAttribute(mediaMark);
      }
    },
  };
}

function stripClone(body: HTMLElement, doc: Document): void {
  for (const script of Array.from(body.querySelectorAll("script, noscript, template"))) {
    script.remove();
  }
  for (const media of Array.from(body.querySelectorAll(`[${mediaMark}]`))) {
    const [width = "0", height = "0"] = (media.getAttribute(mediaMark) ?? "").split("x");
    const stand = doc.createElement("div");
    stand.setAttribute(mediaMark, "");
    stand.setAttribute(redactMark, "");
    const style = media.getAttribute("style");
    if (style) stand.setAttribute("style", style);
    if (media.getAttribute("class")) stand.setAttribute("class", media.getAttribute("class") ?? "");
    stand.style.width = `${width}px`;
    stand.style.height = `${height}px`;
    media.replaceWith(stand);
  }
  for (const element of Array.from(body.querySelectorAll("[style*='url(']"))) {
    if (element instanceof HTMLElement) element.style.backgroundImage = "none";
  }
}

function svgOf(doc: Document, size: Size): { svg: string; areas: Area[] } {
  const live = markLive(doc);
  let body: HTMLElement;
  try {
    body = doc.body.cloneNode(true) as HTMLElement;
  } finally {
    live.unmark();
  }
  stripClone(body, doc);
  body.style.margin = "0";
  body.style.width = `${size.width}px`;
  body.style.height = `${size.height}px`;
  body.style.overflow = "hidden";
  const html = doc.documentElement.cloneNode(false) as HTMLElement;
  const head = doc.createElement("head");
  const style = doc.createElement("style");
  style.textContent = `${pageCss(doc)}\n${redactionCss}`;
  head.append(style);
  html.append(head, body);
  const rootAttributes = Array.from(doc.documentElement.attributes)
    .filter((attribute) => attribute.name === "class" || attribute.name.startsWith("data-"))
    .map((attribute) => ` ${attribute.name}="${attribute.value.replace(/[&"<]/g, "")}"`)
    .join("");
  const markup = new XMLSerializer().serializeToString(html);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"${rootAttributes} width="${size.width}" height="${size.height}"><foreignObject x="0" y="0" width="100%" height="100%">${markup}</foreignObject></svg>`;
  return { svg, areas: blurAreas(live.areas, size) };
}

export async function captureRedacted(doc: Document = document): Promise<string | null> {
  const view = doc.defaultView;
  if (!view) return null;
  const size = { width: view.innerWidth, height: view.innerHeight };
  try {
    const { svg, areas } = svgOf(doc, size);
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    const canvas = doc.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = view.getComputedStyle(doc.body).backgroundColor || "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    const pixels = context.getImageData(0, 0, size.width, size.height);
    mosaic(pixels, areas);
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
