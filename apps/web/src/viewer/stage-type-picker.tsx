import { Trans } from "@lingui/react/macro";
import type { ReviewObject } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import type { ProjectClass } from "@parfocal/ui/components/decision-buttons";
import { FilterChip } from "@parfocal/ui/components/tag";

export function StageTypePicker({
  object,
  classes,
  chosen,
  onPick,
  onCancel,
}: {
  object: ReviewObject;
  classes: readonly ProjectClass[];
  chosen: string | null;
  onPick: (classId: string) => void;
  onCancel: () => void;
}) {
  const named = (item: ProjectClass) =>
    chosen === null ? item.name === object.class_name : item.id === chosen;
  return (
    <fieldset data-testid="review-type-picker" className="m-0 grid gap-2.5 border-0 p-0">
      <legend className="mb-2.5 text-body-sm font-semibold">
        <Trans>Pick the right type of {object.object}</Trans>
      </legend>
      <div className="flex flex-wrap gap-2">
        {classes
          .flatMap((item) => {
            const id = item.id;
            return id === undefined ? [] : [{ ...item, id }];
          })
          .map((item) => (
            <FilterChip
              key={item.id}
              pressed={named(item)}
              onPressedChange={() => onPick(item.id)}
              className="h-8 px-3 text-body-sm"
            >
              {item.name}
            </FilterChip>
          ))}
      </div>
      <Button className="w-fit" onClick={onCancel}>
        <Trans>Cancel</Trans>
      </Button>
    </fieldset>
  );
}
