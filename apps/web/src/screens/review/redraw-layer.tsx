import type { Point, PolygonDraft } from "../../annotations/polygon-draft.ts";
import { pinOnScreen } from "./comment-pin.ts";
import type { Camera } from "./slide-still.tsx";

type Size = { width: number; height: number };

type RedrawLayerProps = {
  camera: Camera;
  size: Size;
  draft: PolygonDraft | null;
  saved: PolygonDraft | null;
  onClose: () => void;
};

const pointsOf = (camera: Camera, size: Size, shape: PolygonDraft) =>
  shape.map((point) => pinOnScreen(camera, size, point));

const path = (points: Point[]) => points.map((point) => `${point.x},${point.y}`).join(" ");

export function RedrawLayer({ camera, size, draft, saved, onClose }: RedrawLayerProps) {
  const drafting = draft === null ? [] : pointsOf(camera, size, draft);
  const kept = saved === null ? [] : pointsOf(camera, size, saved);
  const first = drafting[0];
  return (
    <>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full">
        {kept.length >= 3 ? (
          <polygon
            data-testid="redrawn-outline"
            data-points={kept.length}
            points={path(kept)}
            fill="rgb(255 255 255 / 0.06)"
            stroke="var(--accent)"
            strokeWidth={2.5}
            strokeDasharray="6 4"
          />
        ) : null}
        {drafting.length > 1 ? (
          <polyline points={path(drafting)} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
        ) : null}
        {drafting.map((point) => (
          <circle
            key={`${point.x},${point.y}`}
            data-testid="redraw-vertex"
            cx={point.x}
            cy={point.y}
            r={4}
            fill="#ffffff"
            stroke="var(--accent)"
            strokeWidth={2}
          />
        ))}
      </svg>
      {first !== undefined && drafting.length >= 3 ? (
        <button
          type="button"
          aria-label="Close the outline"
          data-testid="redraw-close"
          className="absolute size-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-2 border-accent bg-white/30"
          style={{ left: first.x, top: first.y }}
          onClick={onClose}
        />
      ) : null}
    </>
  );
}
