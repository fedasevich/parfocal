import { Trans, useLingui } from "@lingui/react/macro";
import type { ModelOutput, ProjectModel } from "@parfocal/api-client";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Icon } from "@parfocal/ui/components/icon";
import { ModelPicker } from "@parfocal/ui/components/model-picker";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { modelGroups } from "./run-model-parts.ts";
import {
  cellModels,
  evidenceText,
  type OutputChoice,
  type OutputPicks,
  toggled,
  tumorModels,
  typesCells,
} from "./run-outputs.ts";

type ModelLineProps = {
  candidates: ProjectModel[];
  value: string | null;
  onValueChange: (id: string) => void;
  initiallyOpen: boolean;
  footer?: React.ReactNode;
};

function ModelLine({ candidates, value, onValueChange, initiallyOpen, footer }: ModelLineProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const chosen = candidates.find((model) => model.id === value);
  if (candidates.length < 2) {
    return (
      <span className="text-body-sm text-fg">
        {chosen ? <Trans>With {chosen.title}</Trans> : <Trans>No model makes this yet</Trans>}
      </span>
    );
  }
  return (
    <ModelPicker
      groups={modelGroups(candidates)}
      value={value}
      onValueChange={onValueChange}
      open={open}
      onOpenChange={setOpen}
      footer={footer}
    />
  );
}

type OutputRowProps = {
  choice: OutputChoice;
  output: ModelOutput;
  title: string;
  picks: OutputPicks;
  onPicks: (picks: OutputPicks) => void;
  model: ProjectModel | undefined;
  disabled?: boolean;
  children?: React.ReactNode;
};

function OutputRow({
  choice,
  output,
  title,
  picks,
  onPicks,
  model,
  disabled,
  children,
}: OutputRowProps) {
  const id = useId();
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1.5">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={picks[choice]}
        disabled={disabled}
        onCheckedChange={(on) => onPicks(toggled(picks, choice, on))}
      />
      <label htmlFor={id} className="font-medium text-body-sm text-fg">
        {title}
      </label>
      <div className="col-start-2 grid gap-1.5">
        {children}
        <small className="text-caption text-fg-dim" data-testid={`evidence-${output}`}>
          {evidenceText(model, output)}
        </small>
      </div>
    </div>
  );
}

type RunOutputsZoneProps = {
  models: ProjectModel[];
  picks: OutputPicks;
  onPicks: (picks: OutputPicks) => void;
  tumorId: string | null;
  onTumorId: (id: string) => void;
  cellId: string | null;
  onCellId: (id: string) => void;
  menuOpen: boolean;
};

export function RunOutputsZone({
  models,
  picks,
  onPicks,
  tumorId,
  onTumorId,
  cellId,
  onCellId,
  menuOpen,
}: RunOutputsZoneProps) {
  const { t } = useLingui();
  const tumors = tumorModels(models);
  const cells = cellModels(models);
  const tumor = tumors.find((model) => model.id === tumorId);
  const cell = cells.find((model) => model.id === cellId);
  const typing = typesCells(cell);
  return (
    <div className="grid gap-3.5">
      <OutputRow
        choice="tumor"
        output="tumor-regions"
        title={t`Tumor regions and heatmap`}
        picks={picks}
        onPicks={onPicks}
        model={tumor}
        disabled={tumors.length === 0}
      >
        <ModelLine
          candidates={tumors}
          value={tumorId}
          onValueChange={onTumorId}
          initiallyOpen={false}
        />
      </OutputRow>
      <OutputRow
        choice="outlines"
        output="cell-outlines"
        title={t`Cell outlines`}
        picks={picks}
        onPicks={onPicks}
        model={cell}
        disabled={cells.length === 0}
      >
        <ModelLine
          candidates={cells}
          value={cellId}
          onValueChange={onCellId}
          initiallyOpen={menuOpen}
          footer={
            <Link
              to="/admin"
              search={{ scene: "addmodel" }}
              className="flex items-center gap-2 p-2.5 text-accent no-underline hover:underline"
            >
              <Icon name="plus" />
              <Trans>Connect your own model</Trans>
            </Link>
          }
        />
      </OutputRow>
      <OutputRow
        choice="types"
        output="cell-types"
        title={t`Cell types`}
        picks={picks}
        onPicks={onPicks}
        model={cell}
        disabled={!typing}
      >
        <span className="text-body-sm text-fg">
          {typing && cell ? (
            <Trans>Typed by {cell.title}, with the outlines</Trans>
          ) : (
            <Trans>The model for cells gives no types</Trans>
          )}
        </span>
      </OutputRow>
      <small className="text-caption text-fg-dim">
        {picks.outlines && !picks.types && typing ? (
          <span data-testid="typing-saves">
            <Trans>Without cell types the run saves an estimated 4 to 9 percent of its time.</Trans>
          </span>
        ) : (
          <Trans>
            Tumor regions and cells are two jobs and two result sets. A run always uses the latest
            version, and the result set records which one.
          </Trans>
        )}
      </small>
    </div>
  );
}
