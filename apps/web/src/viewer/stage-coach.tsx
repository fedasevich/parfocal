import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { CoachTip } from "../screens/review/guided-parts.tsx";

export function StageCoachOnSlide({ object }: { object: string }) {
  return (
    <div data-testid="stage-coach" className="pointer-events-none absolute inset-0 z-5">
      <CoachTip n={1} className="absolute top-[45%] left-[35%] w-75">
        <Trans>The AI found this. It is outlined in white.</Trans>
      </CoachTip>
      <CoachTip n={2} className="absolute bottom-20 left-4 w-85">
        <Trans>
          Drag to move around. Scroll or use + and − to zoom. Back to {object} brings you back.
        </Trans>
      </CoachTip>
    </div>
  );
}

export function StageCoachAnswerTip({ keys }: { keys: string[] }) {
  const { t } = useLingui();
  const keyList = keys.join(", ").replace(/, ([^,]*)$/, t` or $1`);
  return (
    <CoachTip n={3}>
      <Trans>Answer with one of the buttons, or press {keyList}.</Trans>
    </CoachTip>
  );
}

export function StageCoachStepTip({ onStart }: { onStart: () => void }) {
  return (
    <div className="grid gap-3">
      <CoachTip n={4}>
        <Trans>
          The next open object comes by itself. Previous and Next take you back to any of them.
        </Trans>
      </CoachTip>
      <Button variant="primary" size="lg" className="w-fit" onClick={onStart}>
        <Trans>Got it, start</Trans>
      </Button>
    </div>
  );
}
