import { cn } from "cn";
import type * as React from "react";

type FlowNodeKind = "root" | "screen" | "step" | "end";

type FlowNode = {
  id: string;
  x: number;
  y: number;
  title: string;
  sub?: string;
  kind: FlowNodeKind;
  w: number;
  h: number;
  dim?: boolean;
};

type Side = "t" | "b" | "l" | "r";

type FlowEdge = { from: string; to: string; label?: string; out?: Side; in?: Side };

const nodeStyles: Record<FlowNodeKind, string> = {
  root: "border-transparent bg-chrome-3 font-semibold text-fg",
  screen: "border-accent bg-accent-soft text-fg",
  step: "border-line-strong bg-chrome text-fg",
  end: "border-ok bg-[color-mix(in_srgb,var(--ok)_14%,transparent)] text-fg",
};

function anchor(node: FlowNode, side: Side) {
  if (side === "t") return { x: node.x + node.w / 2, y: node.y };
  if (side === "b") return { x: node.x + node.w / 2, y: node.y + node.h };
  if (side === "l") return { x: node.x, y: node.y + node.h / 2 };
  return { x: node.x + node.w, y: node.y + node.h / 2 };
}

function edgePath(from: FlowNode, to: FlowNode, out: Side, into: Side) {
  const a = anchor(from, out);
  const b = anchor(to, into);
  const vertical = out === "t" || out === "b";
  const mid = vertical ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
  if (out === "r" && into === "l") {
    const midX = (a.x + b.x) / 2;
    return { d: `M${a.x},${a.y} H${midX} V${b.y} H${b.x}`, label: { x: midX, y: (a.y + b.y) / 2 } };
  }
  return {
    d: `M${a.x},${a.y} L${mid.x},${mid.y} L${b.x},${b.y}`,
    label: { x: (a.x + mid.x) / 2 + 6, y: (a.y + mid.y) / 2 },
  };
}

type FlowMapProps = Omit<React.ComponentProps<"div">, "onSelect"> & {
  nodes: FlowNode[];
  edges: FlowEdge[];
  width: number;
  height: number;
  onOpen?: (id: string) => void;
};

function FlowMap({ nodes, edges, width, height, onOpen, className, ...props }: FlowMapProps) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (
    <div
      data-slot="flow-map"
      className={cn("relative overflow-auto rounded-zone bg-surf-page", className)}
      {...props}
    >
      <div className="relative" style={{ width, height }}>
        <svg
          aria-hidden="true"
          className="absolute inset-0 overflow-visible"
          width={width}
          height={height}
        >
          <defs>
            <marker
              id="flow-map-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="var(--line-strong)" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;
            const path = edgePath(from, to, edge.out ?? "r", edge.in ?? "l");
            return (
              <g key={`${edge.from}-${edge.to}`}>
                <path
                  d={path.d}
                  fill="none"
                  stroke="var(--line-strong)"
                  strokeWidth={1.5}
                  markerEnd="url(#flow-map-arrow)"
                />
                {edge.label ? (
                  <text
                    x={path.label.x}
                    y={path.label.y}
                    fontSize={12}
                    fill="var(--fg-dim)"
                    fontFamily="var(--font-ui)"
                  >
                    {edge.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {nodes.map((node) =>
          node.kind === "root" ? (
            <div
              key={node.id}
              className={cn(
                "absolute grid place-items-center rounded-zone border text-body-sm",
                nodeStyles.root,
              )}
              style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
            >
              {node.title}
            </div>
          ) : (
            <button
              key={node.id}
              type="button"
              aria-disabled={node.dim || undefined}
              onClick={() => (node.dim ? undefined : onOpen?.(node.id))}
              className={cn(
                "absolute grid cursor-pointer content-center gap-0.5 rounded-zone border px-2.5 text-left text-body-sm font-medium outline-none hover:shadow-[0_0_0_2px_var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                nodeStyles[node.kind],
                node.dim && "cursor-not-allowed opacity-45 hover:shadow-none",
              )}
              style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
            >
              <span className="leading-tight">{node.title}</span>
              {node.sub ? <small className="text-caption text-fg-dim">{node.sub}</small> : null}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export { type FlowEdge, FlowMap, type FlowMapProps, type FlowNode, type FlowNodeKind };
