import { effectiveMotionMode, type MotionMode, reducedMotionQuery } from "@parfocal/tokens";

export type TransitionKind = "open" | "focus" | "back";

type Update = () => void | Promise<void>;

type Handle = {
  ready: Promise<unknown>;
  finished: Promise<unknown>;
  updateCallbackDone: Promise<unknown>;
  skipTransition(): void;
};

type Named = {
  style: { viewTransitionName: string };
  closest(selector: string): Named | null;
};

type CutEvent = { type: string };

export type TransitionHost = {
  startViewTransition?: (update: () => Promise<void>) => Handle;
  documentElement: {
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
  };
  defaultView?: { matchMedia?(query: string): { matches: boolean } } | null;
  activeElement: Named | null;
  querySelector(selector: string): Named | null;
  addEventListener(type: string, listener: (event: CutEvent) => void, capture: boolean): void;
  removeEventListener(type: string, listener: (event: CutEvent) => void, capture: boolean): void;
};

export const stageName = "stage";
export const sourceSelector = "[data-vt-source]";
export const targetSelector = "[data-vt-target]";
export const cutEvents = ["keydown", "pointerdown"] as const;

const myWork = "/my-work";
const slidePath = /^\/(tasks\/[^/]+\/(guided|cells)|projects\/[^/]+\/slides\/[^/]+)$/;
const submittedPath = /^\/tasks\/[^/]+\/submitted$/;

export function routeTransition(from: string | undefined, to: string): TransitionKind | null {
  if (from === undefined || from === to) return null;
  if (from === myWork && slidePath.test(to)) return "open";
  if (to === myWork && (slidePath.test(from) || submittedPath.test(from))) return "back";
  return null;
}

const motionModeOf = (value: string | null): MotionMode =>
  value === "presenting" || value === "reduced" ? value : "normal";

export function motionAllowsTransitions(host: TransitionHost): boolean {
  const prefersReduced = host.defaultView?.matchMedia?.(reducedMotionQuery).matches ?? false;
  const mode = motionModeOf(host.documentElement.getAttribute("data-motion"));
  return effectiveMotionMode(mode, prefersReduced) !== "reduced";
}

function sourceOf(host: TransitionHost): Named | null {
  return (
    host.activeElement?.closest(sourceSelector) ??
    host.querySelector(`${sourceSelector}[aria-selected="true"]`)
  );
}

export const targetWaitMs = 300;
const targetPollMs = 10;

async function renderedTarget(host: TransitionHost): Promise<Named | null> {
  for (let waited = 0; waited < targetWaitMs; waited += targetPollMs) {
    const found = host.querySelector(targetSelector);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, targetPollMs));
  }
  return host.querySelector(targetSelector);
}

export function createTransitions(host: TransitionHost | undefined) {
  let current: { handle: Handle; clear: () => void } | null = null;

  const skip = () => {
    if (current === null) return;
    const { handle, clear } = current;
    current = null;
    clear();
    handle.skipTransition();
  };

  const run = async (update: Update, kind: TransitionKind | null): Promise<void> => {
    if (
      host === undefined ||
      kind === null ||
      typeof host.startViewTransition !== "function" ||
      !motionAllowsTransitions(host)
    ) {
      await update();
      return;
    }
    skip();
    const source = sourceOf(host);
    let target: Named | null = null;
    const clear = () => {
      if (source) source.style.viewTransitionName = "";
      if (target) target.style.viewTransitionName = "";
      host.documentElement.removeAttribute("data-vt");
    };
    if (source) source.style.viewTransitionName = stageName;
    host.documentElement.setAttribute("data-vt", kind);
    const handle = host.startViewTransition(async () => {
      if (source) source.style.viewTransitionName = "";
      await update();
      target = await renderedTarget(host);
      if (target) target.style.viewTransitionName = stageName;
    });
    const entry = { handle, clear };
    current = entry;
    handle.ready.catch(() => undefined);
    void handle.finished
      .catch(() => undefined)
      .then(() => {
        if (current !== entry) return;
        current = null;
        clear();
      });
    await handle.updateCallbackDone;
  };

  const listen = () => {
    if (host === undefined) return () => undefined;
    const cut = () => skip();
    for (const type of cutEvents) host.addEventListener(type, cut, true);
    return () => {
      for (const type of cutEvents) host.removeEventListener(type, cut, true);
    };
  };

  return { run, skip, listen, active: () => current !== null };
}

export const viewTransitions = createTransitions(
  typeof document === "undefined" ? undefined : (document as unknown as TransitionHost),
);
