import { Trans, useLingui } from "@lingui/react/macro";
import type { ProjectClass } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Keycap } from "@parfocal/ui/components/keycap";
import { ContextBar, ContextDivider, ContextPill } from "@parfocal/ui/components/viewer-tools";
import { maxClassKeys } from "./classes.ts";
import { acceptLabel, type ContextBarModel } from "./context-bar.ts";
import { ContextExtrasSlot } from "./context-extras.tsx";

const fitted = "max-w-[calc(100%-1.5rem)] flex-wrap justify-center gap-y-1.5 whitespace-normal";

type ClassStripProps = {
  classes: readonly ProjectClass[];
  activeClass: string | null;
  onPick: (classKey: string) => void;
};

export function ClassStrip({ classes, activeClass, onPick }: ClassStripProps) {
  const { t } = useLingui();
  if (classes.length === 0) return null;
  return (
    <fieldset
      aria-label={t`Class for new shapes`}
      data-testid="class-strip"
      className="m-0 flex min-w-0 gap-1 border-0 p-0"
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
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-1.5 py-0.75 aria-pressed:border-accent aria-pressed:bg-accent/15"
        >
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ background: item.colour }}
          />
          <Keycap size="sm" keys={String(index + 1)} />
        </button>
      ))}
    </fieldset>
  );
}

type ProposalActions = {
  count: number;
  activeName: string | null;
  onAccept: () => void;
  onDiscard: () => void;
};

type ContextBarViewProps = {
  model: ContextBarModel;
  classes: readonly ProjectClass[];
  activeClass: string | null;
  onPick: (classKey: string) => void;
  proposals: ProposalActions | null;
  onCloseHints?: () => void;
};

export function ContextBarView({
  model,
  classes,
  activeClass,
  onPick,
  proposals,
  onCloseHints,
}: ContextBarViewProps) {
  const { t } = useLingui();
  const strip = model.classStrip ? (
    <ClassStrip classes={classes} activeClass={activeClass} onPick={onPick} />
  ) : null;
  if (proposals !== null) {
    return (
      <ContextBar
        className={fitted}
        label={model.label === "Auto region" ? model.label : t`Proposals`}
        data-testid="context-bar"
        data-mode="proposals"
        data-proposals={proposals.count}
      >
        {strip}
        <ContextExtrasSlot />
        <ContextDivider />
        <span className="inline-flex items-center gap-1.5 font-mono">
          <i
            aria-hidden="true"
            className="size-2 rounded-full bg-(--c-prop) shadow-[0_0_0_1.5px_#fff]"
          />
          <Trans>{proposals.count} found</Trans>
        </span>
        <Button size="sm" data-testid="proposal-discard" onClick={proposals.onDiscard}>
          <Trans>Discard</Trans> <Keycap size="sm" keys="Esc" />
        </Button>
        <Button
          size="sm"
          variant="primary"
          data-testid="proposal-accept"
          onClick={proposals.onAccept}
        >
          {acceptLabel(proposals.activeName)} <Keycap size="sm" keys="↵" />
        </Button>
      </ContextBar>
    );
  }
  return (
    <ContextBar label={model.label} data-testid="context-bar" data-mode="tool" className={fitted}>
      {model.hints.map((hint) => (
        <ContextPill key={hint}>{hint}</ContextPill>
      ))}
      {strip ? <ContextDivider /> : null}
      {strip}
      <ContextExtrasSlot />
      {model.hints.length > 0 && onCloseHints ? (
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
      ) : null}
    </ContextBar>
  );
}
