import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReviewObject } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { FactList } from "@parfocal/ui/components/inspector";
import { useKeyLabel } from "@parfocal/ui/components/keycap";
import { ProgressRing } from "@parfocal/ui/components/progress-meter";
import { SidePanel, type SidePanelTab } from "@parfocal/ui/components/side-panel";
import { FilterChip, ObjectIdTag } from "@parfocal/ui/components/tag";
import { ToolRail, ToolRailButton, ToolRailGroup } from "@parfocal/ui/components/tool-rail-button";
import { Zone } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import { type ReactNode, useEffect, useState } from "react";
import { useBindings } from "../../keys/personal-keys.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";
import { formatMillimetres, useLengthUnits } from "../../measure/length-units.ts";
import { useToolsLayout } from "../../shell/tools-layout.ts";
import { type Count, countWord } from "./decision-style.ts";
import { InspectorDock } from "./inspector-dock.tsx";
import { useInspectorLayout } from "./inspector-layout.ts";
import type { ReviewSession } from "./review-data.ts";
import { useRailKeys } from "./review-rail.ts";
import type { Answer } from "./review-state.ts";
import { ReviewTop, type SlideCounts } from "./review-top.tsx";

export type ViewerTool = "select" | "hand" | "annotate" | "comment" | "ai";

export type RailTool = {
  tool: string;
  icon: IconName;
  label: string;
  action?: string;
  key?: string;
  ai?: boolean;
};

function RailToolButton({
  item,
  pressed,
  onToolChange,
  tipSide,
}: {
  item: RailTool;
  pressed: boolean;
  onToolChange: ((tool: string) => void) | undefined;
  tipSide: "right" | "top";
}) {
  const keyHint = useKeyLabel(item.action, item.key);
  return (
    <ToolRailButton
      icon={item.icon}
      label={item.label}
      {...(keyHint === null ? {} : { keyHint })}
      ai={item.ai ?? false}
      tipSide={tipSide}
      pressed={pressed}
      {...(onToolChange ? { onPressedChange: () => onToolChange(item.tool) } : {})}
    />
  );
}

const tools: RailTool[] = [
  { tool: "select", icon: "select", label: "Select", action: "tselect" },
  { tool: "hand", icon: "hand", label: "Pan", action: "thand" },
  { tool: "annotate", icon: "pen", label: "Annotate", action: "annotate" },
  { tool: "comment", icon: "comment", label: "Comment on an ID", action: "tcomment" },
  { tool: "ai", icon: "smart", label: "AI tools", action: "aitools", ai: true },
];

type ViewerFrameProps = {
  session: ReviewSession;
  counts: SlideCounts | undefined;
  tool: string;
  railGroups?: RailTool[][] | undefined;
  railKeys?: Record<string, string> | undefined;
  onToolChange?: ((tool: string) => void) | undefined;
  onCompare?: (() => void) | undefined;
  overlay?: ReactNode;
  tab: string;
  onTabChange: (tab: string) => void;
  tabs?: SidePanelTab[];
  panelHead?: ReactNode;
  panel?: ReactNode;
  children: ReactNode;
  banner?: ReactNode;
  below?: ReactNode;
  topBar?: ReactNode;
  onSubmit?: () => void;
  progressSub?: string | undefined;
  scene?: string | undefined;
  panelTab?: { label: string; count?: number | undefined } | undefined;
};

