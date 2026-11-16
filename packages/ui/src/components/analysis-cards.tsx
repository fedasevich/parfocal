import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { InspectorCard, RegionRow, StagingHero } from "@parfocal/ui/components/inspector";
import { ModelWarningsBlock } from "@parfocal/ui/components/model-warnings";
import { Skeleton, SkeletonLine } from "@parfocal/ui/components/skeleton";
import { NoTumorCard } from "@parfocal/ui/components/systematic-scan";
import { CategoryTag } from "@parfocal/ui/components/tag";
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
  clampToScale,
  likelySizeHigh,
  likelySizeLow,
  macroMm,
  microMm,
  type StagingCategory,
  scaleMax,
  scaleMin,
  showsStaging,
  type ViewerPartName,
} from "@parfocal/ui/lib/analysis-parts";
import type { TyperEvidence, WordingMode } from "@parfocal/ui/lib/confidence-words";
import { lazyText } from "@parfocal/ui/lib/lazy-text";
import type { ModelWarning } from "@parfocal/ui/lib/model-warnings";
import type { ScanSummary } from "@parfocal/ui/lib/systematic-scan";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";
import { useId } from "react";

const categoryIfConfirmed: Record<StagingCategory, string> = lazyText(() => ({
  macro: t`Macro if confirmed`,
  micro: t`Micro if confirmed`,
  ITC: t`ITC if confirmed`,
}));

const categoryShort: Record<StagingCategory, string> = lazyText(() => ({
  macro: t`Macro`,
  micro: t`Micro`,
  ITC: "ITC",
}));

const formatMm = (mm: number) => `${mm.toFixed(mm < 1 ? 2 : 1)} mm`;

const areaWord = (count: number) => `${count} ${count === 1 ? "area" : "areas"}`;

const areaLabel = (area: RankedArea) => `area ${area.number}`;

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
    collapsed?: boolean;
    onCollapsedChange?: (collapsed: boolean) => void;
  };

function rowKind(area: RankedArea, settled: boolean) {
  if (!settled) return t`Tumor region`;
  if (area.lead) return t`Sets the category`;
  if (area.call === "disagree") return t`Not tumor`;
  return area.canChangeCategory ? t`Tumor region` : t`Cannot change the category`;
}

type ClusterState = Extract<AiState, { kind: "small-cluster" }>;

const stepWords: Record<ClusterStepName, (number: number) => string> = {
  confirm: (number) => t`confirm area ${number}`,
  measure: () => "measure it",
  count: () => t`count its tumor cells`,
};

const joinSteps = (words: string[]) =>
  words.length > 1
    ? t`${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`
    : (words[0] ?? "");

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function stepDone(step: ClusterStepName, state: ClusterState) {
  if (step === "confirm") return t`Area ${state.lead.number} confirmed`;
  if (step === "measure") return `Measured ${formatMm(state.size)}`;
  const cells = state.lead.cells;
  return cells && cells.low > 200 ? t`Over 200 tumor cells` : t`Under 200 tumor cells`;
}

function ClusterSteps({ state }: { state: ClusterState }) {
  const { t } = useLingui();

  return (
    <ol
      data-slot="cluster-steps"
      aria-label={t`Steps to settle`}
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
          <span className="sr-only">{done ? t`, done` : t`, open`}</span>
        </li>
      ))}
    </ol>
  );
}

function scaleMarks(state: { areas: RankedArea[]; lead: RankedArea }) {
  return {
    dots: state.areas
      .filter((area) => area.call !== "disagree")
      .map((area) => ({ number: area.number, mm: clampToScale(area.shownSize) })),
    number: state.lead.number,
  };
}

const cellsMidpoint = (area: RankedArea) =>
  area.cells ? Math.round((area.cells.low + area.cells.high) / 2) : null;

