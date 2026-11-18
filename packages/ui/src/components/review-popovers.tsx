import type { MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import {
  type DecisionSplit,
  ProgressBar,
  ProgressRing,
} from "@parfocal/ui/components/progress-meter";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Zone } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type ProgressPopoverProps = {
  taskCode: string;
  taskName: string;
  taskSub: string;
  slideName: string;
  slide: DecisionSplit & { decided: number; total: number };
  added?: readonly string[] | undefined;
  seenPercent?: number | undefined;
  onWholeSlide?: (() => void) | undefined;
  wholeSlideTitle?: string | undefined;
  position: number;
  slideTotal: number;
  submittedCount: number;
  dueText: string;
  timeLeft: string;
  guided?: boolean;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  className?: string;
};

const legendRows = [
  { key: "agree", label: msg`Agree`, dot: "bg-decision-agree" },
  { key: "disagree", label: msg`Disagree`, dot: "bg-decision-disagree" },
  { key: "unsure", label: msg`Not sure`, dot: "bg-decision-unsure" },
  {
    key: "open",
    label: msg`Still open`,
    dot: "bg-transparent shadow-[inset_0_0_0_1.5px_var(--line-strong)]",
  },
] as const;

function DecisionLegend({
  split,
  added = [],
}: {
  split: DecisionSplit;
  added?: readonly string[] | undefined;
}) {
  const { t } = useLingui();

  return (
    <dl className="m-0 grid grid-cols-2 gap-x-4.5 gap-y-2">
      {legendRows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 text-body-sm text-fg-dim"
        >
          <i aria-hidden="true" className={cn("size-2.5 rounded-full", row.dot)} />
          <dt>{t(row.label)}</dt>
          <dd className="m-0 font-semibold text-fg tabular-nums">{split[row.key]}</dd>
        </div>
      ))}
      {added.length > 0 ? (
        <div
          data-slot="legend-added"
          className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 text-body-sm text-fg-dim"
        >
          <i aria-hidden="true" className="size-2.5 rounded-full bg-accent-fill" />
          <dt className="truncate">{t`Added, ${added.join(", ")}`}</dt>
          <dd className="m-0 font-semibold text-fg tabular-nums">{added.length}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function ReviewProgressPopover({
  taskCode,
  taskName,
  taskSub,
  slideName,
  slide,
  added,
  seenPercent,
  onWholeSlide,
  wholeSlideTitle,
  position,
  slideTotal,
  submittedCount,
  dueText,
  timeLeft,
  guided = false,
  onPrevious,
  onNext,
  className,
}: ProgressPopoverProps) {
  const { t } = useLingui();

  const taskPercent = slideTotal === 0 ? 0 : Math.round((100 * (position - 1)) / slideTotal);
  return (
    <div
      role="dialog"
      aria-label={t`Review progress`}
      data-slot="review-progress-popover"
      className={cn("grid w-85 gap-3.5 p-0.5", className)}
    >
      <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3.5">
        <ProgressRing split={slide} size={64} />
        <div className="min-w-0">
          <span className="block text-label font-semibold tracking-wide text-fg-faint uppercase">
            <Trans>Task {taskCode}</Trans>
          </span>
          <b className="block text-body font-semibold leading-snug">{taskName}</b>
          <small className="block text-caption text-fg-faint" data-phi="">
            {taskSub}
          </small>
        </div>
      </div>
      <Zone
        title={t`This slide, ${slideName}`}
        end={
          <span className="text-caption text-fg-dim tabular-nums">
            <Trans>
              {slide.decided} of {slide.total}
            </Trans>
          </span>
        }
      >
        <DecisionLegend split={slide} added={added} />
        {seenPercent === undefined ? null : (
          <div className="flex items-center gap-2 border-t border-line pt-2.5 text-body-sm leading-snug text-fg-dim">
            <Icon name="eye" className="text-fg-faint" />
            <span>
              <Trans>{seenPercent}% of the tissue seen at 10x or more</Trans>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={onWholeSlide}
              title={wholeSlideTitle}
              data-closes-popover={onWholeSlide ? "" : undefined}
            >
              <Trans>Whole slide</Trans>
            </Button>
          </div>
        )}
      </Zone>
      <Zone
        title={t`Whole task`}
        end={
          <span className="text-caption text-fg-dim tabular-nums">
            <Trans>
              {submittedCount} of {slideTotal} submitted
            </Trans>
          </span>
        }
      >
        <ProgressBar
          value={taskPercent}
          label={
            <>
              <Trans>
                Slide <b>{position}</b> of {slideTotal}
              </Trans>
            </>
          }
          valueText={`${taskPercent}%`}
        />
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-body-sm">
          <dt className="flex items-center gap-1.5 text-fg-dim">
            <Icon name="calendar" className="text-fg-faint" />
            <Trans>Due</Trans>
          </dt>
          <dd className="m-0 text-right">{dueText}</dd>
          <dt className="flex items-center gap-1.5 text-fg-dim">
            <Icon name="clock" className="text-fg-faint" />
            <Trans>Time left</Trans>
          </dt>
          <dd className="m-0 text-right">{timeLeft}</dd>
        </dl>
      </Zone>
      <div className="flex items-center justify-between gap-2.5">
        <span className="text-caption text-fg-dim">
          <Trans>Saved as you go</Trans>
        </span>
        <Button onClick={onPrevious} disabled={!onPrevious}>
          <Icon name="back" />
          <Trans>Previous slide</Trans>
        </Button>
        {guided ? null : (
          <Button variant="primary" onClick={onNext} disabled={!onNext}>
            <Trans>Next slide</Trans>
            <Icon name="next" />
          </Button>
        )}
      </div>
    </div>
  );
}

type SlideStatus = { label: string; tone: "neutral" | "accent" | "ok" | "warn" };

type SlideRowData = {
  id: string;
  name: string;
  sub?: React.ReactNode;
  thumb?: string | undefined;
  resultSets: number;
  status: SlideStatus;
  progress?: { percent: number; label: string } | undefined;
  current?: boolean;
  disabledReason?: string | undefined;
};

type CaseDetailsData = {
  project?: string | undefined;
  caseLabel?: string | undefined;
  specimen?: string | undefined;
  blocks?: string[] | undefined;
  task?: string | undefined;
  researcher?: string | undefined;
  clinical?: boolean | undefined;
  clinicalNote?: string | undefined;
};

function CaseDetails({ details }: { details: CaseDetailsData }) {
  const { t } = useLingui();

  const blocks = details.blocks ?? [];
  const rows: [string, string, string | undefined, string][] = [
    ["project", t`Project`, details.project, t`Not known`],
    ["case", t`Case`, details.caseLabel, t`No case attached`],
    ["specimen", t`Specimen`, details.specimen, t`Not recorded`],
    ["blocks", t`Blocks`, blocks.length > 0 ? blocks.join(", ") : undefined, t`No blocks recorded`],
    ["task", t`Task`, details.task, t`Not part of a task`],
    ["researcher", t`Researcher`, details.researcher, t`Not known`],
  ];
  if (details.clinical) {
    rows.push(["clinical-note", t`Clinical note`, details.clinicalNote, t`No clinical note`]);
  }
  return (
    <dl
      aria-label={t`Case details`}
      data-slot="case-details"
      className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-surf-edge px-4 py-3 text-caption"
    >
      {rows.map(([field, label, value, missing]) => (
        <div key={field} data-field={field} className="contents">
          <dt className="text-fg-faint">{label}</dt>
          <dd
            data-missing={value ? undefined : true}
            className={cn(
              "m-0 min-w-0 text-fg",
              field === "clinical-note" ? "line-clamp-3 whitespace-pre-line" : "truncate",
              !value && "text-fg-faint italic",
            )}
            title={value}
          >
            {value || missing}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type SlidesPopoverProps = {
  caseTitle?: string | undefined;
  caseSub?: string | undefined;
  onOpenCase?: (() => void) | undefined;
  details?: CaseDetailsData | undefined;
  caseHeading?: string;
  caseSlides: SlideRowData[];
  looseHeading?: string | undefined;
  looseSlides?: SlideRowData[];
  showKeys?: boolean;
  onPick?: ((id: string) => void) | undefined;
  onSideBySide?: ((id: string) => void) | undefined;
  sideBySideTitle?: string | undefined;
  footer?: {
    onResultSets?: (() => void) | undefined;
    resultSetsLabel?: string;
    onCompare?: (() => void) | undefined;
    compareLabel?: string | undefined;
    compareTitle?: string | undefined;
    onAddSlides?: (() => void) | undefined;
    addSlidesTitle?: string | undefined;
  };
  ariaLabel?: string;
  className?: string;
};

type SideBySide = { onOpen?: ((id: string) => void) | undefined; title?: string | undefined };

function SlideRowView({
  row,
  onPick,
  sideBySide,
}: {
  row: SlideRowData;
  onPick?: (id: string) => void;
  sideBySide?: SideBySide | undefined;
}) {
  const { t } = useLingui();

  const offersSideBySide = sideBySide !== undefined && !row.current && !row.disabledReason;
  return (
    <div className="relative" data-slot="slide-row-group">
      <button
        type="button"
        data-slot="slide-row"
        data-current={row.current || undefined}
        disabled={row.disabledReason !== undefined}
        title={row.disabledReason}
        onClick={() => onPick?.(row.id)}
        className={cn(
          "grid w-full cursor-pointer grid-cols-[56px_minmax(0,1fr)_34px_84px] items-center gap-3 rounded-[9px] border-0 bg-transparent p-2 text-left text-fg outline-none hover:bg-surf-section focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent disabled:cursor-default disabled:opacity-60",
          offersSideBySide && "pb-7",
          row.current &&
            "bg-surf-hl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_45%,transparent)]",
        )}
      >
        <span
          aria-hidden="true"
          className="h-10 w-14 rounded-[5px] border border-line bg-[#f1eef2] bg-cover bg-center"
          style={row.thumb ? { backgroundImage: `url(${row.thumb})` } : undefined}
        />
        <span className="grid min-w-0 gap-1">
          <b className="truncate text-body-sm font-semibold">{row.name}</b>
          {row.sub ? (
            <small className="truncate text-caption text-fg-faint">{row.sub}</small>
          ) : null}
          {row.progress ? (
            <ProgressBar
              value={row.progress.percent}
              label={row.progress.label}
              valueText={`${row.progress.percent}%`}
            />
          ) : null}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-caption text-fg-dim",
            row.resultSets === 0 && "opacity-50",
          )}
          title={t`${row.resultSets} result set${row.resultSets === 1 ? "" : "s"}`}
        >
          <Icon name="layers" size="xs" />
          <span className="tabular-nums">{row.resultSets}</span>
        </span>
        <StatusTag tone={row.status.tone} className="justify-self-end">
          {row.status.label}
        </StatusTag>
      </button>
      {offersSideBySide ? (
        <Button
          size="sm"
          variant="ghost"
          className="absolute right-2 bottom-1.5"
          data-slot="side-by-side"
          aria-label={t`Side by side with ${row.name}`}
          title={sideBySide.title}
          disabled={sideBySide.onOpen === undefined}
          onClick={() => sideBySide.onOpen?.(row.id)}
        >
          <Icon name="slides" />
          <Trans>Side by side</Trans>
        </Button>
      ) : null}
    </div>
  );
}

function SlidesPopover({
  caseTitle,
  caseSub,
  onOpenCase,
  details,
  caseHeading = t`Slides in this case`,
  caseSlides,
  looseHeading,
  looseSlides = [],
  showKeys = true,
  onPick,
  onSideBySide,
  sideBySideTitle,
  footer,
  ariaLabel = t`Slides in this case and task`,
  className,
}: SlidesPopoverProps) {
  const { t } = useLingui();

  const heading =
    "flex items-center justify-between px-2 pt-3 pb-1.5 text-caption font-semibold text-fg-dim";
  const sideBySide =
    onSideBySide || sideBySideTitle ? { onOpen: onSideBySide, title: sideBySideTitle } : undefined;
  return (
    <div
      role="dialog"
      aria-label={ariaLabel}
      data-slot="slides-popover"
      className={cn("grid w-115 overflow-hidden", className)}
    >
      {caseTitle ? (
        <div className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 border-b border-surf-edge bg-surf-section px-4 py-3.5">
          <Icon name="folder" className="text-fg-dim" />
          <div className="min-w-0">
            <b className="block text-body-sm font-semibold" data-phi="">
              {caseTitle}
            </b>
            <small className="block truncate text-caption text-fg-faint">{caseSub}</small>
          </div>
          <Button size="sm" onClick={onOpenCase} disabled={!onOpenCase}>
            <Trans>Open the case</Trans>
          </Button>
        </div>
      ) : null}
      {details ? <CaseDetails details={details} /> : null}
      <div className="grid max-h-96 gap-0.5 overflow-y-auto px-2 pt-2 pb-3">
        <div className={heading}>
          <span>{caseHeading}</span>
          {showKeys ? (
            <span className="inline-flex gap-1">
              <Keycap keys="Q" />
              <Keycap keys="E" />
            </span>
          ) : null}
        </div>
        {caseSlides.map((row) => (
          <SlideRowView
            key={row.id}
            row={row}
            sideBySide={sideBySide}
            {...(onPick ? { onPick } : {})}
          />
        ))}
        {looseHeading && looseSlides.length > 0 ? (
          <>
            <div className={heading}>
              <span>{looseHeading}</span>
            </div>
            {looseSlides.map((row) => (
              <SlideRowView
                key={row.id}
                row={row}
                sideBySide={sideBySide}
                {...(onPick ? { onPick } : {})}
              />
            ))}
          </>
        ) : null}
      </div>
      {footer ? (
        <div className="flex items-center gap-2 border-t border-surf-edge px-3 py-2.5">
          {footer.resultSetsLabel ? (
            <Button
              variant="ghost"
              onClick={footer.onResultSets}
              title={t`Show, hide, compare and style the result sets of this slide`}
            >
              <Icon name="layers" />
              {footer.resultSetsLabel}
            </Button>
          ) : null}
          <span className="flex-1" />
          {footer.onCompare || footer.compareTitle ? (
            <Button
              onClick={footer.onCompare}
              disabled={footer.onCompare === undefined}
              title={footer.compareTitle}
            >
              <Icon name="slides" />
              {footer.compareLabel ?? <Trans>Compare slides</Trans>}
            </Button>
          ) : null}
          {footer.onAddSlides || footer.addSlidesTitle ? (
            <Button
              onClick={footer.onAddSlides}
              disabled={footer.onAddSlides === undefined}
              title={footer.addSlidesTitle}
            >
              <Icon name="upload" />
              <Trans>Add slides</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type PinnedSlideStripProps = {
  slides: SlideRowData[];
  onPick?: ((id: string) => void) | undefined;
  className?: string;
};

function PinnedSlideStrip({ slides, onPick, className }: PinnedSlideStripProps) {
  const { t } = useLingui();

  return (
    <nav
      aria-label={t`Slides of this case`}
      data-slot="pinned-slide-strip"
      className={cn(
        "flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-chrome px-3 py-1.5",
        className,
      )}
    >
      {slides.map((slide) => (
        <button
          key={slide.id}
          type="button"
          data-current={slide.current || undefined}
          aria-current={slide.current ? "true" : undefined}
          disabled={slide.disabledReason !== undefined}
          title={slide.disabledReason ?? slide.status.label}
          onClick={() => onPick?.(slide.id)}
          className={cn(
            "flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent py-1 pr-2.5 pl-1 text-body-sm text-fg-dim outline-none hover:bg-surf-section focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent disabled:cursor-default disabled:opacity-60",
            slide.current &&
              "bg-surf-hl text-fg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_45%,transparent)]",
          )}
        >
          <span
            aria-hidden="true"
            className="h-7 w-10 rounded-[4px] border border-line bg-[#f1eef2] bg-cover bg-center"
            style={slide.thumb ? { backgroundImage: `url(${slide.thumb})` } : undefined}
          />
          <span className="whitespace-nowrap">{slide.name}</span>
        </button>
      ))}
    </nav>
  );
}

type MoreItem = {
  icon: IconName;
  label: string;
  keys?: string;
  onSelect?: (() => void) | undefined;
  title?: string | undefined;
  separatorBefore?: boolean;
};

export {
  CaseDetails,
  type CaseDetailsData,
  DecisionLegend,
  type MoreItem,
  PinnedSlideStrip,
  type PinnedSlideStripProps,
  type ProgressPopoverProps,
  ReviewProgressPopover,
  type SlideRowData,
  SlidesPopover,
  type SlidesPopoverProps,
};
