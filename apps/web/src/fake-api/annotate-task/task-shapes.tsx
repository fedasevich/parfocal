import { classOf, type TaskObject } from "./fake-task.ts";

type TaskShapesProps = {
  objects: TaskObject[];
  selected: string | null;
  scale: number;
  showOrigins: boolean;
  pendingIds?: readonly string[];
};

const badgeRadius = 6;
const dotRadius = 3;

const anchorCache = new WeakMap<TaskObject, { x: number; y: number }>();

function topRightVertex(object: TaskObject) {
  const cached = anchorCache.get(object);
  if (cached) return cached;
  const numbers = (object.path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  let best = { x: object.x, y: object.y };
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    const x = numbers[index] ?? object.x;
    const y = numbers[index + 1] ?? object.y;
    if (x - y > best.x - best.y) best = { x, y };
  }
  anchorCache.set(object, best);
  return best;
}

function anchorOf(object: TaskObject, gap: number) {
  const vertex = topRightVertex(object);
  const dx = vertex.x - object.x;
  const dy = vertex.y - object.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: vertex.x + (dx / length) * gap, y: vertex.y + (dy / length) * gap };
}

const originFill = (object: TaskObject) =>
  object.origin === "ai-confirmed"
    ? "var(--ok)"
    : object.origin === "ai-edited"
      ? "var(--warn)"
      : (object.author?.color ?? "var(--accent)");

function BadgeGlyph({ object }: { object: TaskObject }) {
  if (object.origin === "ai-confirmed") {
    return <path d="M-2.8,0.2L-0.8,2.2L3,-2.2" fill="none" stroke="#fff" strokeWidth={1.6} />;
  }
  if (object.origin === "ai-edited") {
    return <path d="M-2.6,2.6L-2.6,0.5L1.6,-3.5L3.5,-1.6L-0.5,2.6Z" fill="#fff" />;
  }
  return (
    <text y={2.4} textAnchor="middle" fill="#fff" style={{ font: "700 7px sans-serif" }}>
      {object.author?.initials.slice(0, 1)}
    </text>
  );
}

function Badge({ object, scale, full }: { object: TaskObject; scale: number; full: boolean }) {
  if (object.origin === "ai") return null;
  const radius = full ? badgeRadius : dotRadius;
  const { x, y } = anchorOf(object, (radius + 2) / scale);
  return (
    <g
      data-badge={object.origin}
      transform={`translate(${x} ${y}) scale(${1 / scale})`}
      pointerEvents="none"
    >
      <circle r={radius} fill={originFill(object)} stroke="#fff" strokeWidth={full ? 1.5 : 1} />
      {full ? <BadgeGlyph object={object} /> : null}
    </g>
  );
}

function ChangedDot({ object, scale, gap }: { object: TaskObject; scale: number; gap: number }) {
  const { x, y } = anchorOf(object, gap / scale);
  return (
    <circle
      data-changed={object.id}
      transform={`translate(${x} ${y}) scale(${1 / scale})`}
      r={4.5}
      fill="var(--accent)"
      stroke="#fff"
      strokeWidth={1.6}
      pointerEvents="none"
    />
  );
}

export function TaskShapes({
  objects,
  selected,
  scale,
  showOrigins,
  pendingIds = [],
}: TaskShapesProps) {
  return (
    <g data-layer="task-objects">
      {objects
        .filter((object) => object.check !== "deleted")
        .map((object) => {
          const colour = classOf[object.classKey].colour;
          const unchecked = object.kind === "ai" && object.check === "unchecked";
          const chosen = object.id === selected;
          const human = showOrigins && object.origin === "human";
          return (
            <g
              key={object.id}
              data-object={object.id}
              data-origin={object.origin}
              data-selected={chosen || undefined}
            >
              <path
                d={object.path}
                fill={colour}
                fillOpacity={chosen ? 0.12 : unchecked ? 0.03 : 0.05}
                stroke="#fff"
                strokeWidth={chosen ? 5 : 3}
                strokeOpacity={chosen ? 0.9 : 0.6}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
              {human ? (
                <path
                  d={object.path}
                  fill="none"
                  stroke={object.author?.color ?? "var(--accent)"}
                  strokeWidth={3.5}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              ) : null}
              <path
                d={object.path}
                fill="none"
                stroke={colour}
                strokeWidth={1.5}
                strokeDasharray={unchecked ? "5 3" : undefined}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
              {showOrigins ? <Badge object={object} scale={scale} full={chosen} /> : null}
              {pendingIds.includes(object.id) ? (
                <circle
                  data-pending={object.id}
                  cx={object.x}
                  cy={object.y}
                  r={16 / scale}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  strokeDasharray="3 4"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              ) : null}
              {object.changedBy ? (
                <ChangedDot
                  object={object}
                  scale={scale}
                  gap={showOrigins ? badgeRadius * 2 + 6 : 6}
                />
              ) : null}
            </g>
          );
        })}
    </g>
  );
}
