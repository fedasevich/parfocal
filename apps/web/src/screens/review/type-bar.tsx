import { Keycap } from "@parfocal/ui/components/keycap";
import { useEffect } from "react";
import { type CellSpot, type Direction, jumpTarget, type Point, placeBar } from "./cell-jump.ts";
import { cellShapes } from "./slide-geometry.ts";
import { type TypeId, type TypeOption, typeOptions } from "./type-bar.ts";

const ringRadius = 24;
const barHeight = 48;
const buttonWidth = 116;

type TypeBarProps = {
  object: string;
  centre: Point;
  scale: number;
  size: { width: number; height: number };
  chosen: TypeId | undefined;
  onChoose: (option: TypeOption) => void;
};

export function TypeBar({ object, centre, scale, size, chosen, onChoose }: TypeBarProps) {
  const width = Math.min(size.width - 24, typeOptions.length * buttonWidth + 16);
  const box = placeBar(centre, ringRadius * scale, { width, height: barHeight }, size);
  return (
    <div
      role="toolbar"
      aria-label={`Type for ${object}`}
      data-testid="cell-type-bar"
      className="absolute z-4 flex items-center gap-1 rounded-zone border border-line bg-chrome p-1 shadow-pop"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      {typeOptions.map((option) => (
        <button
          key={option.id}
          type="button"
          title={option.hint}
          aria-pressed={chosen === option.id}
          onClick={() => onChoose(option)}
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-ctl border-0 bg-transparent px-2 text-body-sm font-medium whitespace-nowrap text-fg hover:bg-chrome-2 aria-pressed:bg-accent-soft"
        >
          <Keycap action={option.action} keys={option.key} size="sm" />
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function cellCentre(
  object: string,
  camera: { x: number; y: number; scale: number },
  size: { width: number; height: number },
): Point {
  const shape = cellShapes[object];
  return shape
    ? {
        x: (shape.x - camera.x) * camera.scale + size.width / 2,
        y: (shape.y - camera.y) * camera.scale + size.height / 2,
      }
    : { x: size.width / 2, y: size.height / 2 };
}

const arrows: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

export function useCellArrows({
  spots,
  current,
  enabled,
  onJump,
  onPan,
}: {
  spots: CellSpot[];
  current: string | undefined;
  enabled: boolean;
  onJump: (object: string) => void;
  onPan: (direction: Direction) => void;
}) {
  useEffect(() => {
    if (!enabled || current === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      const direction = arrows[event.key];
      if (direction === undefined) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu]"))
        return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      event.preventDefault();
      if (event.shiftKey) {
        onPan(direction);
        return;
      }
      const next = jumpTarget(spots, current, direction);
      if (next !== undefined) onJump(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}
