import { useBlocker } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { now } from "../clock.ts";
import { isBlocked } from "./study-model.ts";
import { appendBlock, readGuard } from "./study-storage.ts";

export default function StudyGuardHost() {
  const [message, setMessage] = useState<string | null>(null);

  useBlocker({
    enableBeforeUnload: false,
    shouldBlockFn: ({ next }) => {
      const guard = readGuard();
      if (guard === undefined || !isBlocked(guard, next.pathname)) return false;
      appendBlock({
        sessionId: guard.sessionId,
        taskId: guard.taskId,
        at: now().getTime(),
        to: next.pathname,
      });
      setMessage(guard.where);
      return true;
    },
  });

  useEffect(() => {
    if (message === null) return;
    const timer = window.setTimeout(() => setMessage(null), 8000);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (message === null) return null;
  return (
    <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <p
        role="alert"
        className="rounded border border-line bg-surf-panel px-4 py-2 text-body text-fg"
        data-testid="study-guard-message"
      >
        {message}
      </p>
    </div>
  );
}
