import type { RoomMessage } from "@parfocal/edge/room-client";

export const WORKLIST_CHANGED = "worklist.changed";

const worklistQueryRoots: ReadonlySet<string> = new Set([
  "/api/me/review-tasks",
  "/api/adjudications",
  "/api/me/assigned-tasks",
  "/api/me/slides",
  "/api/me/home",
]);

export function changesWorklist(event: RoomMessage): boolean {
  return event.kind === WORKLIST_CHANGED;
}

export function isWorklistQuery(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0];
  return typeof root === "string" && worklistQueryRoots.has(root);
}

export function userRoom(userId: string): string {
  return `user:${userId}`;
}
