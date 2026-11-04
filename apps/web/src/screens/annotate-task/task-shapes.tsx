import { classOf, type TaskObject } from "./fake-task.ts";

type TaskShapesProps = {
  objects: TaskObject[];
  selected: string | null;
  pendingIds?: readonly string[];
};

const badgeRadius = 7;

function Badge({ object }: { object: TaskObject }) {
  if (object.origin === "ai") return null;
  const fill =
    object.origin === "ai-confirmed"
      ? "var(--ok)"
      : object.origin === "ai-edited"
        ? "var(--warn)"
        : (object.author?.color ?? "var(--accent)");
  const { x, y } = object;
  return (
    <g data-badge={object.origin} pointerEvents="none">
      <circle cx={x} cy={y} r={badgeRadius} fill={fill} stroke="#fff" strokeWidth={1.6} />
      {object.origin === "ai-confirmed" ? (
        <path
          d={`M${x - 3.2},${y + 0.2}L${x - 0.9},${y + 2.6}L${x + 3.4},${y - 2.4}`}
          fill="none"
          stroke="#fff"
          strokeWidth={1.8}
        />
      ) : object.origin === "ai-edited" ? (
        <path
          d={`M${x - 3},${y + 3}L${x - 3},${y + 0.6}L${x + 1.8},${y - 4}L${x + 4},${y - 1.8}L${x - 0.6},${y + 3}Z`}
          fill="#fff"
        />
      ) : (
        <text
          x={x}
          y={y + 2.6}
          textAnchor="middle"
          fontSize={7}
          fontWeight={700}
          fill="#fff"
          style={{ font: "700 7px sans-serif" }}
        >
          {object.author?.initials.slice(0, 1)}
        </text>
      )}
    </g>
  );
}

export function TaskShapes({ objects, selected, pendingIds = [] }: TaskShapesProps) {
  return (
    <g data-layer="task-objects">
      {objects
        .filter((object) => object.check !== "deleted")
        .map((object) => {
          const colour = classOf[object.classKey].colour;
          const unchecked = object.kind === "ai" && object.check === "unchecked";
          const chosen = object.id === selected;
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
                fillOpacity={unchecked ? 0.1 : 0.22}
                stroke="#fff"
                strokeWidth={chosen ? 8 : 5}
                strokeOpacity={0.9}
                strokeLinejoin="round"
                pointerEvents="none"
              />
              <path
                d={object.path}
                fill="none"
                stroke={colour}
                strokeWidth={2.5}
                strokeDasharray={unchecked ? "6 4" : undefined}
                strokeLinejoin="round"
                pointerEvents="none"
              />
              <Badge object={object} />
              {pendingIds.includes(object.id) ? (
                <circle
                  data-pending={object.id}
                  cx={object.x}
                  cy={object.y}
                  r={16}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  strokeDasharray="3 4"
                  pointerEvents="none"
                />
              ) : null}
              {object.changedBy ? (
                <circle
                  data-changed={object.id}
                  cx={object.x + 10}
                  cy={object.y - 10}
                  r={4.5}
                  fill="var(--accent)"
                  stroke="#fff"
                  strokeWidth={1.6}
                  pointerEvents="none"
                />
              ) : null}
            </g>
          );
        })}
    </g>
  );
}
