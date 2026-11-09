import type { ThreadCreate } from "@parfocal/api-client";
import { type Mentionable, toMentionTokens } from "./mention-picking.ts";
import type { Camera } from "./slide-still.tsx";

export type Pin = { x: number; y: number };

type Size = { width: number; height: number };

type Point = { x: number; y: number };

export const clickSlop = 4;

export const isClick = (from: Point, to: Point) =>
  Math.hypot(to.x - from.x, to.y - from.y) < clickSlop;

const tenth = (value: number) => Math.round(value * 10) / 10;

export const slidePoint = (camera: Camera, size: Size, at: Point): Pin => ({
  x: tenth(camera.x + (at.x - size.width / 2) / camera.scale),
  y: tenth(camera.y + (at.y - size.height / 2) / camera.scale),
});

export const pinOnScreen = (camera: Camera, size: Size, pin: Pin): Point => ({
  x: (pin.x - camera.x) * camera.scale + size.width / 2,
  y: (pin.y - camera.y) * camera.scale + size.height / 2,
});

export const pinForClick = (tool: string | undefined, pin: Pin): Pin | null =>
  tool === "comment" ? pin : null;

export const pinTitle = (text: string) => {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
};

export function pinThread(
  pin: Pin,
  text: string,
  members: Pick<Mentionable, "id" | "name">[] = [],
): ThreadCreate | null {
  const body = text.trim();
  if (!body) return null;
  return {
    title: pinTitle(body),
    body: toMentionTokens(body, members),
    anchor: {
      kind: "point",
      object_id: null,
      geometry: { type: "Point", coordinates: [pin.x, pin.y] },
      offset: null,
    },
  };
}

export type CommentMode = { tool: string | undefined; pin: Pin | null };

export const escapeComment = (mode: CommentMode): CommentMode | null =>
  mode.tool === "comment" || mode.pin ? { tool: undefined, pin: null } : null;
