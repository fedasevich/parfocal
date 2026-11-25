import { Trans } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { rawFor } from "../screens/review/decision-mapping.ts";
import { ObjectDots } from "../screens/review/object-card.tsx";
import { previousObjectAction } from "../screens/review/object-keys.ts";
import type { ReviewSession } from "../screens/review/review-data.ts";
import { type Answer, answerFromDecision } from "../screens/review/review-state.ts";
import type { PendingDecisions } from "./stage-opinion.tsx";

export function StageOpinionBack({
  session,
  pending,
  current,
  onBack,
  onJump,
}: {
  session: ReviewSession;
  pending: PendingDecisions;
  current: string | null;
  onBack: () => void;
  onJump: (object: string) => void;
}) {
  const objects = session.objects;
  const answer = (id: string): Answer | undefined => {
    const object = objects.find((item) => item.object === id);
    const decision = session.decisions.get(id);
    if (decision !== undefined) {
      return answerFromDecision(decision, session.style, object, session.classes);
    }
    const value = pending.get(id);
    if (value === undefined || object === undefined) return undefined;
    return { value, raw: rawFor(session.style, value, object), reasons: [], note: null };
  };
  const target = current ?? objects[0]?.object;
  if (target === undefined) return null;
  return (
    <div data-testid="stage-opinion-back" className="flex flex-col gap-3">
      <Button variant="secondary" className="w-fit" onClick={onBack}>
        <Icon name="back" />
        <Trans>Back to {target}</Trans>
        <Keycap action={previousObjectAction} size="sm" />
      </Button>
      <ObjectDots
        regions={objects.filter((item) => item.kind === "region")}
        cells={objects.filter((item) => item.kind === "cell")}
        current={target}
        answer={answer}
        skipped={[]}
        onJump={onJump}
      />
    </div>
  );
}