function ClusterHero({ state }: { state: ClusterState }) {
  const { t } = useLingui();

  const point = clampToScale(state.size);
  const measured = state.lead.measured != null;
  if (state.phase === "settled") {
    const cells = state.lead.cells;
    const count = cells && cells.low > 200 ? "over 200" : "under 200";
    return (
      <StagingHero
        title={t`${categoryName[state.category]}, ${formatMm(state.size)}, settled`}
        category={state.pn}
        sub={t`Suggested ${state.pn}. Area ${state.lead.number} is confirmed, measured and holds ${count} tumor cells, so the smaller areas cannot change the category.`}
        range={{
          min: scaleMin,
          max: scaleMax,
          low: point,
          high: point,
          point,
          cuts: [microMm, macroMm],
          ...scaleMarks(state),
        }}
        count={{ cells: cellsMidpoint(state.lead) }}
      />
    );
  }
  const open = state.steps
    .filter((step) => !step.done)
    .map((step) => stepWords[step.step](state.lead.number));
  const chip = `${categoryShort[state.category]} ${state.lead.call === "agree" ? "so far" : "if confirmed"}`;
  return (
    <StagingHero
      title={t`Small tumor cluster, about ${formatMm(state.size)}`}
      category={chip}
      sub={t`It sits near the 0.2 mm line, so both its size and its tumor cell count decide between isolated tumor cells and a micrometastasis. To settle it, ${joinSteps(open)}.`}
      range={{
        min: scaleMin,
        max: scaleMax,
        low: measured ? point : likelySizeLow(state.size),
        high: measured ? point : likelySizeHigh(state.size),
        point,
        cuts: [microMm, macroMm],
        ...scaleMarks(state),
      }}
      count={{ cells: cellsMidpoint(state.lead) }}
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

type AreaRowsProps = AreaListProps & {
  areas: readonly RankedArea[];
  settled: boolean;
  running?: boolean;
  className?: string | undefined;
};

function AreaRows({
  areas,
  settled,
  running = false,
  current,
  visited,
  roleOf,
  onGoTo,
  className,
}: AreaRowsProps) {
  const { t } = useLingui();

  return (
    <InspectorCard
      className={cn(
        "grid content-start gap-1 overflow-auto",
        running ? "h-40" : "max-h-40",
        className,
      )}
      aria-label={t`Areas, largest first`}
    >
      {areas.map((area) => (
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
                label: areaLabel(area),
              }
            : {})}
        />
      ))}
      {running ? <AreaPlaceholder key={`next-${areas.length}`} /> : null}
    </InspectorCard>
  );
}

type AreaListOwnProps = AreaListProps & {
  areas: readonly AiArea[];
  className?: string | undefined;
};

function AreaList({ areas, ...props }: AreaListOwnProps) {
  const state = aiState({ areas });
  const settled =
    (state.kind === "pre-read" || state.kind === "small-cluster") && state.phase === "settled";
  return <AreaRows areas={state.areas} settled={settled} {...props} />;
}

type Summary = {
  title: string;
  chip?: string;
  action?: { label: string; title: string; run: () => void };
  note?: string;
};

function summaryOf(
  state: ReturnType<typeof aiState>,
  onStart: ((object: string) => void) | undefined,
  onSubmit: (() => void) | undefined,
): Summary | null {
  if (state.kind === "running")
    return { title: t`Still reading, ${areaWord(state.areas.length)} so far` };
  if (state.kind === "pre-read") {
    if (state.phase === "settled") {
      return {
        title: t`${state.pn}, ${formatMm(state.size)}, settled`,
        chip: state.pn,
        action: { label: t`Submit`, title: t`Submit`, run: () => onSubmit?.() },
      };
    }
    return {
      title: t`Metastasis likely, ${formatMm(state.size)}`,
      chip: categoryShort[state.category],
      action: {
        label: t`Start`,
        title: t`Start with area ${state.lead.number}`,
        run: () => onStart?.(state.lead.object),
      },
    };
  }
  if (state.kind === "small-cluster") {
    if (state.phase === "settled") {
      return {
        title: t`${state.pn}, ${formatMm(state.size)}, settled`,
        chip: state.pn,
        action: { label: t`Submit`, title: t`Submit`, run: () => onSubmit?.() },
      };
    }
    const done = state.steps.filter((step) => step.done).length;
    return {
      title: t`Small cluster, about ${formatMm(state.size)}`,
      chip: categoryShort[state.category],
      ...(done === 0
        ? {
            action: {
              label: t`Start`,
              title: t`Start with area ${state.lead.number}`,
              run: () => onStart?.(state.lead.object),
            },
          }
        : { note: t`${done} of ${state.steps.length} steps` }),
    };
  }
  return null;
}

