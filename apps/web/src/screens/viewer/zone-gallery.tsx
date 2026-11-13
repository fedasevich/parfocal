import type { ReviewObject } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import type { FindingsCell } from "@parfocal/ui/components/findings-panel";
import { Keycap } from "@parfocal/ui/components/keycap";
import { useBindings } from "../../keys/personal-keys.ts";
import type { Fired } from "../../keys/registry.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";
import { reviewTyper } from "../review/ai-wording.ts";
import { inLayer } from "../review/answer-keys.ts";
import { CellOutline, cropStyle } from "../review/cells-grid.tsx";
import type { Answer } from "../review/review-state.ts";

const restActions = ["drest"];
const cellViewSize = 72;

export function useRestKey(onRest: () => void, enabled: boolean) {
  const bindings = useBindings(["review"], restActions, enabled);
  useHotkeys(bindings, (fired: Fired) => {
    if (fired.phase === "press" && !inLayer()) onRest();
  });
}

export function zoneTile(cell: ReviewObject, answer: Answer | undefined): FindingsCell {
  const crop = cropStyle(cell.object, cellViewSize);
  return {
    id: cell.object,
    label: `${cell.class_name.toLowerCase()} cell`,
    ...(answer ? { decision: answer.value } : {}),
    ai: {
      calls: [{ label: cell.class_name.toLowerCase(), probability: cell.score }],
      typer: reviewTyper,
      wording: "words",
    },
    outline: <CellOutline object={cell.object} />,
    crop: { position: crop.imagePosition, size: crop.imageSize },
    ...cropStyle(cell.object),
  };
}

type ZoneFootProps = {
  remaining: number;
  disabledReason: string | undefined;
  onNext: () => void;
  onRest: () => void;
};

export function ZoneFoot({ remaining, disabledReason, onNext, onRest }: ZoneFootProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={remaining === 0} onClick={onNext}>
        Next unsure cell <Keycap keys="J" size="sm" />
      </Button>
      <Button
        size="sm"
        variant="primary"
        disabled={remaining === 0 || disabledReason !== undefined}
        title={disabledReason ?? "Keeps the AI call on every open unsure cell in this zone"}
        onClick={onRest}
      >
        Rest look right <Keycap keys="⇧K" size="sm" />
      </Button>
    </div>
  );
}
