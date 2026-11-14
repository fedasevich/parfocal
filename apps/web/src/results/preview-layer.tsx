import { useSyncExternalStore } from "react";
import { useStageRect } from "../annotations/stage-size.ts";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { slideToScreen } from "../viewer/viewer-engine.ts";
import { type ParsedResults, type Placement, placePoint } from "./geojson-placement.ts";

type PreviewLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  results: ParsedResults;
  placement: Placement;
};

const cyan = "#22d3ee";

export function PreviewLayer({ engine, stage, results, placement }: PreviewLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const screenOf = (x: number, y: number) => {
    const moved = placePoint(placement, x, y);
    return slideToScreen(camera, rect, moved);
  };
  return (
    <svg
      data-testid="result-preview-layer"
      data-objects={results.objects}
      data-shift={`${placement.dx},${placement.dy}`}
      data-scale={placement.scale}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {results.shapes.map((shape) => {
        if (shape.kind === "point") {
          const where = screenOf(shape.x, shape.y);
          return (
            <circle
              key={shape.id}
              data-testid="result-preview-shape"
              cx={where.x}
              cy={where.y}
              r={4}
              fill={cyan}
              fillOpacity={0.35}
              stroke={cyan}
              strokeWidth={1.5}
            />
          );
        }
        const points: string[] = [];
        for (let at = 0; at + 1 < shape.points.length; at += 2) {
          const where = screenOf(shape.points[at] ?? 0, shape.points[at + 1] ?? 0);
          points.push(`${where.x},${where.y}`);
        }
        return (
          <polygon
            key={shape.id}
            data-testid="result-preview-shape"
            points={points.join(" ")}
            fill={cyan}
            fillOpacity={0.18}
            stroke={cyan}
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        );
      })}
    </svg>
  );
}
