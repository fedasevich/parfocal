import type { ProjectClass } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Keycap } from "@parfocal/ui/components/keycap";
import { ContextBar, ContextDivider, ContextPill } from "@parfocal/ui/components/viewer-tools";
import { maxClassKeys } from "./classes.ts";
import { acceptLabel, type ContextBarModel } from "./context-bar.ts";

type ClassStripProps = {
  classes: readonly ProjectClass[];
  activeClass: string | null;
  onPick: (classKey: string) => void;
};

export function ClassStrip({ classes, activeClass, onPick }: ClassStripProps) {
  if (classes.length === 0) return null;
  return (
    <fieldset
      aria-label="Class for new shapes"
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
          aria-label={item.name}
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
};

export function ContextBarView({
  model,
  classes,
  activeClass,
  onPick,
  proposals,
}: ContextBarViewProps) {
  const strip = model.classStrip ? (
    <ClassStrip classes={classes} activeClass={activeClass} onPick={onPick} />
  ) : null;
  if (proposals !== null) {
    return (
      <ContextBar
        label={model.label === "Auto region" ? model.label : "Proposals"}
        data-testid="context-bar"
        data-mode="proposals"
        data-proposals={proposals.count}
      >
        {strip}
        <ContextDivider />
        <span className="inline-flex items-center gap-1.5 font-mono">
          <i
            aria-hidden="true"
            className="size-2 rounded-full bg-(--c-prop) shadow-[0_0_0_1.5px_#fff]"
          />
          {proposals.count} found
        </span>
        <Button size="sm" data-testid="proposal-discard" onClick={proposals.onDiscard}>
          Discard <Keycap size="sm" keys="Esc" />
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
    <ContextBar label={model.label} data-testid="context-bar" data-mode="tool">
      {model.hints.map((hint) => (
        <ContextPill key={hint}>{hint}</ContextPill>
      ))}
      {strip ? <ContextDivider /> : null}
      {strip}
    </ContextBar>
  );
}
