import { useLingui as useCoreLingui } from "@lingui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { returnFromTourRole, switchToTourRole, useGetMe } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { PersonAvatar } from "@parfocal/ui/components/person";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toPersonInfo } from "../screens/people.ts";
import { okData } from "../screens/placeholder.tsx";
import { type Box, bubblePlace, ringBox } from "./tour-geometry.ts";
import { type ResolvedRoute, resolveRoute } from "./tour-routes.ts";
import { anchorSelectors } from "./tour-selector.ts";
import { type PlacedStep, type TourRole, tourChapters, tourSteps } from "./tour-steps.ts";
import {
  closeTourMenu,
  endTour,
  goToStep,
  playChapter,
  setActing,
  skipChapter,
  type TourMove,
  type TourState,
  useTourMenuOpen,
  useTourState,
} from "./tour-store.ts";

const missingAfter = 4000;

type Shown = { element: Element; alternative: number };

function shownAnchor(anchor: string): Shown | null {
  for (const [alternative, selector] of anchorSelectors(anchor).entries()) {
    for (const element of document.querySelectorAll(selector)) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return { element, alternative };
    }
  }
  return null;
}

function useAnchorBox(anchor: string): { box: Box | null; missing: boolean; alternative: number } {
  const [box, setBox] = useState<Box | null>(null);
  const [alternative, setAlternative] = useState(-1);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    setBox(null);
    setMissing(false);
    let frame = 0;
    const resize = new ResizeObserver(() => schedule());
    let watched: Element | null = null;
    const measure = () => {
      frame = 0;
      const shown = shownAnchor(anchor);
      const element = shown?.element ?? null;
      setAlternative(shown?.alternative ?? -1);
      if (element !== watched) {
        if (watched) resize.unobserve(watched);
        if (element) resize.observe(element);
        watched = element;
      }
      if (element === null) return setBox(null);
      const rect = element.getBoundingClientRect();
      setMissing(false);
      setBox((previous) =>
        previous?.left === rect.left &&
        previous.top === rect.top &&
        previous.width === rect.width &&
        previous.height === rect.height
          ? previous
          : { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      );
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { subtree: true, childList: true, attributes: true });
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const giveUp = window.setTimeout(() => {
      if (shownAnchor(anchor) === null) setMissing(true);
    }, missingAfter);
    schedule();
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(giveUp);
      mutations.disconnect();
      resize.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [anchor]);
  return { box, missing, alternative };
}

async function leaveRole(acting: TourRole) {
  if (acting === "owner") return;
  try {
    await returnFromTourRole();
  } catch {
    return;
  }
}

async function finish(acting: TourRole) {
  await leaveRole(acting);
  if (acting !== "owner") window.location.assign("/");
}

const after = (move: TourMove, acting: TourRole) => {
  if (move === "ended") void finish(acting);
};

function useRoleLabel() {
  const { t } = useLingui();
  return (role: TourRole) =>
    ({
      owner: t`the account that started the tour`,
      researcher: t`researcher`,
      "reviewer-a": t`reviewer A`,
      "reviewer-b": t`reviewer B`,
      adjudicator: t`adjudicator`,
      viewer: t`viewer`,
      annotator: t`annotate expert`,
    })[role];
}

function useStepRoute(step: PlacedStep, ready: boolean) {
  const router = useRouter();
  const location = useLocation();
  const [resolved, setResolved] = useState<ResolvedRoute | undefined>(undefined);
  const queried = useRef(false);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void resolveRoute(step.route).then((found) => {
      if (live) setResolved(found);
    });
    return () => {
      live = false;
    };
  }, [step.route, ready]);
  const here = `${location.pathname}${location.searchStr}`;
  const route = resolved?.route;
  useEffect(() => {
    if (!ready || typeof route !== "string" || step.stay?.test(here) || queried.current) return;
    queried.current = true;
    const [path = "", query = ""] = route.split("?");
    const wanted = new URLSearchParams(query);
    const current = new URLSearchParams(location.searchStr);
    const differs = [...wanted].some(([key, value]) => current.get(key) !== value);
    if (path !== location.pathname || differs) void router.navigate({ href: route });
  }, [route, ready, location.pathname, location.searchStr, here, step.stay, router]);
  return resolved;
}

