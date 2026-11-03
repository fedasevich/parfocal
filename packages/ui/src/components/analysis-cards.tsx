import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { InspectorCard, RegionRow, StagingHero } from "@parfocal/ui/components/inspector";
import { ModelWarningsBlock } from "@parfocal/ui/components/model-warnings";
import { Skeleton, SkeletonLine } from "@parfocal/ui/components/skeleton";
import { NoTumorCard } from "@parfocal/ui/components/systematic-scan";
import {
  type AiArea,
  type AiState,
  aiState,
  type ClusterStep,
  type ClusterStepName,
  categoryName,
  findingWords,
  type RankedArea,
} from "@parfocal/ui/lib/ai-state";
import {
  aiSizeError,
  macroMm,
  microMm,
  type StagingCategory,
  scaleMax,
  scaleMin,
  showsStaging,
  type ViewerPartName,
} from "@parfocal/ui/lib/analysis-parts";
import type { TyperEvidence, WordingMode } from "@parfocal/ui/lib/confidence-words";
import type { ModelWarning } from "@parfocal/ui/lib/model-warnings";
import type { ScanSummary } from "@parfocal/ui/lib/systematic-scan";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

const categoryIfConfirmed: Record<StagingCategory, string> = {
  macro: "Macro if confirmed",
  micro: "Micro if confirmed",
  ITC: "ITC if confirmed",
};

const categoryShort: Record<StagingCategory, string> = {
  macro: "Macro",
  micro: "Micro",
  ITC: "ITC",
};

const formatMm = (mm: number) => `${mm.toFixed(mm < 1 ? 2 : 1)} mm`;

const clampToScale = (mm: number) => Math.min(scaleMax, Math.max(scaleMin, mm));

const areaWord = (count: number) => `${count} ${count === 1 ? "area" : "areas"}`;

const areaLabel = (
  area: RankedArea,
  role: string | undefined,
  visited: ReadonlySet<string> | undefined,
) =>
  [
    `${area.object}, area ${area.number}`,
    formatMm(area.shownSize),
    area.category,
    ...(role ? [role] : []),
    ...(visited?.has(area.object) ? ["visited"] : []),
  ].join(", ");

type AreaListProps = {
  current?: string | null | undefined;
  visited?: ReadonlySet<string> | undefined;
  roleOf?: ((object: string) => string | undefined) | undefined;
  onGoTo?: ((object: string) => void) | undefined;
};

type StagingCardsProps = React.ComponentProps<"section"> &
  AreaListProps & {
    areas: readonly AiArea[];
    running?: boolean;
    showList?: boolean;
    wording?: WordingMode;
    typer?: TyperEvidence;
    warnings?: readonly ModelWarning[];
    onStart?: (object: string) => void;
    onSubmit?: () => void;
    scan?: ScanSummary | null;
    onScan?: () => void;
  };

function rowKind(area: RankedArea, settled: boolean) {
  if (!settled) return "Tumor region";
  if (area.lead) return "Sets the category";
  if (area.call === "disagree") return "Not tumor";
  return area.canChangeCategory ? "Tumor region" : "Cannot change the category";
}

type ClusterState = Extract<AiState, { kind: "small-cluster" }>;

const stepWords: Record<ClusterStepName, (number: number) => string> = {
  confirm: (number) => `confirm area ${number}`,
  measure: () => "measure it",
  count: () => "count its tumor cells",
};

const joinSteps = (words: string[]) =>
  words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : (words[0] ?? "");

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function stepDone(step: ClusterStepName, state: ClusterState) {
  if (step === "confirm") return `Area ${state.lead.number} confirmed`;
  if (step === "measure") return `Measured ${formatMm(state.size)}`;
  const cells = state.lead.cells;
  return cells && cells.low > 200 ? "Over 200 tumor cells" : "Under 200 tumor cells";
}

function ClusterSteps({ state }: { state: ClusterState }) {
  return (
    <ol
      data-slot="cluster-steps"
      aria-label="Steps to settle"
      className="m-0 grid list-none gap-1 p-0"
    >
      {state.steps.map(({ step, done }: ClusterStep) => (
        <li
          key={step}
          data-step={step}
          data-done={done || undefined}
          className={cn(
            "flex items-center gap-2 text-body-sm",
            done ? "text-fg-dim" : "font-semibold text-fg",
          )}
        >
          {done ? (
            <Icon name="check" className="text-ok" />
          ) : (
            <span aria-hidden="true" className="size-3.5 rounded-full border border-line-strong" />
          )}
          <span>{done ? stepDone(step, state) : capital(stepWords[step](state.lead.number))}</span>
          <span className="sr-only">{done ? ", done" : ", open"}</span>
        </li>
      ))}
    </ol>
  );
}

function ClusterHero({ state }: { state: ClusterState }) {
  const point = clampToScale(state.size);
  const measured = state.lead.measured != null;
  if (state.phase === "settled") {
    const cells = state.lead.cells;
    const count = cells && cells.low > 200 ? "over 200" : "under 200";
    return (
      <StagingHero
        title={`${categoryName[state.category]}, ${formatMm(state.size)}, settled`}
        category={state.pn}
        sub={`Suggested ${state.pn}. Area ${state.lead.number} is confirmed, measured and holds ${count} tumor cells, so the smaller areas cannot change the category.`}
        range={{
          min: scaleMin,
          max: scaleMax,
          low: point,
          high: point,
          point,
          cuts: [microMm, macroMm],
        }}
      />
    );
  }
  const open = state.steps
    .filter((step) => !step.done)
    .map((step) => stepWords[step.step](state.lead.number));
  const chip = `${categoryShort[state.category]} ${state.lead.call === "agree" ? "so far" : "if confirmed"}`;
  return (
    <StagingHero
      title={`Small tumor cluster, about ${formatMm(state.size)}`}
      category={chip}
      sub={`It sits near the 0.2 mm line, so both its size and its tumor cell count decide between isolated tumor cells and a micrometastasis. To settle it, ${joinSteps(open)}.`}
      range={{
        min: scaleMin,
        max: scaleMax,
        low: measured ? point : clampToScale(state.size * (1 - aiSizeError)),
        high: measured ? point : clampToScale(state.size * (1 + aiSizeError)),
        point,
        cuts: [microMm, macroMm],
      }}
    />
  );
}

