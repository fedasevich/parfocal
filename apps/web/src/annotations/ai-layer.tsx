import { useSyncExternalStore } from "react";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { slideToScreen } from "../viewer/viewer-engine.ts";
import type { CheckedAiObject } from "./annotate-task.ts";
import { useStageRect } from "./stage-size.ts";

type AiLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  objects: readonly CheckedAiObject[];
  selected: string | null;
  colourOf: (classKey: string | null) => string;
};

export function AiLayer({ engine, stage, objects, selected, colourOf }: AiLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const shown = objects.filter((object) => object.check !== "deleted");
  return (
    <svg
      data-testid="ai-layer"
      data-objects={shown.length}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {shown.map((object) => {
        const ring =
          (object.geometry.type === "Polygon"
            ? object.geometry.coordinates[0]
            : object.geometry.coordinates[0]?.[0]) ?? [];
        const points = ring
          .map(([x, y]) => {
            const at = slideToScreen(camera, rect, { x, y });
            return `${at.x},${at.y}`;
          })
          .join(" ");
        return (
          <polygon
            key={object.object}
            data-testid="ai-object"
            data-object={object.object}
            data-check={object.check}
            points={points}
            fill="none"
            stroke={colourOf(object.copy?.class_id ?? object.class_id)}
            strokeWidth={object.object === selected ? 3 : 1.5}
            strokeDasharray={object.check === "unchecked" ? "4 3" : undefined}
          />
        );
      })}
    </svg>
  );
}
