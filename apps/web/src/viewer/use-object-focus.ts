import { useCallback, useEffect, useRef, useState } from "react";
import type { ShapeId } from "../annotations/shapes.ts";
import type { SavedAnnotations } from "../annotations/use-saved-annotations.ts";
import { areaFocusOf, cellNumberOf, drawnFocusOf } from "./focus-object.ts";
import type { SlideAreaEntry } from "./slide-areas.ts";
import { outlineArea } from "./stage-geometry.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

export function useObjectFocus(
  object: string | undefined,
  engine: ViewerEngine | null,
  saved: Pick<SavedAnnotations, "loaded" | "codes" | "document">,
  areas: readonly SlideAreaEntry[],
  setTool: (tool: string) => void,
): {
  pick: readonly ShapeId[] | null;
  pickFromLayers: (ids: readonly ShapeId[], bounds: readonly number[] | null) => void;
} {
  const focused = useRef<string | null>(null);
  const [pick, setPick] = useState<readonly ShapeId[] | null>(null);
  const { loaded, codes, document } = saved;
  useEffect(() => {
    if (object === undefined || focused.current === object) return;
    if (engine === null || !loaded || cellNumberOf(object) !== null) return;
    const found = drawnFocusOf(object, codes, document) ?? areaFocusOf(object, areas);
    if (found === null) return;
    focused.current = object;
    if (found.shape !== null) {
      setTool("select");
      setPick([found.shape]);
    }
    void engine.flyToArea(found.area);
  }, [object, engine, loaded, codes, document, areas, setTool]);
  const pickFromLayers = useCallback(
    (ids: readonly ShapeId[], bounds: readonly number[] | null) => {
      setTool("select");
      setPick([...ids]);
      const area = bounds === null ? null : outlineArea([...bounds], 64);
      if (area !== null && engine !== null) void engine.flyToArea(area);
    },
    [engine, setTool],
  );
  return { pick, pickFromLayers };
}
