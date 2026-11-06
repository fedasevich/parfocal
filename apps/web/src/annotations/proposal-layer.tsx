import { useSyncExternalStore } from "react";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { slideToScreen } from "../viewer/viewer-engine.ts";
import type { Proposal } from "./proposals.ts";
import { at } from "./shapes.ts";
import { useStageRect } from "./stage-size.ts";

type ProposalLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  proposals: readonly Proposal[];
};

const nearBlack = "#0b0b0b";
const dash = "6 4";

export function ProposalLayer({ engine, stage, proposals }: ProposalLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  if (proposals.length === 0) return null;

  return (
    <svg
      data-testid="proposal-layer"
      data-proposals={proposals.length}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {proposals.map((proposal) => {
        const vertices = proposal.ring.length >> 1;
        const ring: string[] = [];
        for (let index = 0; index < vertices; index++) {
          const where = slideToScreen(camera, rect, {
            x: at(proposal.ring, index * 2),
            y: at(proposal.ring, index * 2 + 1),
          });
          ring.push(`${where.x},${where.y}`);
        }
        const points = ring.join(" ");
        return (
          <g key={`${proposal.runId}:${proposal.piece}`} data-testid="proposal">
            <polygon points={points} fill="none" stroke="#fff" strokeWidth={3.5} />
            <polygon
              points={points}
              fill="none"
              stroke={nearBlack}
              strokeWidth={1.5}
              strokeDasharray={dash}
            />
          </g>
        );
      })}
    </svg>
  );
}
