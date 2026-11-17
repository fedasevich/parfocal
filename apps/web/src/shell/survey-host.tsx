import { lazy, Suspense } from "react";
import { loadSurveyPrompter } from "../telemetry/app-events.ts";

const SurveyPrompt = lazy(async () => {
  const [card, prompter] = await Promise.all([import("./survey-prompt.tsx"), loadSurveyPrompter()]);
  card.bindSurveyPrompter(prompter);
  return { default: card.SurveyPrompt };
});

export function SurveyHost() {
  return (
    <Suspense fallback={null}>
      <SurveyPrompt />
    </Suspense>
  );
}
