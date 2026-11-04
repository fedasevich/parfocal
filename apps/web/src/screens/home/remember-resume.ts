import {
  ApiError,
  getGetMyHomeQueryKey,
  type ResumeChange,
  setMyResume,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

export const resumeWriteDelayMs = 400;

const refused = new Set<string>();

export function resumeKey(change: ResumeChange) {
  const camera = change.camera;
  return [
    change.task_id,
    change.slide_id,
    change.mode,
    change.object_id ?? "",
    camera ? [camera.x, camera.y, camera.z].map((value) => value.toFixed(2)).join(",") : "",
  ].join("|");
}

function send(change: ResumeChange, onSaved: () => void) {
  const place = `${change.task_id}|${change.slide_id}`;
  if (refused.has(place)) return;
  setMyResume(change, { keepalive: true }).then(onSaved, (error: unknown) => {
    if (error instanceof ApiError && error.status === 404) refused.add(place);
  });
}

export function useRememberResume(change: ResumeChange | null) {
  const queryClient = useQueryClient();
  const latest = useRef<ResumeChange | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = change?.task_id && change.slide_id ? resumeKey(change) : null;
  latest.current = key === null ? null : change;
  useEffect(() => {
    if (key === null || pending.current !== null) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      const now = latest.current;
      if (now === null) return;
      send(now, () => {
        void queryClient.invalidateQueries({
          queryKey: getGetMyHomeQueryKey(),
          refetchType: "none",
        });
      });
    }, resumeWriteDelayMs);
  }, [key, queryClient]);
  useEffect(
    () => () => {
      if (pending.current === null) return;
      clearTimeout(pending.current);
      pending.current = null;
      if (latest.current !== null) send(latest.current, () => undefined);
    },
    [],
  );
}
