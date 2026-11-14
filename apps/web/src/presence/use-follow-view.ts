import type { RoomSignal } from "@parfocal/edge/room-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { hearUnlessBlinded, sendUnlessBlinded } from "./blinded.ts";
import { onPointer, showCursors } from "./cursor-bridge.ts";
import {
  heardViewOf,
  type SharedCamera,
  sameCamera,
  stopFrame,
  throttle,
  VIEW_HEARTBEAT_MS,
  VIEW_SEND_MS,
  viewFrame,
} from "./follow-view.ts";
import {
  nextPresence,
  PRESENCE_JOINED,
  PRESENCE_LEFT,
  type Sighting,
  viewersOf,
} from "./presence-state.ts";
import { cursorSender, heardCursorOf, type SlideShare, shownOnStage } from "./shared-cursor.ts";
import { useStageEngine } from "./stage-engines.ts";
import { useRoomEvents } from "./use-room-presence.ts";

const nobody: ReadonlyMap<string, Sighting> = new Map();
const noSharers: readonly string[] = [];

export type FollowView = {
  readonly present: string[];
  readonly available: boolean;
  readonly sharing: boolean;
  readonly sharers: readonly string[];
  readonly following: string | null;
  readonly setSharing: (sharing: boolean) => void;
  readonly follow: (user: string | null) => void;
};

export function useFollowView(
  slideId: string,
  me: string | undefined,
  blinded: boolean,
): FollowView {
  const engine = useStageEngine(slideId);
  const blind = useRef(blinded);
  blind.current = blinded;
  const isBlinded = useCallback(() => blind.current, []);
  const [present, setPresent] = useState(nobody);
  const [sharers, setSharers] = useState(noSharers);
  const [sharing, setSharingState] = useState(false);
  const [following, setFollowing] = useState<string | null>(null);
  const views = useRef(new Map<string, SharedCamera>());
  const cursors = useRef(new Map<string, SlideShare>());
  const applied = useRef<SharedCamera | null>(null);
  const applying = useRef(false);
  const send = useRef<(signal: RoomSignal) => boolean>(() => false);
  const state = useRef({ engine, sharing, following });
  state.current = { engine, sharing, following };

  const apply = useCallback((camera: SharedCamera) => {
    const stage = state.current.engine;
    if (stage === null) return;
    applying.current = true;
    stage.stopMotion();
    stage.setCamera(camera);
    applied.current = stage.getCamera();
    applying.current = false;
  }, []);

  const sendNow = useCallback(() => {
    const stage = state.current.engine;
    if (stage !== null && state.current.sharing) send.current(viewFrame(stage.getCamera()));
  }, []);

  const publish = useCallback(
    (following: string | null = state.current.following) => {
      const drawn = blind.current
        ? []
        : shownOnStage(cursors.current, (user) => views.current.has(user), following);
      showCursors(slideId, drawn);
    },
    [slideId],
  );

  const forget = useCallback(
    (user: string) => {
      views.current.delete(user);
      cursors.current.delete(user);
      publish();
      setSharers((known) => (known.includes(user) ? known.filter((id) => id !== user) : known));
      setFollowing((current) => (current === user ? null : current));
    },
    [publish],
  );

  useEffect(() => {
    if (engine === null || !sharing || blinded) return;
    const sendCamera = () => send.current(viewFrame(engine.getCamera()));
    const paced = throttle(sendCamera, VIEW_SEND_MS);
    paced.call();
    const unsubscribe = engine.subscribeCamera(paced.call);
    const heartbeat = setInterval(sendCamera, VIEW_HEARTBEAT_MS);
    return () => {
      unsubscribe();
      paced.cancel();
      clearInterval(heartbeat);
      send.current(stopFrame);
    };
  }, [engine, sharing, blinded]);

  useEffect(() => {
    if (engine === null || !sharing || blinded) return;
    const sender = cursorSender((signal) => send.current(signal));
    const unsubscribe = onPointer(slideId, (at) => {
      if (at === null) sender.leave();
      else sender.move(at);
    });
    return () => {
      unsubscribe();
      sender.cancel();
    };
  }, [engine, sharing, slideId, blinded]);

  useEffect(() => {
    publish(following);
    return () => showCursors(slideId, []);
  }, [slideId, following, publish]);

  useEffect(() => {
    if (engine === null || following === null) return;
    return engine.subscribeCamera(() => {
      if (applying.current) return;
      if (applied.current !== null && sameCamera(engine.getCamera(), applied.current)) return;
      setFollowing(null);
    });
  }, [engine, following]);

  useEffect(() => {
    if (!blinded) return;
    views.current.clear();
    cursors.current.clear();
    setSharers(noSharers);
    setSharingState(false);
    setFollowing(null);
    publish();
  }, [blinded, publish]);

  const sendToRoom = useRoomEvents(
    `slide:${slideId}`,
    me,
    (event) => {
      setPresent((known) => nextPresence(known, event, me ?? ""));
      const user = event.ids["user"];
      if (event.kind === PRESENCE_JOINED) sendNow();
      else if (event.kind === PRESENCE_LEFT && user !== undefined) forget(user);
    },
    () => {
      setPresent(nobody);
      views.current.clear();
      cursors.current.clear();
      publish();
      setSharers(noSharers);
      setFollowing(null);
      sendNow();
    },
    hearUnlessBlinded(isBlinded, (signal) => {
      const pointed = heardCursorOf(signal, me ?? "");
      if (pointed !== null) {
        if (pointed.gone) cursors.current.delete(pointed.user);
        else cursors.current.set(pointed.user, pointed.at);
        publish();
        return;
      }
      const heard = heardViewOf(signal, me ?? "");
      if (heard === null) return;
      if (heard.stop) {
        forget(heard.user);
        return;
      }
      const known = views.current.has(heard.user);
      views.current.set(heard.user, heard.camera);
      if (!known) publish();
      setSharers((known) => (known.includes(heard.user) ? known : [...known, heard.user]));
      if (state.current.following === heard.user) apply(heard.camera);
    }),
  );
  send.current = sendUnlessBlinded(isBlinded, sendToRoom);

  const setSharing = useCallback((next: boolean) => {
    if (next) setFollowing(null);
    setSharingState(next);
  }, []);

  const follow = useCallback(
    (user: string | null) => {
      const camera = user === null ? undefined : views.current.get(user);
      if (user === null || camera === undefined) {
        setFollowing(null);
        return;
      }
      setSharingState(false);
      apply(camera);
      setFollowing(user);
    },
    [apply],
  );

  return {
    present: viewersOf(present),
    available: engine !== null && !blinded,
    sharing,
    sharers,
    following,
    setSharing,
    follow,
  };
}
