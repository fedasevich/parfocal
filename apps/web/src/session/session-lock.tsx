import { getSession, recordActivity, useGetSessionPolicy } from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import {
  activityIntervalMs,
  createActivityThrottle,
  defaultIdleLockMinutes,
  idleCheckDue,
  isSessionLocked,
  locksAt,
} from "./lock-rules.ts";

const inputEvents = ["keydown", "pointerdown", "wheel", "touchstart"] as const;

function useLockedByApi(onLocked: () => void) {
  const queryClient = useQueryClient();
  const report = useRef(onLocked);
  report.current = onLocked;
  useEffect(() => {
    const queries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && isSessionLocked(event.query.state.error)) report.current();
    });
    const mutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && isSessionLocked(event.mutation?.state.error)) {
        report.current();
      }
    });
    return () => {
      queries();
      mutations();
    };
  }, [queryClient]);
}

function useActivity(active: boolean, idleMinutes: number, onLocked: () => void) {
  const report = useRef(onLocked);
  report.current = onLocked;
  useEffect(() => {
    if (!active) return;
    const throttle = createActivityThrottle();
    let lastInput = Date.now();
    const check = (request: () => Promise<unknown>) =>
      request().catch((error: unknown) => {
        if (isSessionLocked(error)) report.current();
      });
    const onInput = () => {
      lastInput = Date.now();
      if (throttle.shouldSend(lastInput)) void check(() => recordActivity());
    };
    for (const name of inputEvents) {
      window.addEventListener(name, onInput, { capture: true, passive: true });
    }
    const timer = window.setInterval(() => {
      if (idleCheckDue(lastInput, Date.now(), idleMinutes)) void check(() => getSession());
    }, activityIntervalMs);
    return () => {
      for (const name of inputEvents) window.removeEventListener(name, onInput, { capture: true });
      window.clearInterval(timer);
    };
  }, [active, idleMinutes]);
}

const LockScreen = lazy(() => import("./lock-screen.tsx"));

export function SessionLock({ children }: { children: ReactNode }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const guarded = locksAt(pathname);
  const [locked, setLocked] = useState(false);
  const lock = () => {
    if (guarded) setLocked(true);
  };
  const policy = okData(useGetSessionPolicy({ query: { enabled: guarded } }).data);
  const minutes = policy?.idle_lock_minutes ?? defaultIdleLockMinutes;
  useLockedByApi(lock);
  useActivity(guarded && !locked, minutes, lock);
  return (
    <>
      <div inert={locked} aria-hidden={locked || undefined} className="contents">
        {children}
      </div>
      {locked ? (
        <Suspense fallback={null}>
          <LockScreen minutes={minutes} />
        </Suspense>
      ) : null}
    </>
  );
}
