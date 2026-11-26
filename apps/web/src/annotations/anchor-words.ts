import type { Thread } from "@parfocal/api-client";
import { shownObjectId } from "@parfocal/ui/lib/object-id";

const isBox = (coordinates: unknown) => Array.isArray(coordinates) && coordinates.length === 1;

export function anchorWords(
  anchor: Thread["anchor"],
  layerName: (key: string) => string | undefined,
): { label: string; kind: string } {
  const { kind, object_id: object, geometry } = anchor;
  if (kind === "layer") {
    const key = anchor.layer ?? "";
    return {
      label: layerName(key) ?? (key.startsWith("g:") ? "Group" : "Class"),
      kind: key.startsWith("g:") ? "Group" : "Class layer",
    };
  }
  if (kind === "point") return { label: "Pin", kind: "Point" };
  if (kind === "shape") {
    if (geometry?.type === "MultiPolygon") {
      const count = Array.isArray(geometry.coordinates) ? geometry.coordinates.length : 0;
      return { label: "Selection", kind: `${count} objects` };
    }
    if (geometry?.type === "Polygon" && isBox(geometry.coordinates)) {
      return { label: "Region", kind: "Area" };
    }
    return { label: "Shape", kind: "Line" };
  }
  const shown = shownObjectId(object ?? "");
  if (kind === "roi") return { label: shown, kind: "Your ROI" };
  if (shown.includes("·") || shown.startsWith("C")) return { label: shown, kind: "Cell" };
  if (shown.startsWith("M")) return { label: shown, kind: "Measurement" };
  if (shown.endsWith("⁺")) return { label: shown, kind: "Drawn region" };
  return { label: shown, kind: "Tumor region" };
}