export function ViewerFrame({
  session,
  counts,
  tool,
  tab,
  onTabChange,
  tabs = [],
  panelHead,
  panel,
  children,
  banner,
  below,
  topBar,
  onSubmit,
  progressSub,
  scene,
  railGroups = [tools],
  railKeys,
  onToolChange,
  onCompare,
  overlay,
  panelTab,
}: ViewerFrameProps) {
  const { t } = useLingui();
  useRailKeys(railGroups, onToolChange, railKeys);
  const [layout, setLayout] = useInspectorLayout();
  const toolsLayout = useToolsLayout();
  const docked = toolsLayout === "dock";
  const tipSide = docked ? "top" : "right";
  const [panning, setPanning] = useState(false);
  const panelBindings = useBindings(["viewer"], ["panel"]);
  useHotkeys(panelBindings, (fired) => {
    if (fired.phase === "press") setLayout((current) => ({ hidden: !current.hidden }));
  });
  useEffect(() => {
    if (!panning) return;
    const stop = () => setPanning(false);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [panning]);
  const activeTab = tabs.find((item) => item.value === tab);
  const tabLabel = panelTab?.label ?? activeTab?.label ?? "Panel";
  const tabCount = panelTab ? panelTab.count : activeTab?.count;
  return (
    <main
      className="flex h-dvh min-w-0 flex-col bg-page text-fg"
      data-testid="full-viewer"
      data-scene={scene}
      data-tools={toolsLayout}
    >
      {topBar ?? (
        <ReviewTop
          mode="full"
          session={session}
          counts={counts}
          progressSub={progressSub}
          submitReason={
            counts?.open
              ? plural(counts.open, {
                  one: "# object is still open.",
                  other: "# objects are still open.",
                })
              : undefined
          }
          {...(onSubmit ? { onSubmit } : {})}
        />
      )}
      {banner}
      <div className="relative flex min-h-0 flex-1">
        {docked ? null : (
          <ToolRail className="justify-between">
            <div className="grid gap-1">
              {railGroups.map((group) => (
                <ToolRailGroup key={group.map((item) => item.tool).join("-")}>
                  {group.map((item) => (
                    <RailToolButton
                      key={item.tool}
                      item={item}
                      pressed={item.tool === tool}
                      onToolChange={onToolChange}
                      tipSide={tipSide}
                    />
                  ))}
                </ToolRailGroup>
              ))}
            </div>
            <ToolRailGroup>
              {onCompare ? (
                <ToolRailButton
                  icon="slides"
                  label={t`Compare slides`}
                  tipSide={tipSide}
                  pressed={false}
                  onPressedChange={onCompare}
                />
              ) : null}
            </ToolRailGroup>
          </ToolRail>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            data-vt-target=""
            className="relative flex min-h-0 min-w-0 flex-1"
            onPointerDownCapture={() => {
              if (layout.hideWhilePanning && !layout.hidden) setPanning(true);
            }}
          >
            {children}
            {docked ? (
              <ToolRail layout="dock">
                {railGroups.map((group) => (
                  <ToolRailGroup key={group.map((item) => item.tool).join("-")}>
                    {group.map((item) => (
                      <RailToolButton
                        key={item.tool}
                        item={item}
                        pressed={item.tool === tool}
                        onToolChange={onToolChange}
                        tipSide={tipSide}
                      />
                    ))}
                  </ToolRailGroup>
                ))}
                <ToolRailGroup>
                  {onCompare ? (
                    <ToolRailButton
                      icon="slides"
                      label={t`Compare slides`}
                      tipSide={tipSide}
                      pressed={false}
                      onPressedChange={onCompare}
                    />
                  ) : null}
                </ToolRailGroup>
              </ToolRail>
            ) : null}
          </div>
          {below}
        </div>
        <InspectorDock
          layout={layout}
          onLayout={setLayout}
          panning={panning}
          tabLabel={tabLabel}
          tabCount={tabCount}
        >
          {panel ?? (
            <SidePanel
              width={layout.width}
              value={tab}
              onValueChange={onTabChange}
              tabs={tabs}
              head={panelHead}
            />
          )}
        </InspectorDock>
        {overlay}
      </div>
    </main>
  );
}

const legend: { key: Count | "open" | "added"; label: string; dot: string }[] = [
  { key: "agree", label: "Agree", dot: "bg-decision-agree" },
  { key: "disagree", label: "Disagree", dot: "bg-decision-disagree" },
  { key: "unsure", label: "Not sure", dot: "bg-decision-unsure" },
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
  const { t } = useLingui();
  return (
    <Zone
      data-phi=""
      title={t`Objects on ${slideLabel}`}
      end={
        <span className="font-mono text-caption text-fg-dim">
          <Trans>
            {counts.decided} of {counts.total}
          </Trans>
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
  const { t } = useLingui();
  useLengthUnits();
  const regions = objects.filter((item) => item.kind === "region");
  const sizes = regions.map((item) => item.size_mm ?? 0);
  const cells = objects.length - regions.length;
  return (
    <Zone title={t`AI says`}>
      <FactList
        tight
        rows={[
          { icon: "layers", label: "Result set", value: setName },
          {
            icon: "flag",
            label: "Tumor regions",
            value: `${regions.length}, ${formatMillimetres(Math.max(...sizes))} to ${formatMillimetres(Math.min(...sizes), 2)}`,
          },
          { icon: "target", label: "Cells", value: `18,240, ${cells} in your sample` },
        ]}
      />
    </Zone>
  );
}

const decisionDot: Record<Count, string> = {
  agree: "bg-decision-agree",
  disagree: "bg-decision-disagree",
  unsure: "bg-decision-unsure",
};

export type ListFilter = "all" | "open" | Count | "added";

const filters: { key: ListFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "agree", label: "Agree" },
  { key: "disagree", label: "Disagree" },
  { key: "unsure", label: "Unsure" },
  { key: "added", label: "Added" },
];

const filterWord: Record<Exclude<ListFilter, "all">, string> = {
  open: "open",
  agree: "agree",
  disagree: "disagree",
  unsure: "not sure",
  added: "added",
};

export type AddedRow = { object: string; size: string; note: string | null };

export type MeasurementRow = { object: string; mm: number; across: string; length?: string };

type ObjectListProps = {
  objects: ReviewObject[];
  counts: SlideCounts;
  answer: (object: string) => Answer | undefined;
  current: string | undefined;
  onPick: (object: string) => void;
  filter?: ListFilter;
  onFilterChange?: (filter: ListFilter) => void;
  showScore?: boolean;
  added?: AddedRow[];
  onOpenCells?: () => void;
  notes?: (object: string) => boolean;
  measurements?: MeasurementRow[];
};

export function ObjectList({
  objects,
  counts,
  answer,
  current,
  onPick,
  filter,
  onFilterChange,
  showScore = true,
  added = [],
  onOpenCells,
  notes,
  measurements = [],
}: ObjectListProps) {
  const { t } = useLingui();
  useLengthUnits();
  const shown = filter ?? "all";
  const matches = (object: string) => {
    if (shown === "all") return true;
    if (shown === "added") return false;
    const value = answer(object)?.value;
    return shown === "open" ? value === undefined : value === shown;
  };
  const regions = objects.filter((item) => item.kind === "region" && matches(item.object));
  const cells = objects.filter((item) => item.kind === "cell");
  const cellsHit = cells.filter((cell) => matches(cell.object)).length;
  const cellsDone = cells.filter((cell) => answer(cell.object)).length;
  const addedShown = shown === "all" || shown === "added" ? added : [];
  const cellWord = shown === "all" ? `${cells.length} sampled` : `${cellsHit} ${filterWord[shown]}`;
  const empty = regions.length === 0 && addedShown.length === 0 && !(onOpenCells && cellsHit);
  const row =
    "grid w-full cursor-pointer grid-cols-[44px_1fr_auto_auto] items-start gap-2 rounded-ctl border-0 bg-transparent px-1 py-2 text-left text-body-sm text-fg hover:bg-chrome-2 aria-[current=true]:bg-surf-hl";
  return (
    <div data-testid="object-list" className="grid gap-3">
      <fieldset aria-label={t`Show`} className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
        {filters
          .filter((item) => item.key !== "added" || added.length > 0)
          .map((item) => (
            <FilterChip
              key={item.key}
              {...(filter === undefined
                ? { defaultPressed: item.key === "all" }
                : {
                    pressed: item.key === shown,
                    onPressedChange: () => onFilterChange?.(item.key),
                  })}
            >
              {item.label}{" "}
              {item.key === "all"
                ? counts.total
                : item.key === "added"
                  ? added.length
                  : counts[item.key]}
            </FilterChip>
          ))}
      </fieldset>
      <ul className="m-0 grid list-none gap-1 p-0">
        {regions.map((item) => {
          const decided = answer(item.object);
          return (
            <li
              key={item.object}
              data-testid="object-row"
              data-object={item.object}
              data-decision={decided?.value ?? ""}
            >
              <button
                type="button"
                aria-current={item.object === current ? "true" : undefined}
                onClick={() => onPick(item.object)}
                className={row}
              >
                <ObjectIdTag>{item.object}</ObjectIdTag>
                <span className="grid">
                  <span>
                    <Trans>Tumor region</Trans>
                  </span>
                  <small className="inline-flex items-center gap-1.5 text-caption text-fg-dim">
                    <i
                      aria-hidden="true"
                      className={cn(
                        "size-2 rounded-full",
                        decided ? decisionDot[decided.value] : "bg-fg-faint",
                      )}
                    />
                    {decided ? countWord[decided.value].toLowerCase() : t`open`}
                    {decided?.reasons.length
                      ? ` · ${decided.reasons.join(", ").toLowerCase()}`
                      : ""}
                    {notes?.(item.object) || decided?.note ? (
                      <Icon name="comment" size="xs" label={t`Has a note`} />
                    ) : null}
                  </small>
                </span>
                <span className="font-mono text-fg-dim">
                  {showScore ? item.score.toFixed(2) : ""}
                </span>
                <span className="font-mono text-fg-dim">
                  {formatMillimetres(item.size_mm ?? 0)}
                </span>
              </button>
            </li>
          );
        })}
        {onOpenCells && cellsHit ? (
          <li data-testid="object-row-cells">
            <div
              aria-current={current?.includes("·") ? "true" : undefined}
              className="grid grid-cols-[44px_1fr_auto] items-center gap-2 rounded-ctl px-1 py-2 text-body-sm aria-[current=true]:bg-surf-hl"
            >
              <Icon name="target" className="justify-self-center text-fg-dim" />
              <span className="grid">
                <b className="font-semibold">
                  <Trans>Cells, {cellWord}</Trans>
                </b>
                <small className="text-caption text-fg-dim">
                  <Trans>
                    {cellsDone} of {cells.length} decided
                  </Trans>
                </small>
              </span>
              <Button size="sm" onClick={onOpenCells}>
                <Trans>Show the cells</Trans>
              </Button>
            </div>
          </li>
        ) : null}
        {addedShown.map((item) => (
          <li key={item.object}>
            <button
              type="button"
              aria-current={item.object === current ? "true" : undefined}
              onClick={() => onPick(item.object)}
              className={row}
            >
              <ObjectIdTag className="border-[#93c5fd]">{item.object}</ObjectIdTag>
              <span className="grid">
                <span>
                  <Trans>Tumor region</Trans>
                </span>
                <small className="inline-flex items-center gap-1.5 text-caption text-fg-dim">
                  <i aria-hidden="true" className="size-2 rounded-full bg-[#93c5fd]" />
                  <Trans>added by you</Trans>
                </small>
              </span>
              <span />
              <span className="font-mono text-fg-dim">{item.size}</span>
            </button>
          </li>
        ))}
        {(shown === "all" ? measurements : []).map((item) => (
          <li key={item.object} data-testid="object-row" data-object={item.object}>
            <button
              type="button"
              aria-current={item.object === current ? "true" : undefined}
              onClick={() => onPick(item.object)}
              className={row}
            >
              <ObjectIdTag>{item.object}</ObjectIdTag>
              <span className="grid">
                <span>
                  <Trans>Measurement</Trans>
                </span>
                <small className="inline-flex items-center gap-1.5 text-caption text-fg-dim">
                  <i aria-hidden="true" className="size-2 rounded-full bg-fg-faint" />
                  {item.across ? <Trans>ruler, across {item.across}</Trans> : <Trans>ruler</Trans>}
                </small>
              </span>
              <span />
              <span className="font-mono text-fg-dim">
                {item.length ?? formatMillimetres(item.mm, 2)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {empty ? (
        <p className="m-0 text-body-sm text-fg-dim">
          {shown === "open"
            ? t`Nothing open on this slide.`
            : t`Nothing marked ${filterWord[shown as Exclude<ListFilter, "all">]} on this slide.`}
        </p>
      ) : null}
    </div>
  );
}
