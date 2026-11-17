import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTourCornerBusy } from "../help/tour-state.ts";
import { seqPoints } from "../telemetry/survey-items.ts";
import { seqEnds, seqQuestion, susItems, susScale } from "../telemetry/survey-text.ts";
import type { SurveyOffer, SurveyPrompter } from "../telemetry/surveys.ts";

let surveyPrompter: SurveyPrompter;

export function bindSurveyPrompter(prompter: SurveyPrompter): void {
  surveyPrompter = prompter;
}

const recheckMs = 15_000;
let sessionCounted = false;

function useOffer(): SurveyOffer | null {
  const [, setTick] = useState(0);
  useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    if (sessionCounted) return;
    sessionCounted = true;
    surveyPrompter.sessionStarted();
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), recheckMs);
    return () => window.clearInterval(timer);
  }, []);
  return useSyncExternalStore(
    (listener) => surveyPrompter.subscribe(listener),
    () => surveyPrompter.current(),
    () => null,
  );
}

function Scale({
  points,
  labels,
  name,
  onPick,
}: {
  points: number;
  labels?: readonly string[];
  name: string;
  onPick: (point: number) => void;
}) {
  return (
    <fieldset aria-label={name} className="m-0 flex gap-1 border-0 p-0">
      {Array.from({ length: points }, (_, index) => index + 1).map((point) => (
        <Button
          key={point}
          size="xs"
          variant="secondary"
          aria-label={labels?.[point - 1] ? `${point} ${labels[point - 1]}` : String(point)}
          onClick={() => onPick(point)}
        >
          {point}
        </Button>
      ))}
    </fieldset>
  );
}

function SeqCard() {
  return (
    <>
      <p className="font-medium text-fg">{seqQuestion}</p>
      <Scale
        name={seqQuestion}
        points={seqPoints}
        onPick={(point) => surveyPrompter.answerSeq(point)}
      />
      <div className="flex justify-between text-caption text-fg-dim">
        <span>1 {seqEnds.low}</span>
        <span>
          {seqPoints} {seqEnds.high}
        </span>
      </div>
    </>
  );
}

function SusCard() {
  const [answers, setAnswers] = useState<number[]>([]);
  const step = Math.min(answers.length, susItems.length - 1);
  const item = susItems[step] ?? "";
  return (
    <>
      <p className="text-caption text-fg-dim">
        <Trans>
          Question {step + 1} of {susItems.length}
        </Trans>
      </p>
      <p className="font-medium text-fg">{item}</p>
      <Scale
        name={item}
        points={5}
        labels={susScale}
        onPick={(point) => {
          const next = [...answers, point];
          setAnswers(next);
          if (next.length === susItems.length) surveyPrompter.answerSus(next);
        }}
      />
      <div className="flex justify-between text-caption text-fg-dim">
        <span>1 {susScale[0]}</span>
        <span>5 {susScale[4]}</span>
      </div>
      {answers.length > 0 ? (
        <Button size="xs" variant="ghost" onClick={() => setAnswers(answers.slice(0, -1))}>
          <Trans>Back</Trans>
        </Button>
      ) : null}
    </>
  );
}

export function SurveyPrompt() {
  const { t } = useLingui();

  const offer = useOffer();
  const tourBusy = useTourCornerBusy();
  if (offer === null || tourBusy) return null;
  return (
    <section
      aria-label={t`Quick survey`}
      className="fixed right-4 bottom-4 z-40 flex w-80 flex-col gap-2 rounded-zone border border-line bg-surf-panel p-3 shadow-pop"
    >
      {offer.survey === "seq" ? <SeqCard /> : <SusCard />}
      <Button size="xs" variant="ghost" onClick={() => surveyPrompter.dismiss()}>
        <Trans>Not now</Trans>
      </Button>
    </section>
  );
}
