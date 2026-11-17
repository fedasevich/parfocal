import { ApiError, getRoomAccess } from "@parfocal/api-client";
import type { RoomTicket } from "@parfocal/edge/room-client";

export const firstPauseMs = 2 * 60_000;
export const maxPauseMs = 15 * 60_000;

type Answer = { readonly data: { readonly token: string; readonly lifetime_seconds: number } };

export type RoomAccess = {
  readonly ticket: (room: string) => Promise<RoomTicket | null>;
  readonly reconnect: () => void;
  readonly pausedUntil: () => number;
};

export class RealtimeUnavailable extends Error {
  constructor() {
    super("Realtime is unavailable for now");
    this.name = "RealtimeUnavailable";
  }
}

const statusOf = (error: unknown) => (error instanceof ApiError ? error.status : null);

export function pauseFor(pauses: number): number {
  return Math.min(firstPauseMs * 2 ** pauses, maxPauseMs);
}

export function createRoomAccess(
  ask: (room: string) => Promise<Answer>,
  clock: () => number = Date.now,
): RoomAccess {
  let pausedUntil = 0;
  let pauses = 0;
  return {
    async ticket(room) {
      if (clock() < pausedUntil) throw new RealtimeUnavailable();
      try {
        const answer = await ask(room);
        pauses = 0;
        pausedUntil = 0;
        return { token: answer.data.token, lifetimeSeconds: answer.data.lifetime_seconds };
      } catch (error) {
        const status = statusOf(error);
        if (status === 403 || status === 404) return null;
        if (status === 503) {
          pausedUntil = clock() + pauseFor(pauses);
          pauses += 1;
        }
        throw error;
      }
    },
    reconnect() {
      pausedUntil = 0;
    },
    pausedUntil: () => pausedUntil,
  };
}

export const roomAccess = createRoomAccess(async (room) => {
  const response = await getRoomAccess(room);
  if (response.status === 200) return response;
  throw new ApiError("bad-request", response.status);
});

if (typeof window !== "undefined") {
  window.addEventListener("online", () => roomAccess.reconnect());
}
