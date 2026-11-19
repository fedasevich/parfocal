export async function fetchPdf(request: () => Promise<Response>): Promise<Blob> {
  const response = await request();
  if (!response.ok) throw new Error("The PDF could not be made");
  return response.blob();
}

export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const paperSizes: Record<string, [string, string]> = {
  a4: ["210mm", "297mm"],
  letter: ["8.5in", "11in"],
};

export type PrintLayout = { paper: string; orientation: string };

export function printSheetStyle({ paper, orientation }: PrintLayout) {
  const [short, long] = paperSizes[paper] ?? paperSizes["a4"] ?? ["210mm", "297mm"];
  const [width, height] = orientation === "landscape" ? [long, short] : [short, long];
  return [
    "[data-print-sheet]{display:none}",
    "@media print{",
    `@page{size:${width} ${height};margin:0}`,
    "html,body{margin:0;padding:0;background:#fff}",
    "body>*:not([data-print-sheet]){display:none!important}",
    "[data-print-sheet]{display:block}",
    `[data-print-sheet] img{display:block;width:${width};height:${height};break-after:page}`,
    "[data-print-sheet] img:last-child{break-after:auto}",
    "}",
  ].join("");
}

export async function printPages(pages: readonly string[], layout: PrintLayout) {
  const sheet = document.createElement("div");
  sheet.dataset["printSheet"] = "";
  sheet.setAttribute("aria-hidden", "true");
  const style = document.createElement("style");
  style.textContent = printSheetStyle(layout);
  sheet.append(style);
  const images = pages.map((svg) => {
    const image = document.createElement("img");
    image.alt = "";
    image.src = svgSource(svg);
    return image;
  });
  sheet.append(...images);
  document.body.append(sheet);
  await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
  const done = () => {
    window.removeEventListener("afterprint", done);
    sheet.remove();
  };
  window.addEventListener("afterprint", done);
  window.print();
}

export const svgSource = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export const paperLabel = (paper: string) => (paper === "letter" ? "US Letter" : "A4");
