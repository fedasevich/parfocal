import { Trans, useLingui } from "@lingui/react/macro";
import type { ProjectClass } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Keycap } from "@parfocal/ui/components/keycap";
import { useTopStacked } from "@parfocal/ui/components/top-stack";
import { ContextBar, ContextDivider, ContextPill } from "@parfocal/ui/components/viewer-tools";
import { maxClassKeys } from "./classes.ts";
import { acceptLabel, type ContextBarModel } from "./context-bar.ts";
import { ContextExtrasSlot } from "./context-extras.tsx";

const centred = "right-3 left-3 mx-auto w-fit max-w-[calc(100%-1.5rem)] translate-x-0";

const wrapping = "flex-wrap justify-center gap-y-1.5 whitespace-normal";

const fitted = `${centred} ${wrapping}`;

const oneRow = `${centred} flex-nowrap`;

type ClassStripProps = {
  classes: readonly ProjectClass[];
  activeClass: string | null;
  onPick: (classKey: string) => void;
  forSelection?: boolean;
  compact?: boolean;
};

export function ClassStrip({
  classes,
  activeClass,
  onPick,
  forSelection = false,
  compact = false,
}: ClassStripProps) {
  const { t } = useLingui();
  if (classes.length === 0) return null;
  return (
    <fieldset
      aria-label={forSelection ? t`Class for the selection` : t`Class for new shapes`}
      data-testid="class-strip"
      className="m-0 flex min-w-0 gap-1 overflow-x-auto border-0 p-0 [scrollbar-width:none]"
    >
      {classes.slice(0, maxClassKeys).map((item, index) => (
        <button
          key={item.id}
          type="button"
          data-testid="class-swatch"
          data-class={item.id}
          title={item.name}
          aria-label={t`${item.name}, key ${index + 1}`}
          aria-pressed={activeClass === item.id}
          onClick={() => onPick(item.id)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-1.5 py-0.75 aria-pressed:border-accent aria-pressed:bg-accent/15"
        >
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ background: item.colour }}
          />
          {compact && activeClass !== item.id ? null : (
            <Keycap size="sm" keys={String(index + 1)} />
          )}
        </button>
      ))}
    </fieldset>
  );
}

const scaleText = (micronsPerPixel: number) => String(Number(micronsPerPixel.toFixed(2)));

type ProposalActions = {
  count: number;
  activeName: string | null;
  micronsPerPixel: number | null;
  onAccept: () => void;
  onDiscard: () => void;
};

type ContextBarViewProps = {
  model: ContextBarModel;
  classes: readonly ProjectClass[];
  activeClass: string | null;
  onPick: (classKey: string) => void;
  forSelection?: boolean;
  proposals: ProposalActions | null;
  onCloseHints?: () => void;
};

export function ContextBarView({
  model,
  classes,
  activeClass,
  onPick,
  forSelection = false,
  proposals,
  onCloseHints,
}: ContextBarViewProps) {
  const { t } = useLingui();
  const stacked = useTopStacked();
  const placed = stacked ? wrapping : fitted;
  const strip = model.classStrip ? (
    <ClassStrip
      classes={classes}
      activeClass={activeClass}
      onPick={onPick}
      forSelection={forSelection}
      compact={proposals !== null}
    />
  ) : null;
  if (proposals !== null) {
    return (
      <ContextBar
        className={stacked ? "flex-nowrap" : oneRow}
        label={model.label === "Auto region" ? model.label : t`Proposals`}
        data-testid="context-bar"
        data-mode="proposals"
        data-proposals={proposals.count}
      >
        {strip}
        <ContextExtrasSlot />
        {proposals.micronsPerPixel === null ? null : (
          <span data-testid="proposal-scale" className="shrink-0 font-mono text-fg-dim">
            <Trans>nuclei · {scaleText(proposals.micronsPerPixel)} µm</Trans>
          </span>
        )}
        <span className="inline-flex shrink-0 items-center gap-1.5 font-mono">
          <i
            aria-hidden="true"
            className="size-2 rounded-full bg-(--c-prop) shadow-[0_0_0_1.5px_#fff]"
          />
          <Trans>{proposals.count} found</Trans>
        </span>
        <Button
          size="sm"
          className="shrink-0"
          data-testid="proposal-discard"
          onClick={proposals.onDiscard}
        >
          <Trans>Discard</Trans> <Keycap size="sm" keys="Esc" />
        </Button>
        <Button
          size="sm"
          variant="primary"
          className="min-w-0"
          data-testid="proposal-accept"
          onClick={proposals.onAccept}
        >
          <span className="max-w-40 truncate">{acceptLabel(proposals.activeName)}</span>{" "}
          <Keycap size="sm" keys="↵" />
        </Button>
      </ContextBar>
    );
  }
  const pills = model.hints.map((hint) => (
    <ContextPill key={hint} className="whitespace-nowrap">
      {hint}
    </ContextPill>
  ));
  const closeHints =
    model.hints.length > 0 && onCloseHints ? (
      <button
        type="button"
        data-testid="hint-close"
        title={t`Close the hint`}
        onClick={onCloseHints}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-ctl border border-line px-1.5 py-0.5 text-fg-dim hover:text-fg"
      >
        <Trans>Close</Trans>
        <Keycap size="sm" keys="⇧I" />
      </button>
    ) : null;
  if (model.hintsBelow) {
    return (
      <ContextBar
        label={model.label}
        data-testid="context-bar"
        data-mode="tool"
        className={stacked ? "relative flex-nowrap" : oneRow}
      >
        {strip}
        <ContextExtrasSlot />
        {model.hints.length > 0 ? (
          <span
            data-slot="context-hints-line"
            data-testid="context-hints"
            className="absolute top-full left-0 mt-1.5 flex max-w-full flex-wrap items-center gap-1.5 rounded-[10px] border border-line bg-chrome px-2 py-1.5 shadow-pop [[data-slot=context-bar]:has([data-bar-state])_&]:hidden"
          >
            {pills}
            {closeHints}
          </span>
        ) : null}
      </ContextBar>
    );
  }
  return (
    <ContextBar label={model.label} data-testid="context-bar" data-mode="tool" className={placed}>
      {model.hints.length > 0 ? (
        <span
          data-testid="context-hints"
          className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2.5 gap-y-1.5"
        >
          {pills}
        </span>
      ) : null}
      {strip ? <ContextDivider /> : null}
      {strip}
      <ContextExtrasSlot />
      {closeHints}
    </ContextBar>
  );
}
