import { Trans } from "@lingui/react/macro";
import type { ReviewObject } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { ObjectDots } from "./object-card.tsx";
import { previousObjectAction } from "./object-keys.ts";
import type { Answer } from "./review-state.ts";

export function GuidedFormBack({
  regions,
  cells,
  current,
  answer,
  onBack,
  onJump,
}: {
  regions: ReviewObject[];
  cells: ReviewObject[];
  current: string;
  answer: (object: string) => Answer | undefined;
  onBack: () => void;
  onJump: (object: string) => void;
}) {
  return (
    <div data-testid="guided-form-back" className="flex flex-col gap-3">
      <Button variant="ghost" className="w-fit" onClick={onBack}>
        <Icon name="back" />
        <Trans>Back to {current}</Trans>
        <Keycap action={previousObjectAction} size="sm" />
      </Button>
      <ObjectDots
        regions={regions}
        cells={cells}
        current={current}
        answer={answer}
        skipped={[]}
        onJump={onJump}
      />
    </div>
  );
}
