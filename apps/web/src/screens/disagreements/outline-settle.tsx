import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import type { ReactNode } from "react";

export type OutlineChoice = {
  readonly key: string;
  readonly label: ReactNode;
  readonly hex: string;
};

export type SettledFrom = string | null | undefined;

export function OutlineSettle({
  choices,
  settledFrom,
  drawing,
  busy,
  onPick,
  onDraw,
  onCancelDraw,
}: {
  choices: readonly OutlineChoice[];
  settledFrom: SettledFrom;
  drawing: boolean;
  busy: boolean;
  onPick: (key: string) => void;
  onDraw: () => void;
  onCancelDraw: () => void;
}) {
  const { t } = useLingui();
  const settled = settledFrom === undefined ? "none" : settledFrom === null ? "drawn" : "picked";
  return (
    <section
      aria-label={t`Final outline`}
      data-testid="outline-settle"
      data-settled={settled}
      className="grid gap-1.5 rounded-zone bg-surf-panel px-3 py-2 text-body-sm"
    >
      <b className="font-semibold">
        <Trans>Final outline</Trans>
      </b>
      {choices.map((choice) => (
        <span key={choice.key} className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-0.5 w-5 rounded-full"
              style={{ backgroundColor: choice.hex }}
            />
            {choice.label}
          </span>
          <Button
            size="xs"
            variant={settledFrom === choice.key ? "primary" : "secondary"}
            aria-pressed={settledFrom === choice.key}
            disabled={busy || drawing}
            onClick={() => onPick(choice.key)}
          >
            {settledFrom === choice.key ? <Trans>Settled</Trans> : <Trans>Use this outline</Trans>}
          </Button>
        </span>
      ))}
      {drawing ? (
        <span className="flex items-center justify-between gap-2">
          <small className="text-caption text-fg-dim">
            <Trans>Click to place points. Double click or Enter closes the outline.</Trans>
          </small>
          <Button size="xs" variant="ghost" onClick={onCancelDraw}>
            <Trans>Cancel drawing</Trans>
          </Button>
        </span>
      ) : (
        <span className="flex items-center justify-between gap-2">
          <small className="text-caption text-fg-dim">
            {settled === "drawn" ? (
              <Trans>A new outline is settled.</Trans>
            ) : settled === "none" ? (
              <Trans>Pick one outline or draw a new one.</Trans>
            ) : null}
          </small>
          <Button size="xs" variant="secondary" disabled={busy} onClick={onDraw}>
            <Trans>Draw a new outline</Trans>
          </Button>
        </span>
      )}
    </section>
  );
}