function StagingSummary({
  summary,
  open,
  controls,
  onToggle,
}: {
  summary: Summary;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const { t } = useLingui();

  return (
    <div data-slot="staging-summary" className="flex min-h-10 min-w-0 items-center gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controls}
        title={open ? t`Fold the staging card` : t`Show the staging card`}
        onClick={onToggle}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent p-0 text-left text-fg outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-solid"
      >
        <span className="min-w-0 truncate text-body-sm font-semibold">{summary.title}</span>
        {summary.chip ? <CategoryTag className="shrink-0">{summary.chip}</CategoryTag> : null}
        <Icon name="down" className={cn("ml-auto shrink-0", open && "rotate-180")} />
      </button>
      {open ? null : summary.action ? (
        <Button
          variant="primary"
          size="sm"
          title={summary.action.title}
          onClick={summary.action.run}
        >
          {summary.action.label}
        </Button>
      ) : summary.note ? (
        <span className="shrink-0 text-caption text-fg-dim">{summary.note}</span>
      ) : null}
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
  collapsed = false,
  onCollapsedChange,
  className,
  ...props
}: StagingCardsProps) {
  const { t } = useLingui();

  const id = useId();
  const state = aiState({ areas, running });
  const summary = onCollapsedChange ? summaryOf(state, onStart, onSubmit) : null;
  const folded = summary !== null && collapsed;
  const staged = state.kind === "pre-read" || state.kind === "small-cluster";
  const settled = staged && state.phase === "settled";
  return (
    <section
      data-slot="staging-cards"
      data-state={state.kind}
      data-phase={staged ? state.phase : undefined}
      aria-label={t`Staging`}
      data-collapsed={folded || undefined}
      className={cn(
        "grid gap-3 border-b border-line bg-chrome",
        folded ? "px-5 py-1" : "p-5",
        className,
      )}
      {...props}
    >
      {summary ? (
        <StagingSummary
          summary={summary}
          open={!folded}
          controls={id}
          onToggle={() => onCollapsedChange?.(!collapsed)}
        />
      ) : null}
      {folded ? null : (
        <div id={id} className="grid gap-3">
          {state.kind === "running" ? (
            <div data-slot="staging-hero" className="grid gap-2">
              <h3 className="m-0 mt-0.5 text-title leading-tight font-semibold">
                <Trans>Still reading, {areaWord(state.areas.length)} so far</Trans>
              </h3>
              <p className="m-0 text-body-sm leading-normal text-fg-dim">
                <Trans>
                  Areas join the list as they are found. The category waits until the whole slide is
                  read.
                </Trans>
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
                title={t`${categoryName[state.category]}, ${formatMm(state.size)}, settled`}
                category={state.pn}
                sub={t`Suggested ${state.pn}. Area ${state.lead.number} is confirmed and measured, so the smaller areas cannot change the category.`}
                range={{
                  min: scaleMin,
                  max: scaleMax,
                  low: clampToScale(state.size),
                  high: clampToScale(state.size),
                  point: clampToScale(state.size),
                  cuts: [microMm, macroMm],
                  ...scaleMarks(state),
                }}
              />
            ) : (
              <StagingHero
                title={t`${findingWords("Metastasis", state.lead.probability, wording, typer)}, largest about ${formatMm(state.size)}`}
                category={categoryIfConfirmed[state.category]}
                sub={t`${areaWord(state.areas.length)}, largest first. Confirm and measure area ${state.lead.number} to settle the category.`}
                range={{
                  min: scaleMin,
                  max: scaleMax,
                  low: likelySizeLow(state.size),
                  high: likelySizeHigh(state.size),
                  point: clampToScale(state.size),
                  cuts: [microMm, macroMm],
                  ...scaleMarks(state),
                }}
              />
            )
          ) : (
            <NoTumorCard scan={scan} onScan={onScan} onSubmit={onSubmit} />
          )}
          <ModelWarningsBlock warnings={warnings} />
          {showList && (state.areas.length || state.kind === "running") ? (
            <AreaRows
              areas={state.areas}
              settled={settled}
              running={state.kind === "running"}
              current={current}
              visited={visited}
              roleOf={roleOf}
              onGoTo={onGoTo}
            />
          ) : null}
          {staged ? (
            <div data-slot="staging-footer" className="flex items-center justify-between gap-2">
              {settled ? (
                <>
                  <span className="text-body-sm text-fg-dim">
                    <Trans>The category is settled.</Trans>
                  </span>
                  <Button variant="primary" size="sm" onClick={onSubmit}>
                    <Trans>Submit</Trans>
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onStart ? () => onStart(state.lead.object) : undefined}
                >
                  <Trans>Start with area {state.lead.number}</Trans>
                </Button>
              )}
            </div>
          ) : null}
        </div>
      )}
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

export {
  AnalysisCards,
  type AnalysisCardsProps,
  AreaList,
  type AreaListOwnProps as AreaListProps,
  StagingCards,
  type StagingCardsProps,
};
