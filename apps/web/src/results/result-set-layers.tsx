import { Trans } from "@lingui/react/macro";
import { useListSlideResultSets } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { okData } from "../screens/placeholder.tsx";

type ResultSetLayersProps = {
  slideId: string;
  adding: boolean;
  onAdd: () => void;
};

export function ResultSetLayers({ slideId, adding, onAdd }: ResultSetLayersProps) {
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
        <div
          key={set.id}
          data-testid="result-set-layer"
          className="flex items-center justify-between gap-2 text-body-sm"
        >
          <span className="truncate">{set.name}</span>
          <span className="shrink-0 text-fg-dim">{set.model_version ?? set.source_file ?? ""}</span>
        </div>
      ))}
    </div>
  );
}
