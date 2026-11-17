import { useLingui } from "@lingui/react/macro";
import type { ReviewObject } from "@parfocal/api-client";
import { Keycap } from "@parfocal/ui/components/keycap";
import { StatusTag } from "@parfocal/ui/components/tag";
import { FloatingPill, FocusCard } from "@parfocal/ui/components/viewer-tools";
import { useCallback, useRef } from "react";
import { useBindings } from "../keys/personal-keys.ts";
import type { Fired } from "../keys/registry.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { useAnswerKeys } from "../screens/review/answer-keys.ts";
import { answersOf, countWord } from "../screens/review/decision-style.ts";
import type { ReviewSession } from "../screens/review/review-data.ts";

const tone = { agree: "ok", disagree: "bad", unsure: "warn" } as const;

const focusActions = ["hideui"];

export function useFocusKey(onToggle: () => void) {
  const toggle = useRef(onToggle);
  toggle.current = onToggle;
  const bindings = useBindings(["viewer"], focusActions);
  const onFire = useCallback((fired: Fired) => {
    if (fired.phase === "press") toggle.current();
  }, []);
  useHotkeys(bindings, onFire);
}

export function StageFocusPill({
  label,
  detail,
  onShowUi,
}: {
  label: string;
  detail: string;
  onShowUi: () => void;
}) {
  const { t } = useLingui();
  return (
    <FloatingPill>
      <b>{label}</b>
      {detail === "" ? null : <span className="text-fg-faint">{detail}</span>}
      <button
        type="button"
        onClick={onShowUi}
        aria-label={t`Show the interface`}
        className="cursor-pointer border-0 bg-transparent p-0"
      >
        <Keycap action="hideui" keys="⌘\" size="sm" />
      </button>
    </FloatingPill>
  );
}

export function StageFocusCard({
  session,
  object,
  onAnswer,
  onShowUi,
  keysLive,
}: {
  session: ReviewSession;
  object: ReviewObject;
  onAnswer: (raw: string) => void;
  onShowUi: () => void;
  keysLive: boolean;
}) {
  const { t } = useLingui();
  const decision = session.decisions.get(object.object);
  const keys = answersOf(session.style, session.classes, object);
  useAnswerKeys(keys, onAnswer, keysLive);
  const score = Math.round(object.score * 100);
  return (
    <FocusCard
      className="right-3.5 bottom-3.5"
      title={t`${object.object} · ${object.class_name}`}
      status={
        <StatusTag tone={decision ? tone[decision.value] : "neutral"}>
          {decision ? countWord[decision.value].toLowerCase() : t`open`}
        </StatusTag>
      }
      text={
        decision
          ? t`AI score ${score}%. Decided. Press a key again to change it.`
          : t`AI score ${score}%. Still open.`
      }
      keys={[
        ...keys.map((item) => ({
          key: item.key,
          label: item.label.toLowerCase(),
          onPress: () => onAnswer(item.raw),
        })),
        { key: "⌘\\", label: t`show UI`, onPress: onShowUi },
      ]}
    />
  );
}
