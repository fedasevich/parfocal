import { useSyncExternalStore } from "react";
import { useStageRect } from "../annotations/stage-size.ts";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { slideToScreen } from "../viewer/viewer-engine.ts";
import type { StagePreview } from "./file-preview.ts";
import { type ParsedResults, type Placement, placePoint } from "./geojson-placement.ts";

type PreviewLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  preview: StagePreview;
};

const cyan = "#22d3ee";

function PreviewShapes({
  engine,
  stage,
  results,
  placement,
}: {
  engine: ViewerEngine;
  stage: HTMLElement;
  results: ParsedResults;
  placement: Placement;
}) {
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
      data-shapes={results.shapes.length}
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
              data-kind="point"
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
            data-kind="ring"
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

function PreviewImage({
  engine,
  stage,
  url,
}: {
  engine: ViewerEngine;
  stage: HTMLElement;
  url: string;
}) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const slide = engine.getSlide();
  if (slide === null) return null;
  const from = slideToScreen(camera, rect, { x: 0, y: 0 });
  const to = slideToScreen(camera, rect, { x: slide.width, y: slide.height });
  return (
    <svg
      data-testid="result-preview-layer"
      data-image=""
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      <image
        data-testid="result-preview-image"
        href={url}
        x={from.x}
        y={from.y}
        width={Math.max(0, to.x - from.x)}
        height={Math.max(0, to.y - from.y)}
        preserveAspectRatio="none"
        opacity={0.5}
      />
    </svg>
  );
}

export function PreviewLayer({ engine, stage, preview }: PreviewLayerProps) {
  return preview.kind === "image" ? (
    <PreviewImage engine={engine} stage={stage} url={preview.url} />
  ) : (
    <PreviewShapes
      engine={engine}
      stage={stage}
      results={preview.results}
      placement={preview.placement}
    />
  );
}
