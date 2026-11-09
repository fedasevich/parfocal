import type { Message } from "@parfocal/api-client";
import type { CommentMessage } from "@parfocal/ui/components/comment-thread";
import type { ThreadMeasurement } from "@parfocal/ui/components/thread-popover";
import type { PersonInfo } from "@parfocal/ui/lib/avatar-colours";
import { buildMeasurementRows } from "../measure/measurement-list.ts";
import { relativeTime } from "../screens/format.ts";
import { fromMentionTokens } from "../screens/review/mention-picking.ts";
import type { AnnotationDocument } from "./document.ts";
import type { Point } from "./polygon-draft.ts";

export const popoverWidth = 320;
export const popoverGap = 14;
export const popoverEdge = 8;
export const popoverMaxHeight = 460;

const unknownAuthor: PersonInfo = { name: "Someone", initials: "?", color: "#64748b" };

export function threadMessages(
  messages: readonly Message[],
  personOf: (userId: string) => PersonInfo | undefined,
  meId: string | undefined,
  at: Date,
): CommentMessage[] {
  return messages.map((message) => ({
    id: message.id,
    author: personOf(message.author_id) ?? unknownAuthor,
    you: message.author_id === meId,
    at: relativeTime(new Date(message.created_at), at),
    text: fromMentionTokens(message.body, (userId) => personOf(userId)?.name),
  }));
}

export function threadMeasurement(
  doc: AnnotationDocument,
  threadId: string,
  micronsPerPixel: number | null,
): ThreadMeasurement | undefined {
  const shapeId = doc.pins.get(threadId)?.shapeId;
  if (shapeId === null || shapeId === undefined) return undefined;
  const row = buildMeasurementRows(doc, micronsPerPixel, new Map()).find(
    (candidate) => candidate.shapeId === shapeId,
  );
  if (row === undefined) return undefined;
  const label = `${row.label} · ${row.category}`;
  if (row.kind === "ruler") return { label, values: [{ name: "Length", value: row.value }] };
  return {
    label,
    values: [
      { name: "Area", value: row.area ?? "" },
      { name: "Perimeter", value: row.value },
    ],
  };
}

export type PopoverSpot = { left: number; top: number };

export function popoverSpot(
  pin: Point,
  stage: { width: number; height: number },
  height = popoverMaxHeight,
): PopoverSpot {
  const toRight = pin.x + popoverGap + popoverWidth + popoverEdge <= stage.width;
  const left = toRight ? pin.x + popoverGap : pin.x - popoverGap - popoverWidth;
  const clampedLeft = Math.max(
    popoverEdge,
    Math.min(left, stage.width - popoverWidth - popoverEdge),
  );
  const top = Math.max(
    popoverEdge,
    Math.min(pin.y - 28, stage.height - Math.min(height, stage.height) - popoverEdge),
  );
  return { left: clampedLeft, top };
}
