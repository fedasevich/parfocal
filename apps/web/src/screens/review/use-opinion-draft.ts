import { getGetOpinionQueryKey, useSaveOpinion } from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { markTried } from "../home/getting-started.ts";
import type { ReviewSession } from "./review-data.ts";

const asText = (value: unknown) => {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return String(value);
};

const asAnswer = (kind: string | undefined, value: string) => {
  if (value === "") return null;
  if (kind === "scale") return Number(value);
  if (kind === "yesno") return value === "Yes";
  return value;
};

export function useOpinionDraft(session: ReviewSession, hidden: string[] = []) {
  const queryClient = useQueryClient();
  const { taskId, slideId } = session;
  const [edits, setEdits] = useState<Record<string, string>>({});
  const saver = useSaveOpinion({
    mutation: {
      onSuccess: () => {
        markTried("opinion");
        void queryClient.invalidateQueries({ queryKey: getGetOpinionQueryKey(taskId, slideId) });
      },
    },
  });
  const saved = Object.fromEntries(
    Object.entries(session.opinion?.answers ?? {})
      .filter(([key]) => !hidden.includes(key))
      .map(([key, value]) => [key, asText(value)]),
  );
  const answers: Record<string, string> = { ...saved, ...edits };
  const change = (key: string, value: string) => {
    setEdits((before) => ({ ...before, [key]: value }));
    const kind = session.opinion?.questions.find((item) => item.key === key)?.kind;
    saver.mutate({ taskId, slideId, data: { answers: { [key]: asAnswer(kind, value) } } });
  };
  return { answers, change };
}
