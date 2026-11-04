import { Button } from "@parfocal/ui/components/button";
import { type Part, sketchOf } from "./conflicts.ts";
import type { Choice } from "./save-queue.ts";
import type { SaveConflict } from "./use-saved-annotations.ts";

export function conflictText(conflict: SaveConflict): string {
  if (conflict.action === "remove") {
    return conflict.theirs.deleted
      ? "A colleague already deleted this shape"
      : "A colleague changed the shape you deleted";
  }
  return conflict.theirs.deleted
    ? "A colleague deleted the shape you changed"
    : "A colleague changed the shape you changed";
}

function PartShape({ part, tone, size }: { part: Part; tone: string; size: number }) {
  if (part.kind === "point") {
    return <circle cx={part.at[0]} cy={part.at[1]} r={size * 0.04} className={tone} />;
  }
  return (
    <polygon
      points={part.points.map(([x, y]) => `${x},${y}`).join(" ")}
      strokeWidth={size * 0.015}
      className={`fill-none ${tone}`}
    />
  );
}

function Preview({ conflict }: { conflict: SaveConflict }) {
  const mine = conflict.mine === null ? null : conflict.mine.geometry;
  const theirs = conflict.theirs.deleted ? null : conflict.theirs.geometry;
  const sketch = sketchOf(mine, theirs);
  const [x, y, width, height] = sketch.box;
  return (
    <svg
      viewBox={`${x} ${y} ${width} ${height}`}
      role="img"
      aria-label="Your outline in blue and your colleague's outline in orange"
      data-testid="conflict-preview"
      className="size-24 shrink-0 rounded-ctl border border-line bg-chrome-2"
    >
      {sketch.mine === null ? null : (
        <PartShape part={sketch.mine} tone="stroke-accent fill-accent" size={width} />
      )}
      {sketch.theirs === null ? null : (
        <PartShape part={sketch.theirs} tone="stroke-warn fill-warn" size={width} />
      )}
    </svg>
  );
}

export function ConflictNotice({
  conflicts,
  onResolve,
}: {
  conflicts: readonly SaveConflict[];
  onResolve: (conflict: SaveConflict, choice: Choice) => void;
}) {
  const conflict = conflicts[0];
  if (conflict === undefined) return null;
  const hasMine = conflict.action === "update" || !conflict.theirs.deleted;
  const more = conflicts.length - 1;
  return (
    <div
      role="alertdialog"
      aria-labelledby="conflict-title"
      data-testid="conflict-notice"
      data-action={conflict.action}
      data-theirs-deleted={conflict.theirs.deleted}
      className="absolute top-12 left-4 flex w-[min(420px,calc(100%-2rem))] gap-3 rounded-lg border border-line-strong bg-chrome p-3 shadow-pop"
    >
      <Preview conflict={conflict} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p id="conflict-title" className="text-body-sm font-medium text-fg">
          {conflictText(conflict)}
        </p>
        <p className="text-caption text-fg-dim">
          {more > 0 ? `${more} more waiting. ` : ""}
          Yours is blue, theirs is orange.
        </p>
        <div className="flex flex-wrap gap-2">
          {hasMine ? (
            <Button size="sm" onClick={() => onResolve(conflict, "mine")}>
              Keep mine
            </Button>
          ) : null}
          <Button size="sm" variant="primary" onClick={() => onResolve(conflict, "theirs")}>
            Keep theirs
          </Button>
        </div>
      </div>
    </div>
  );
}
