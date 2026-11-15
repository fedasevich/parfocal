import { Trans, useLingui } from "@lingui/react/macro";
import { type ResultSet, useListSlideResultSets } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { Switch } from "@parfocal/ui/components/switch";
import { okData } from "../screens/placeholder.tsx";
import { heatmapColormaps, isHeatmapColormap } from "../viewer/viewer-engine.ts";
import { type HeatmapChoices, useSetHeatmap } from "./heatmap-layer.tsx";

type ResultSetLayersProps = {
  slideId: string;
  adding: boolean;
  onAdd: () => void;
  heatmaps: HeatmapChoices;
};

function HeatmapControls({ set, heatmaps }: { set: ResultSet; heatmaps: HeatmapChoices }) {
  const { t } = useLingui();
  const facts = useSetHeatmap(set);
  if (facts === undefined) return null;
  const choice = heatmaps.choiceOf(set.id);
  return (
    <div className="flex items-center gap-2" data-testid="heatmap-controls">
      <SegmentedControl
        aria-label={t`Colour map of ${set.name}`}
        value={choice.colormap}
        onValueChange={(value) => {
          if (isHeatmapColormap(value)) heatmaps.change(set.id, { colormap: value });
        }}
        options={heatmapColormaps.map((colormap) => ({ value: colormap, label: colormap }))}
      />
      <Switch
        size="sm"
        aria-label={t`Show heatmap ${set.name}`}
        checked={choice.shown}
        onCheckedChange={(shown) => heatmaps.change(set.id, { shown })}
      />
    </div>
  );
}

export function ResultSetLayers({ slideId, adding, onAdd, heatmaps }: ResultSetLayersProps) {
  const sets = okData(useListSlideResultSets(slideId).data) ?? [];
  return (
    <div className="grid gap-1" data-testid="result-set-layers" data-sets={sets.length}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption font-semibold text-fg-dim uppercase">
          <Trans>Result sets</Trans>
        </span>
        <Button size="sm" disabled={adding} data-testid="add-result-set" onClick={onAdd}>
          <Icon name="plus" />
          <Trans>Add a result set</Trans>
        </Button>
      </div>
      {sets.map((set) => (
        <div key={set.id} className="grid gap-1">
          <div
            data-testid="result-set-layer"
            className="flex items-center justify-between gap-2 text-body-sm"
          >
            <span className="truncate">{set.name}</span>
            <span className="shrink-0 text-fg-dim">
              {set.model_version ?? set.source_file ?? ""}
            </span>
          </div>
          <HeatmapControls set={set} heatmaps={heatmaps} />
        </div>
      ))}
    </div>
  );
}
