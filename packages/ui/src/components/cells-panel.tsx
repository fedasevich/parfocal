import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { type DecisionSplit, ProgressRing } from "@parfocal/ui/components/progress-meter";
import { cn } from "@parfocal/ui/lib/utils";
import * as React from "react";

type CellsPanelProps = Omit<React.ComponentProps<"section">, "title"> & {
  decided: number;
  total: number;
  answerKeys: string[];
  folded?: boolean;
  confirmRest?: number | undefined;
  canAgreeRest?: boolean;
  onAgreeRest?: (() => void) | undefined;
  onApplyRest?: (() => void) | undefined;
  onCancelRest?: (() => void) | undefined;
  onFoldChange?: ((folded: boolean) => void) | undefined;
  onClose?: (() => void) | undefined;
  columns?: number;
};

function keyList(keys: string[], orWord: string) {
  return keys.map((key, index) => (
    <React.Fragment key={key}>
      {index === 0 ? null : index === keys.length - 1 ? ` ${orWord} ` : ", "}
      <Keycap keys={key} size="sm" />
    </React.Fragment>
  ));
}

function CellsPanel({
  decided,
  total,
  answerKeys,
  folded = false,
  confirmRest,
  canAgreeRest = true,
  onAgreeRest,
  onApplyRest,
  onCancelRest,
  onFoldChange,
  onClose,
  columns = 13,
  className,
  children,
  ...props
}: CellsPanelProps) {
  const { t } = useLingui();

  const confirming = confirmRest !== undefined;
  const fold = folded && !confirming;
  const rest = canAgreeRest && decided < total && !confirming;
  return (
    <section
      data-slot="cells-panel"
      data-folded={fold || undefined}
      aria-label={t`Cells in your sample`}
      className={cn(
        "grid gap-2.5 rounded-zone border border-line bg-chrome p-3 text-fg shadow-pop",
        fold && "py-2",
        className,
      )}
      {...props}
    >
      {confirming ? (
        <div className="flex items-start gap-3">
          <span className="grid min-w-0 gap-0.5">
            <b className="text-body-sm font-semibold">
              <Trans>Agree with {confirmRest} open cell</Trans>
              {confirmRest === 1 ? "" : t`s`}?
            </b>
            <span className="text-caption text-fg-dim">
              <Trans>Ringed on the slide and in the grid. Nothing changes until you apply.</Trans>
            </span>
          </span>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onCancelRest}>
            <Trans>
              Cancel <Keycap keys="Esc" size="sm" />
            </Trans>
          </Button>
          <Button variant="primary" size="sm" onClick={onApplyRest}>
            <Trans>
              Agree with {confirmRest} <Keycap keys="↵" size="sm" />
            </Trans>
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2" title={t`Drag to move the panel`}>
          <Icon name="target" className="text-fg-dim" />
          <b className="text-body-sm font-semibold">
            <Trans>Cells in your sample</Trans>
          </b>
          <span className="font-mono text-caption text-fg-dim">
            <Trans>
              {decided} of {total}
            </Trans>
          </span>
          <span className="flex-1" />
          {rest && !fold ? (
            <Button
              size="sm"
              title={t`Shows on the slide which open cells it would mark agree, before anything changes (Shift+K)`}
              onClick={onAgreeRest}
            >
              <Trans>Agree with the rest</Trans>
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={!fold}
            aria-label={fold ? t`Show the cells` : t`Fold to one line`}
            title={fold ? t`Show the cells` : t`Fold to one line`}
            onClick={() => onFoldChange?.(!fold)}
          >
            <Icon name="down" className={fold ? "rotate-180" : undefined} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Close the cells`}
            title={t`Close the cells`}
            onClick={onClose}
          >
            <Icon name="close" />
          </Button>
        </div>
      )}
      {fold ? null : (
        <>
          <div
            role="group"
            aria-label={t`Sampled cells`}
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${columns}, 40px)` }}
          >
            {children}
          </div>
          <span className="flex flex-wrap items-center gap-1 text-caption text-fg-dim">
            <Trans>
              <Keycap keys="←" size="sm" />
              <Keycap keys="→" size="sm" />
              <Keycap keys="↑" size="sm" />
              <Keycap keys="↓" size="sm" /> pick a cell · {keyList(answerKeys, t`or`)} decide ·{" "}
              <Keycap keys="N" size="sm" /> note
            </Trans>
            {rest ? (
              <>
                {" "}
                ·{" "}
                <Trans>
                  <Keycap keys="⇧K" size="sm" /> agree with the rest
                </Trans>
              </>
            ) : null}{" "}
            · <Keycap keys="Esc" size="sm" /> {confirming ? t`cancel` : t`close`}
          </span>
        </>
      )}
    </section>
  );
}

type CellsLauncherProps = React.ComponentProps<"button"> & { decided: number; total: number };

function CellsLauncher({ decided, total, className, ...props }: CellsLauncherProps) {
  const { t } = useLingui();

  return (
    <button
      type="button"
      data-slot="cells-launcher"
      title={t`Show the cells panel`}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-zone border border-line bg-chrome px-3 py-2 text-fg shadow-pop",
        className,
      )}
      {...props}
    >
      <Icon name="target" className="text-fg-dim" />
      <b className="text-body-sm font-semibold">
        <Trans>Cells</Trans>
      </b>
      <span className="font-mono text-caption text-fg-dim">
        <Trans>
          {decided} of {total}
        </Trans>
      </span>
      <Icon name="down" className="rotate-180 text-fg-faint" />
    </button>
  );
}

type CellClusterProps = React.ComponentProps<"button"> & { split: DecisionSplit };

function CellCluster({ split, className, ...props }: CellClusterProps) {
  const { t } = useLingui();

  const total = split.agree + split.disagree + split.unsure + split.open;
  return (
    <button
      type="button"
      data-slot="cell-cluster"
      title={t`The ${total} sampled cells sit close together here. Click to zoom to them`}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2.5 rounded-full border border-line bg-[color-mix(in_srgb,var(--chrome)_92%,transparent)] py-1 pr-4 pl-1 text-left text-fg shadow-pop",
        className,
      )}
      {...props}
    >
      <ProgressRing split={split} size={40} label={t`${total} sampled cells`} />
      <span className="grid leading-tight">
        <b className="text-body-sm font-semibold">
          <Trans>{total} sampled cells</Trans>
        </b>
        <small className="text-caption text-fg-dim">
          <Trans>
            {total - split.open} decided, {split.open} open
          </Trans>
        </small>
      </span>
    </button>
  );
}

export {
  CellCluster,
  type CellClusterProps,
  CellsLauncher,
  type CellsLauncherProps,
  CellsPanel,
  type CellsPanelProps,
};
