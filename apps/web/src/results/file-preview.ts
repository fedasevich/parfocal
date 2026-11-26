import { resultFileKindOf } from "../screens/upload/result-formats.ts";
import { type ParsedResults, type Placement, readJsonResults } from "./geojson-placement.ts";
import { tablePreview } from "./table-preview.ts";

export const previewByteLimit = 20 * 1024 * 1024;
export const previewShapeCap = 5000;

export type FilePreview =
  | {
      readonly kind: "shapes";
      readonly results: ParsedResults;
      readonly total: number;
      readonly alignable: boolean;
      readonly text: string | null;
    }
  | { readonly kind: "image"; readonly url: string }
  | { readonly kind: "none"; readonly why: "raster" | "large" | "unreadable" | "unsupported" };

export type StagePreview =
  | { readonly kind: "shapes"; readonly results: ParsedResults; readonly placement: Placement }
  | { readonly kind: "image"; readonly url: string };

export const evenSample = (results: ParsedResults, cap = previewShapeCap): ParsedResults => {
  const total = results.shapes.length;
  if (total <= cap) return results;
  const step = total / cap;
  const shapes = Array.from({ length: cap }, (_, index) => {
    const shape = results.shapes[Math.floor(index * step)];
    if (shape === undefined) throw new Error("The sample ran past the shapes");
    return shape;
  });
  return { shapes, objects: results.objects };
};

export const shapesPreview = (
  results: ParsedResults,
  alignable: boolean,
  text: string,
): FilePreview => ({
  kind: "shapes",
  results: evenSample(results),
  total: results.shapes.length,
  alignable,
  text: alignable ? text : null,
});

export const previewOfText = (name: string, text: string): FilePreview => {
  const kind = resultFileKindOf(name);
  if (kind === "table") {
    const table = tablePreview(text);
    return table === null ? { kind: "none", why: "unreadable" } : shapesPreview(table, false, text);
  }
  if (kind === "shapes") {
    const read = readJsonResults(text);
    return read === null
      ? { kind: "none", why: "unreadable" }
      : shapesPreview(read.results, read.geojson, text);
  }
  return { kind: "none", why: kind === null ? "unsupported" : "raster" };
};

export const readFilePreview = async (file: File): Promise<FilePreview> => {
  const kind = resultFileKindOf(file.name);
  if (kind === null) return { kind: "none", why: "unsupported" };
  if (kind === "raster") return { kind: "none", why: "raster" };
  if (file.size > previewByteLimit) return { kind: "none", why: "large" };
  if (kind === "image") {
    try {
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      return { kind: "image", url: URL.createObjectURL(file) };
    } catch {
      return { kind: "none", why: "unreadable" };
    }
  }
  return previewOfText(file.name, await file.text());
};
