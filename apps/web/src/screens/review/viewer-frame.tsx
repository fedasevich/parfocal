import type { ReviewObject } from "@parfocal/api-client";
import { FactList } from "@parfocal/ui/components/inspector";
import { ProgressRing } from "@parfocal/ui/components/progress-meter";
import { SidePanel, type SidePanelTab } from "@parfocal/ui/components/side-panel";
import { FilterChip, ObjectIdTag } from "@parfocal/ui/components/tag";
import { ToolRail, ToolRailButton, ToolRailGroup } from "@parfocal/ui/components/tool-rail-button";
import { Zone } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import type { ReactNode } from "react";
import { type Count, countWord } from "./decision-style.ts";
import type { ReviewSession } from "./review-data.ts";
import type { Answer } from "./review-state.ts";
import { ReviewTop, type SlideCounts } from "./review-top.tsx";

export type ViewerTool = "select" | "hand" | "annotate" | "comment" | "ai";

const tools: {
  tool: ViewerTool;
  icon: "select" | "hand" | "pen" | "comment" | "smart";
  label: string;
  key: string;
}[] = [
  { tool: "select", icon: "select", label: "Select", key: "V" },
  { tool: "hand", icon: "hand", label: "Pan", key: "H" },
  { tool: "annotate", icon: "pen", label: "Annotate", key: "P" },
  { tool: "comment", icon: "comment", label: "Comment on an ID", key: "C" },
  { tool: "ai", icon: "smart", label: "AI tools", key: "A" },
];

type ViewerFrameProps = {
  session: ReviewSession;
  counts: SlideCounts | undefined;
  tool: ViewerTool;
  tab: string;
  onTabChange: (tab: string) => void;
  tabs: SidePanelTab[];
  children: ReactNode;
};

export function ViewerFrame({
  session,
  counts,
  tool,
  tab,
  onTabChange,
  tabs,
  children,
}: ViewerFrameProps) {
  return (
    <main className="flex h-dvh min-w-0 flex-col bg-page text-fg">
      <ReviewTop
        mode="full"
        session={session}
        counts={counts}
        submitReason={
          counts?.open
            ? `${counts.open} object${counts.open === 1 ? " is" : "s are"} still open.`
            : undefined
        }
      />
      <div className="flex min-h-0 flex-1">
        <ToolRail className="justify-between">
          <ToolRailGroup>
            {tools.map((item) => (
              <ToolRailButton
                key={item.tool}
                icon={item.icon}
                label={item.label}
                keyHint={item.key}
                ai={item.tool === "ai"}
                pressed={item.tool === tool}
              />
            ))}
          </ToolRailGroup>
          <ToolRailButton icon="panel" label="Hide the side panel" keyHint="]" />
        </ToolRail>
        <div className="relative flex min-w-0 flex-1">{children}</div>
        <SidePanel width={340} value={tab} onValueChange={onTabChange} tabs={tabs} />
      </div>
    </main>
  );
}

const legend: { key: Count | "open" | "added"; label: string; dot: string }[] = [
  { key: "agree", label: "Agree", dot: "bg-v-agree" },
  { key: "disagree", label: "Disagree", dot: "bg-v-disagree" },
  { key: "unsure", label: "Not sure", dot: "bg-v-unsure" },
  { key: "open", label: "Still open", dot: "bg-fg-faint" },
  { key: "added", label: "Added", dot: "bg-[#93c5fd]" },
];

export function ObjectsSummary({
  slideLabel,
  counts,
  added,
}: {
  slideLabel: string;
  counts: SlideCounts;
  added: string[];
}) {
  return (
    <Zone
      title={`Objects on ${slideLabel}`}
      end={
        <span className="font-mono text-caption text-fg-dim">
          {counts.decided} of {counts.total}
        </span>
      }
    >
      <div className="grid grid-cols-[64px_1fr] items-center gap-4">
        <ProgressRing split={counts} size={56} />
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {legend.map((row) => (
            <li key={row.key} className="flex items-center gap-2 text-body-sm">
              <i aria-hidden="true" className={cn("size-2.5 rounded-full", row.dot)} />
              <span className="flex-1 text-fg-dim">
                {row.key === "added" ? `${row.label}, ${added.join(", ")}` : row.label}
              </span>
              <b className="font-mono font-semibold">
                {row.key === "added" ? added.length : counts[row.key]}
              </b>
            </li>
          ))}
        </ul>
      </div>
    </Zone>
  );
}

export function AiSays({ setName, objects }: { setName: string; objects: ReviewObject[] }) {
  const regions = objects.filter((item) => item.kind === "region");
  const sizes = regions.map((item) => item.size_mm ?? 0);
  const cells = objects.length - regions.length;
  return (
    <Zone title="AI says">
      <FactList
        tight
        rows={[
          { icon: "layers", label: "Result set", value: setName },
          {
            icon: "flag",
            label: "Tumor regions",
            value: `${regions.length}, ${Math.max(...sizes).toFixed(1)} to ${Math.min(...sizes).toFixed(2)} mm`,
          },
          { icon: "target", label: "Cells", value: `18,240, ${cells} in your sample` },
        ]}
      />
    </Zone>
  );
}

const decisionDot: Record<Count, string> = {
  agree: "bg-v-agree",
  disagree: "bg-v-disagree",
  unsure: "bg-v-unsure",
};

const filters: { key: "all" | "open" | Count; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "agree", label: "Agree" },
  { key: "disagree", label: "Disagree" },
  { key: "unsure", label: "Unsure" },
];

export function ObjectList({
  objects,
  counts,
  answer,
  current,
  onPick,
}: {
  objects: ReviewObject[];
  counts: SlideCounts;
  answer: (object: string) => Answer | undefined;
  current: string | undefined;
  onPick: (object: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex gap-1.5 overflow-hidden">
        {filters.map((filter) => (
          <FilterChip key={filter.key} defaultPressed={filter.key === "all"}>
            {filter.label} {filter.key === "all" ? counts.total : counts[filter.key]}
          </FilterChip>
        ))}
      </div>
      <ul className="m-0 grid list-none gap-1 p-0">
        {objects
          .filter((item) => item.kind === "region")
          .map((item) => {
            const decided = answer(item.object);
            return (
              <li key={item.object}>
                <button
                  type="button"
                  aria-current={item.object === current ? "true" : undefined}
                  onClick={() => onPick(item.object)}
                  className="grid w-full cursor-pointer grid-cols-[44px_1fr_auto_auto] items-start gap-2 rounded-ctl border-0 bg-transparent px-1 py-2 text-left text-body-sm text-fg hover:bg-chrome-2 aria-[current=true]:bg-surf-hl"
                >
                  <ObjectIdTag>{item.object}</ObjectIdTag>
                  <span className="grid">
                    <span>Tumor region</span>
                    <small className="inline-flex items-center gap-1.5 text-caption text-fg-dim">
                      <i
                        aria-hidden="true"
                        className={cn(
                          "size-2 rounded-full",
                          decided ? decisionDot[decided.value] : "bg-fg-faint",
                        )}
                      />
                      {decided ? countWord[decided.value].toLowerCase() : "open"}
                      {decided?.reasons.length
                        ? ` · ${decided.reasons.join(", ").toLowerCase()}`
                        : ""}
                    </small>
                  </span>
                  <span className="font-mono text-fg-dim">{item.score.toFixed(2)}</span>
                  <span className="font-mono text-fg-dim">{item.size_mm?.toFixed(1)} mm</span>
                </button>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