function useAdvance(step: PlacedStep, state: TourState, ready: boolean) {
  const location = useLocation();
  const href = `${location.pathname}${location.searchStr}`;
  useEffect(() => {
    if (!ready || step.advance.kind !== "click") return;
    const onClick = (event: MouseEvent) => {
      const anchor = shownAnchor(step.anchor)?.element;
      if (anchor && event.target instanceof Node && anchor.contains(event.target)) {
        window.setTimeout(() => after(goToStep(state.index + 1), state.acting), 0);
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [step, state.index, state.acting, ready]);
  useEffect(() => {
    if (!ready || step.advance.kind !== "route") return;
    if (step.advance.pattern.test(href)) after(goToStep(state.index + 1), state.acting);
  }, [step, href, state.index, state.acting, ready]);
}

function RoleSwitch({ step, state }: { step: PlacedStep; state: TourState }) {
  const { t } = useLingui();
  const roleLabel = useRoleLabel();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const switchNow = async () => {
    setBusy(true);
    await leaveRole(state.acting);
    if (step.role !== "owner") {
      try {
        await switchToTourRole({ account: step.role });
      } catch {
        setBusy(false);
        setFailed(true);
        return;
      }
    }
    setActing(step.role);
    const { route } = await resolveRoute(step.route);
    window.location.assign(route ?? "/");
  };
  const who = roleLabel(step.role);
  return (
    <div className="grid gap-2">
      <p>
        <Trans>The next step is done as the {who}.</Trans>
      </p>
      {failed ? (
        <p data-testid="tour-switch-failed">
          <Trans>
            Switching account is off on this server. Sign in as role-{step.role}@parfocal.eu in
            another window, or go on as yourself.
          </Trans>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          variant="secondary"
          disabled={busy}
          data-testid="tour-switch"
          onClick={() => void switchNow()}
        >
          {t`Switch to the ${who}`}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setActing(step.role)}>
          <Trans>Go on as myself</Trans>
        </Button>
      </div>
    </div>
  );
}

function TourBubble({ step, state }: { step: PlacedStep; state: TourState }) {
  const { t } = useLingui();
  const { i18n } = useCoreLingui();
  const roleLabel = useRoleLabel();
  const me = okData(useGetMe().data);
  const ready = state.acting === step.role;
  const resolved = useStepRoute(step, ready);
  useAdvance(step, state, ready);
  const { box, missing, alternative } = useAnchorBox(step.anchor);
  const shownBox = ready ? box : null;
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const bubbleRef = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(220);
  useLayoutEffect(() => {
    const element = bubbleRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const place = bubblePlace(shownBox, size, height);
  const chapter = tourChapters[step.chapter];
  const firstOfChapter = tourSteps[state.index - 1]?.chapter !== step.chapter;
  const ring = shownBox === null ? null : ringBox(shownBox);
  const stop = () => {
    endTour();
    void finish(state.acting);
  };
  return (
    <>
      {ring ? (
        <div
          aria-hidden="true"
          data-testid="tour-ring"
          className="pointer-events-none fixed z-[70] rounded-[10px] border-[3px] border-accent shadow-[0_0_0_5px_color-mix(in_oklab,var(--color-accent)_22%,transparent)] motion-safe:animate-pulse"
          style={{ left: ring.left, top: ring.top, width: ring.width, height: ring.height }}
        />
      ) : null}
      <section
        ref={bubbleRef}
        role="dialog"
        aria-label={t`Tour of the app`}
        data-testid="tour-bubble"
        data-step={step.number}
        data-anchor={step.anchor}
        data-selector={anchorSelectors(step.anchor).join("\n")}
        data-route={
          resolved === undefined
            ? "pending"
            : resolved.route === null
              ? "none"
              : resolved.exact
                ? "exact"
                : "fallback"
        }
        data-match={shownBox === null ? "none" : alternative}
        data-gpu={step.gpu === true ? "yes" : undefined}
        data-advance={step.advance.kind}
        className="fixed z-[71] grid w-75 gap-2 rounded-lg bg-accent p-3 text-body-sm text-on-accent shadow-pop"
        style={{ left: place.left, top: place.top }}
      >
        <p className="text-caption font-semibold tracking-wide uppercase">
          {step.chapter + 1} · {chapter ? i18n._(chapter.title) : ""} ·{" "}
          <Trans>
            Step {step.number} of {tourSteps.length}
          </Trans>
        </p>
        {me ? (
          <p className="flex w-max max-w-full items-center gap-2 rounded-full bg-white/20 py-1 pr-2 pl-1 text-caption font-semibold">
            <PersonAvatar person={toPersonInfo(me)} size={18} />
            <span>
              <Trans>
                You are {me.display_name}, {roleLabel(state.acting)}
              </Trans>
            </span>
          </p>
        ) : null}
        {ready ? <p>{i18n._(step.text)}</p> : <RoleSwitch step={step} state={state} />}
        {ready && step.gpu === true ? (
          <p data-testid="tour-gpu-note" className="font-semibold">
            <Trans>This step uses the GPU. Press Next to skip it.</Trans>
          </p>
        ) : null}
        {ready && resolved?.route === null ? (
          <p>
            <Trans>The seeded data for this step is missing, so the tour stays on this page.</Trans>
          </p>
        ) : null}
        {ready && missing && shownBox === null ? (
          <p data-testid="tour-anchor-missing">
            <Trans>
              This control is not on the page now, so the tour cannot point at it. Press Next.
            </Trans>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="xs" variant="ghost" className="text-on-accent" onClick={stop}>
            <Trans>Stop</Trans>
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="text-on-accent"
            onClick={() => after(skipChapter(), state.acting)}
          >
            <Trans>Skip chapter</Trans>
          </Button>
          <span className="flex-1" />
          {state.index > 0 && !(firstOfChapter && !state.playAll) ? (
            <Button size="xs" variant="secondary" onClick={() => goToStep(state.index - 1)}>
              <Trans>Back</Trans>
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="secondary"
            data-testid="tour-next"
            onClick={() => after(goToStep(state.index + 1), state.acting)}
          >
            {tourSteps[state.index + 1] === undefined ? t`Done` : t`Next`}
          </Button>
        </div>
      </section>
    </>
  );
}

function TourMenu() {
  const { t } = useLingui();
  const { i18n } = useCoreLingui();
  const open = useTourMenuOpen();
  const roleLabel = useRoleLabel();
  return (
    <SmallModal
      open={open}
      onOpenChange={(next) => {
        if (!next) closeTourMenu();
      }}
      title={t`Tour of the app`}
      subtitle={t`A ring shows each control on the real app. Press it or Next to go on.`}
      primaryLabel={t`Play all`}
      onPrimary={() => playChapter(0, true)}
    >
      <ol className="grid gap-2 text-body-sm" aria-label={t`Chapters`}>
        {tourChapters.map((chapter, index) => {
          const title = i18n._(chapter.title);
          const role = roleLabel(chapter.role);
          return (
            <li key={chapter.title.id} className="flex items-center gap-3">
              <span className="flex-1 text-fg">
                {index + 1} · {title}{" "}
                <span className="text-fg-dim">
                  <Trans>as the {role}</Trans>
                </span>
              </span>
              <Button size="xs" variant="secondary" onClick={() => playChapter(index, false)}>
                {t`Play ${title}`}
              </Button>
            </li>
          );
        })}
      </ol>
    </SmallModal>
  );
}

export default function AppTourHost() {
  const state = useTourState();
  const step = state === null ? undefined : tourSteps[state.index];
  return (
    <>
      <TourMenu />
      {state !== null && step !== undefined ? (
        <TourBubble key={`${state.index}-${state.acting}`} step={step} state={state} />
      ) : null}
    </>
  );
}
