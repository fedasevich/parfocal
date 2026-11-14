import { useEffect, useRef, useState } from "react";

export type PopoutKind = "minimap" | "inspector";

export type MapViewport = [number, number, number, number];

export type PopoutMessage =
  | { type: "hello" }
  | { type: "view"; viewport: MapViewport; magnification: number }
  | { type: "move"; centre: [number, number] };

export const popoutChannelName = "parfocal-popout";

export function popoutPath(kind: PopoutKind): string {
  return `/popout?kind=${kind}`;
}

type ScreenDetail = { isPrimary: boolean; availLeft: number; availTop: number };

type ScreenDetailsWindow = Window & {
  getScreenDetails?: () => Promise<{ screens: ScreenDetail[] }>;
};

async function otherScreen(): Promise<ScreenDetail | null> {
  const host = window as ScreenDetailsWindow;
  if (!host.getScreenDetails || !window.screen.isExtended) return null;
  try {
    const details = await host.getScreenDetails();
    return details.screens.find((screen) => !screen.isPrimary) ?? null;
  } catch {
    return null;
  }
}

export async function openPopout(kind: PopoutKind): Promise<Window | null> {
  const screen = await otherScreen();
  const placement = screen
    ? `,left=${screen.availLeft},top=${screen.availTop},width=720,height=720`
    : ",width=520,height=620";
  return window.open(popoutPath(kind), `parfocal-popout-${kind}`, `popup=yes${placement}`);
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
