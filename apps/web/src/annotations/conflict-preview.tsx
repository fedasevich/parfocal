import { t } from "@lingui/core/macro";
import { type Part, sketchOf } from "./conflicts.ts";
import type { SaveConflict } from "./use-saved-annotations.ts";

export function conflictText(conflict: SaveConflict): string {
  if (conflict.action === "remove") {
    return conflict.theirs.deleted
      ? t`A colleague already deleted this shape`
      : t`A colleague changed the shape you deleted`;
  }
  return conflict.theirs.deleted
    ? t`A colleague deleted the shape you changed`
    : t`A colleague changed the shape you changed`;
}

export const conflictId = (conflict: SaveConflict): string =>
  `${conflict.remote.id ?? "new"}:${conflict.action}:${conflict.theirs.version}`;

function PartShape({ part, mine, size }: { part: Part; mine: boolean; size: number }) {
  const tone = mine ? "stroke-accent" : "stroke-warn";
  const dash = mine ? undefined : `${size * 0.06} ${size * 0.04}`;
  const strokeWidth = size * (mine ? 0.02 : 0.03);
  if (part.kind === "point") {
    return (
      <circle
        cx={part.at[0]}
        cy={part.at[1]}
        r={size * (mine ? 0.05 : 0.1)}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
        className={mine ? `${tone} fill-accent` : `${tone} fill-none`}
      />
    );
  }
  return (
    <polygon
      points={part.points.map(([x, y]) => `${x},${y}`).join(" ")}
      strokeWidth={strokeWidth}
      strokeDasharray={dash}
      className={`fill-none ${tone}`}
    />
  );
}

export function ConflictPreview({ conflict }: { conflict: SaveConflict }) {
  const mine = conflict.mine === null ? null : conflict.mine.geometry;
  const theirs = conflict.theirs.deleted ? null : conflict.theirs.geometry;
  const sketch = sketchOf(mine, theirs);
  const [x, y, width, height] = sketch.box;
  return (
    <svg
      viewBox={`${x} ${y} ${width} ${height}`}
      role="img"
      aria-label={t`Your outline, solid blue, over your colleague's outline, dashed orange`}
      data-testid="conflict-preview"
      className="size-16 shrink-0 rounded-ctl border border-line bg-chrome-2"
    >
      {sketch.mine === null ? null : <PartShape part={sketch.mine} mine size={width} />}
      {sketch.theirs === null ? null : <PartShape part={sketch.theirs} mine={false} size={width} />}
    </svg>
  );
}
