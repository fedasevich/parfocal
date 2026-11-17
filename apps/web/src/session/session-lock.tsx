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
  needsSecondFactor,
} from "./lock-rules.ts";

const inputEvents = ["keydown", "pointerdown", "wheel", "touchstart"] as const;

function useRefusedByApi(refused: (error: unknown) => boolean, onRefused: () => void) {
  const queryClient = useQueryClient();
  const report = useRef(onRefused);
  report.current = onRefused;
  const matches = useRef(refused);
  matches.current = refused;
  useEffect(() => {
    const queries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && matches.current(event.query.state.error)) report.current();
    });
    const mutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && matches.current(event.mutation?.state.error)) {
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
const SecondFactorScreen = lazy(() => import("./second-factor-screen.tsx"));

export function SessionLock({ children }: { children: ReactNode }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const guarded = locksAt(pathname);
  const [locked, setLocked] = useState(false);
  const [secondFactor, setSecondFactor] = useState(false);
  const lock = () => {
    if (guarded) setLocked(true);
  };
  const askForSecondFactor = () => {
    if (guarded) setSecondFactor(true);
  };
  const policy = okData(useGetSessionPolicy({ query: { enabled: guarded } }).data);
  const minutes = policy?.idle_lock_minutes ?? defaultIdleLockMinutes;
  useRefusedByApi(isSessionLocked, lock);
  useRefusedByApi(needsSecondFactor, askForSecondFactor);
  useActivity(guarded && !locked && !secondFactor, minutes, lock);
  const covered = locked || secondFactor;
  return (
    <>
      <div inert={covered} aria-hidden={covered || undefined} className="contents">
        {children}
      </div>
      {locked ? (
        <Suspense fallback={null}>
          <LockScreen minutes={minutes} />
        </Suspense>
      ) : secondFactor ? (
        <Suspense fallback={null}>
          <SecondFactorScreen />
        </Suspense>
      ) : null}
    </>
  );
}
