import { useEffect, useRef, useState } from "react";

export type PopoutKind = "minimap" | "inspector";

export type MapViewport = [number, number, number, number];

export type PopoutMessage =
  | { type: "hello" }
  | { type: "view"; viewport: MapViewport; magnification: number }
  | { type: "move"; centre: [number, number] }
  | { type: "select"; tab: string | null; object: string | null };

export const popoutChannelName = "parfocal-popout";

const slidePath = /^\/projects\/([^/]+)\/slides\/([^/]+)/;

export function popoutPath(kind: PopoutKind, here: Location = window.location): string {
  const query = new URLSearchParams({ kind });
  const match = slidePath.exec(here.pathname);
  if (match?.[1] && match[2]) {
    query.set("project", decodeURIComponent(match[1]));
    query.set("slide", decodeURIComponent(match[2]));
  }
  const current = new URLSearchParams(here.search);
  for (const key of ["task", "scene", "tab", "object"]) {
    const value = current.get(key);
    if (value) query.set(key, value);
  }
  return `/popout?${query.toString()}`;
}

type ScreenDetail = { isPrimary: boolean; availLeft: number; availTop: number };

type ScreenDetailsWindow = Window & {
  getScreenDetails?: () => Promise<{ screens: ScreenDetail[] }>;
  screen: Screen & { isExtended?: boolean };
};

async function otherScreen(): Promise<ScreenDetail | null> {
  const host = window as ScreenDetailsWindow;
  if (!host.getScreenDetails || !host.screen.isExtended) return null;
  try {
    const details = await host.getScreenDetails();
    return details.screens.find((screen) => !screen.isPrimary) ?? null;
  } catch {
    return null;
  }
}

function popup(kind: PopoutKind, placement: string): Window | null {
  return window.open(popoutPath(kind), `parfocal-popout-${kind}`, `popup=yes${placement}`);
}

const plainPlacement = ",width=520,height=620";

export function openPopout(kind: PopoutKind): Promise<Window | null> {
  const host = window as ScreenDetailsWindow;
  if (!host.getScreenDetails || !host.screen.isExtended) {
    return Promise.resolve(popup(kind, plainPlacement));
  }
  return otherScreen().then((screen) =>
    popup(
      kind,
      screen
        ? `,left=${screen.availLeft},top=${screen.availTop},width=720,height=720`
        : plainPlacement,
    ),
  );
}

export function openPopoutChannel(): BroadcastChannel {
  return new BroadcastChannel(popoutChannelName);
}

export function useMainPopoutSync({
  viewport,
  magnification,
  onMoveTo,
}: {
  viewport: MapViewport;
  magnification: number;
  onMoveTo: (centre: [number, number]) => void;
}): void {
  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef({ viewport, magnification });
  latest.current = { viewport, magnification };
  const move = useRef(onMoveTo);
  move.current = onMoveTo;

  useEffect(() => {
    const opened = openPopoutChannel();
    channel.current = opened;
    opened.onmessage = (event: MessageEvent<PopoutMessage>) => {
      if (event.data.type === "move") move.current(event.data.centre);
      if (event.data.type === "hello") opened.postMessage({ type: "view", ...latest.current });
    };
    return () => {
      opened.close();
      channel.current = null;
    };
  }, []);

  const [x, y, width, height] = viewport;
  useEffect(() => {
    channel.current?.postMessage({
      type: "view",
      viewport: [x, y, width, height],
      magnification,
    } satisfies PopoutMessage);
  }, [x, y, width, height, magnification]);
}

export function useSelectionSync({
  tab,
  object,
  ask,
  onRemote,
}: {
  tab: string | undefined;
  object: string | undefined;
  ask: boolean;
  onRemote: (change: { tab?: string | undefined; object?: string | undefined }) => void;
}): void {
  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef({ tab, object });
  latest.current = { tab, object };
  const remote = useRef(onRemote);
  remote.current = onRemote;

  useEffect(() => {
    const opened = openPopoutChannel();
    channel.current = opened;
    const announce = () =>
      opened.postMessage({
        type: "select",
        tab: latest.current.tab ?? null,
        object: latest.current.object ?? null,
      } satisfies PopoutMessage);
    opened.onmessage = (event: MessageEvent<PopoutMessage>) => {
      if (event.data.type === "hello" && !ask) announce();
      if (event.data.type !== "select") return;
      const { tab: nextTab, object: nextObject } = event.data;
      if (
        nextTab === (latest.current.tab ?? null) &&
        nextObject === (latest.current.object ?? null)
      ) {
        return;
      }
      remote.current({ tab: nextTab ?? undefined, object: nextObject ?? undefined });
    };
    if (ask) opened.postMessage({ type: "hello" } satisfies PopoutMessage);
    return () => {
      opened.close();
      channel.current = null;
    };
  }, [ask]);

  useEffect(() => {
    channel.current?.postMessage({
      type: "select",
      tab: tab ?? null,
      object: object ?? null,
    } satisfies PopoutMessage);
  }, [tab, object]);
}

export type PopoutState = {
  viewport: MapViewport | null;
  magnification: number;
  moveTo: (centre: [number, number]) => void;
};

export function usePopoutState(): PopoutState {
  const channel = useRef<BroadcastChannel | null>(null);
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const [magnification, setMagnification] = useState(0);

  useEffect(() => {
    const opened = openPopoutChannel();
    channel.current = opened;
    opened.onmessage = (event: MessageEvent<PopoutMessage>) => {
      if (event.data.type !== "view") return;
      setViewport(event.data.viewport);
      setMagnification(event.data.magnification);
    };
    opened.postMessage({ type: "hello" } satisfies PopoutMessage);
    return () => {
      opened.close();
      channel.current = null;
    };
  }, []);

  return {
    viewport,
    magnification,
    moveTo: (centre) =>
      channel.current?.postMessage({ type: "move", centre } satisfies PopoutMessage),
  };
}
