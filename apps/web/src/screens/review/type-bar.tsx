import { Keycap } from "@parfocal/ui/components/keycap";
import { actionOf } from "../../keys/actions.ts";
import { useBindings } from "../../keys/personal-keys.ts";
import type { Fired } from "../../keys/registry.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";
import { inLayer } from "./answer-keys.ts";
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
  disabledReason?: string | undefined;
};

export function TypeBar({
  object,
  centre,
  scale,
  size,
  chosen,
  onChoose,
  disabledReason,
}: TypeBarProps) {
  const width = Math.min(size.width - 24, typeOptions.length * buttonWidth + 16);
  const box = placeBar(centre, ringRadius * scale, { width, height: barHeight }, size);
  return (
    <div
      role="toolbar"
      aria-label={`Type for ${object}`}
      data-testid="cell-type-bar"
      title={disabledReason}
      className="absolute z-4 flex items-center gap-1 rounded-zone border border-line bg-chrome p-1 shadow-pop"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      {typeOptions.map((option) => (
        <button
          key={option.id}
          type="button"
          title={disabledReason ?? option.hint}
          disabled={disabledReason !== undefined}
          aria-pressed={chosen === option.id}
          onClick={() => onChoose(option)}
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-ctl border-0 bg-transparent px-2 text-body-sm font-medium whitespace-nowrap text-fg hover:bg-chrome-2 aria-pressed:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
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

const directions = new Set<string>(["left", "right", "up", "down"]);
const arrowActions = ["dnear", "dpan"];

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
  const bindings = useBindings(["review"], arrowActions, enabled && current !== undefined);
  useHotkeys(bindings, (fired: Fired) => {
    if (fired.phase !== "press" || current === undefined || inLayer()) return;
    const { id, suffix } = actionOf(fired.action);
    if (!directions.has(suffix)) return;
    const direction = suffix as Direction;
    if (id === "dpan") {
      onPan(direction);
      return;
    }
    const next = jumpTarget(spots, current, direction);
    if (next !== undefined) onJump(next);
  });
}
