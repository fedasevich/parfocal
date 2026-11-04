import type { DecisionAnswer } from "@parfocal/ui/components/decision-buttons";
import { actionOf } from "../../keys/actions.ts";
import { useBindings } from "../../keys/personal-keys.ts";
import type { Fired } from "../../keys/registry.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";

export function answerKeyIds(answers: readonly DecisionAnswer[]): string[] {
  const ids = answers.flatMap((answer) =>
    answer.action === undefined ? [] : [actionOf(answer.action).id],
  );
  return [...new Set(ids)];
}

export function answerOfFired(answers: readonly DecisionAnswer[], fired: Fired): string | null {
  if (fired.phase !== "press") return null;
  return answers.find((answer) => answer.action === fired.action)?.raw ?? null;
}

export const inLayer = () =>
  typeof document !== "undefined" &&
  Boolean(document.activeElement?.closest("[role=dialog], [role=menu]"));

export function useAnswerKeys(
  answers: readonly DecisionAnswer[],
  onAnswer: (raw: string) => void,
  enabled = true,
) {
  const bindings = useBindings(["review"], answerKeyIds(answers), enabled);
  useHotkeys(bindings, (fired: Fired) => {
    const raw = answerOfFired(answers, fired);
    if (raw !== null && !inLayer()) onAnswer(raw);
  });
}
