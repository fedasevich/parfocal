import { Trans } from "@lingui/react/macro";
import {
  getSession,
  lockSession,
  type Me,
  recordActivity,
  useGetMe,
  useGetSessionPolicy,
} from "@parfocal/api-client";
import { Banner } from "@parfocal/ui/components/banner";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { BootLoader, SignInPrompt } from "./boot-loader.tsx";
import {
  activityIntervalMs,
  canShowLock,
  createActivityThrottle,
  defaultIdleLockMinutes,
  idleCheckDue,
  idleWarningDue,
  isSessionLocked,
  lockRequestEvent,
  locksAt,
  needsSecondFactor,
  sessionGate,
  warningCheckMs,
} from "./lock-rules.ts";
import { signedOutTarget, signInRedirect } from "./sign-in-redirect.ts";

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

function useActivity(
  active: boolean,
  idleMinutes: number,
  onLocked: () => void,
  onWarning: (warned: boolean) => void,
) {
  const report = useRef(onLocked);
  report.current = onLocked;
  const warn = useRef(onWarning);
  warn.current = onWarning;
  useEffect(() => {
    if (!active) return;
    const throttle = createActivityThrottle();
    let lastInput = Date.now();
    let warned = false;
    const setWarned = (next: boolean) => {
      if (warned === next) return;
      warned = next;
      warn.current(next);
    };
    const check = (request: () => Promise<unknown>) =>
      request().catch((error: unknown) => {
        if (isSessionLocked(error)) report.current();
      });
    const onInput = () => {
      lastInput = Date.now();
      setWarned(false);
      if (throttle.shouldSend(lastInput)) void check(() => recordActivity());
    };
    for (const name of inputEvents) {
      window.addEventListener(name, onInput, { capture: true, passive: true });
    }
    const timer = window.setInterval(() => {
      if (idleCheckDue(lastInput, Date.now(), idleMinutes)) void check(() => getSession());
    }, activityIntervalMs);
    const warning = window.setInterval(() => {
      if (idleWarningDue(lastInput, Date.now(), idleMinutes)) setWarned(true);
    }, warningCheckMs);
    return () => {
      for (const name of inputEvents) window.removeEventListener(name, onInput, { capture: true });
      window.clearInterval(timer);
      window.clearInterval(warning);
      setWarned(false);
    };
  }, [active, idleMinutes]);
}

const LockScreen = lazy(() => import("./lock-screen.tsx"));
const SecondFactorScreen = lazy(() => import("./second-factor-screen.tsx"));

function SignInNeeded({ error }: { error: unknown }) {
  const tried = useRef(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    if (!signInRedirect(window)(error)) setPaused(true);
  }, [error]);
  if (!paused) return <BootLoader />;
  return <SignInPrompt href={signedOutTarget(window.location, error) ?? "/sign-in"} />;
}

export function SessionLock({ children }: { children: ReactNode }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const guarded = locksAt(pathname);
  const me = useGetMe({ query: { enabled: guarded } });
  const person = okData(me.data);
  const [remembered, remember] = useState<Me | undefined>(undefined);
  const known = canShowLock(person) ? person : remembered;
  if (known !== remembered) remember(known);
  const gate = sessionGate({
    guarded,
    known: known !== undefined,
    settled: me.status !== "pending",
    error: me.error,
  });
  if (gate === "wait") return <BootLoader />;
  if (gate === "sign-in") return <SignInNeeded error={me.error} />;
  return (
    <LockGuard guarded={guarded} person={known}>
      {children}
    </LockGuard>
  );
}

function LockGuard({
  guarded,
  person,
  children,
}: {
  guarded: boolean;
  person: Me | undefined;
  children: ReactNode;
}) {
  const [locked, setLocked] = useState<"idle" | "manual" | null>(null);
  const [secondFactor, setSecondFactor] = useState(false);
  const [warned, setWarned] = useState(false);
  const lock = () => {
    if (!guarded) return;
    if (person === undefined) {
      signInRedirect(window)();
      return;
    }
    setLocked((current) => current ?? "idle");
  };
  const lockNow = () => {
    if (guarded && person !== undefined)
      void lockSession().then(
        () => setLocked("manual"),
        () => undefined,
      );
  };
  const lockOnRequest = useRef(lockNow);
  lockOnRequest.current = lockNow;
  useEffect(() => {
    const onRequest = () => lockOnRequest.current();
    window.addEventListener(lockRequestEvent, onRequest);
    return () => window.removeEventListener(lockRequestEvent, onRequest);
  }, []);
  const askForSecondFactor = () => {
    if (guarded) setSecondFactor(true);
  };
  const policy = okData(useGetSessionPolicy({ query: { enabled: guarded } }).data);
  const minutes = policy?.idle_lock_minutes ?? defaultIdleLockMinutes;
  useRefusedByApi(isSessionLocked, lock);
  useRefusedByApi(needsSecondFactor, askForSecondFactor);
  useActivity(guarded && locked === null && !secondFactor, minutes, lock, setWarned);
  const hidden = locked !== null && person !== undefined;
  return (
    <>
      {hidden ? null : (
        <div inert={secondFactor} aria-hidden={secondFactor || undefined} className="contents">
          {children}
        </div>
      )}
      {warned && !hidden && !secondFactor ? (
        <div className="fixed inset-x-0 top-0 z-[1000]">
          <Banner tone="warn" icon="lock">
            <Trans>
              The screen locks soon without input. Press a key or click to keep working.
            </Trans>
          </Banner>
        </div>
      ) : null}
      {locked !== null && person !== undefined ? (
        <Suspense fallback={null}>
          <LockScreen me={person} minutes={minutes} reason={locked} />
        </Suspense>
      ) : secondFactor ? (
        <Suspense fallback={null}>
          <SecondFactorScreen />
        </Suspense>
      ) : null}
    </>
  );
}