function AreaPlaceholder() {
  return (
    <div
      aria-hidden="true"
      data-testid="next-area"
      className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 px-2 py-1.5 text-body-sm"
    >
      <Skeleton className="h-(--tag-h) w-8 rounded-sm" />
      <SkeletonLine width="6em" />
      <SkeletonLine width="5ch" className="font-mono" />
    </div>
  );
}

function StagingCards({
  areas,
  running = false,
  showList = true,
  wording = "plain",
  typer,
  warnings = [],
  onStart,
  onSubmit,
  scan,
  onScan,
  current,
  visited,
  roleOf,
  onGoTo,
  className,
  ...props
}: StagingCardsProps) {
  const state = aiState({ areas, running });
  const staged = state.kind === "pre-read" || state.kind === "small-cluster";
  const settled = staged && state.phase === "settled";
  return (
    <section
      data-slot="staging-cards"
      data-state={state.kind}
      data-phase={staged ? state.phase : undefined}
      aria-label="Staging"
      className={cn("grid gap-3 border-b border-line bg-chrome p-5", className)}
      {...props}
    >
      {state.kind === "running" ? (
        <div data-slot="staging-hero" className="grid gap-2">
          <h3 className="m-0 mt-0.5 text-title leading-tight font-semibold">
            Still reading, {areaWord(state.areas.length)} so far
          </h3>
          <p className="m-0 text-body-sm leading-normal text-fg-dim">
            Areas join the list as they are found. The category waits until the whole slide is read.
          </p>
        </div>
      ) : state.kind === "small-cluster" ? (
        <>
          <ClusterHero state={state} />
          {settled ? null : <ClusterSteps state={state} />}
        </>
      ) : state.kind === "pre-read" ? (
        settled ? (
          <StagingHero
            title={`${categoryName[state.category]}, ${formatMm(state.size)}, settled`}
            category={state.pn}
            sub={`Suggested ${state.pn}. Area ${state.lead.number} is confirmed and measured, so the smaller areas cannot change the category.`}
            range={{
              min: scaleMin,
              max: scaleMax,
              low: clampToScale(state.size),
              high: clampToScale(state.size),
              point: clampToScale(state.size),
              cuts: [microMm, macroMm],
            }}
          />
        ) : (
          <StagingHero
            title={`${findingWords("Metastasis", state.lead.probability, wording, typer)}, largest about ${formatMm(state.size)}`}
            category={categoryIfConfirmed[state.category]}
            sub={`${areaWord(state.areas.length)}, largest first. Confirm and measure area ${state.lead.number} to settle the category.`}
            range={{
              min: scaleMin,
              max: scaleMax,
              low: clampToScale(state.size * (1 - aiSizeError)),
              high: clampToScale(state.size * (1 + aiSizeError)),
              point: clampToScale(state.size),
              cuts: [microMm, macroMm],
            }}
          />
        )
      ) : (
        <NoTumorCard scan={scan} onScan={onScan} onSubmit={onSubmit} />
      )}
      <ModelWarningsBlock warnings={warnings} />
      {showList && (state.areas.length || state.kind === "running") ? (
        <InspectorCard
          className={cn(
            "grid content-start gap-1 overflow-auto",
            state.kind === "running" ? "h-40" : "max-h-40",
          )}
          aria-label="Areas, largest first"
        >
          {state.areas.map((area) => (
            <RegionRow
              key={area.object}
              data-area={area.object}
              objectId={area.object}
              kind={rowKind(area, settled)}
              size={formatMm(area.shownSize)}
              category={area.category}
              selected={onGoTo ? current === area.object : area.lead}
              note={roleOf?.(area.object)}
              visited={visited?.has(area.object) ?? false}
              {...(onGoTo
                ? {
                    onSelect: () => onGoTo(area.object),
                    label: areaLabel(area, roleOf?.(area.object), visited),
                  }
                : {})}
            />
          ))}
          {state.kind === "running" ? <AreaPlaceholder key={`next-${state.areas.length}`} /> : null}
        </InspectorCard>
      ) : null}
      {staged ? (
        <div data-slot="staging-footer" className="flex items-center justify-between gap-2">
          {settled ? (
            <>
              <span className="text-body-sm text-fg-dim">The category is settled.</span>
              <Button variant="primary" size="sm" onClick={onSubmit}>
                Submit
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={onStart ? () => onStart(state.lead.object) : undefined}
            >
              Start with area {state.lead.number}
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}

type AnalysisCardsProps = Omit<StagingCardsProps, "showList"> & {
  parts: readonly ViewerPartName[];
};

function AnalysisCards({ parts, ...props }: AnalysisCardsProps) {
  if (!showsStaging(parts)) return null;
  return <StagingCards showList={parts.includes("area-list")} {...props} />;
}

export { AnalysisCards, type AnalysisCardsProps, StagingCards, type StagingCardsProps };
