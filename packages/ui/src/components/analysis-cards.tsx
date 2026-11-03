import { Button } from "@parfocal/ui/components/button";
import { InspectorCard, RegionRow, StagingHero } from "@parfocal/ui/components/inspector";
import { ModelWarningsBlock } from "@parfocal/ui/components/model-warnings";
import { Skeleton, SkeletonLine } from "@parfocal/ui/components/skeleton";
import {
  type AiArea,
  aiState,
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
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

const categoryIfConfirmed: Record<StagingCategory, string> = {
  macro: "Macro if confirmed",
  micro: "Micro if confirmed",
  ITC: "ITC if confirmed",
};

const formatMm = (mm: number) => `${mm.toFixed(1)} mm`;

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
  };

function rowKind(area: RankedArea, settled: boolean) {
  if (!settled) return "Tumor region";
  if (area.lead) return "Sets the category";
  if (area.call === "disagree") return "Not tumor";
  return area.canChangeCategory ? "Tumor region" : "Cannot change the category";
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
  current,
  visited,
  roleOf,
  onGoTo,
  className,
  ...props
}: StagingCardsProps) {
  const state = aiState({ areas, running });
  const settled = state.kind === "pre-read" && state.phase === "settled";
  return (
    <section
      data-slot="staging-cards"
      data-state={state.kind}
      data-phase={state.kind === "pre-read" ? state.phase : undefined}
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
        <p className="m-0 text-body-sm text-fg-dim">No tumor areas found on this slide.</p>
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
      {state.kind === "pre-read" ? (
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
