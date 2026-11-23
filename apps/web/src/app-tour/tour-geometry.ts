export type Box = { left: number; top: number; width: number; height: number };

export type Viewport = { width: number; height: number };

export const ringPad = 6;
export const bubbleWidth = 300;
const gap = 12;
const edge = 8;

export const ringBox = (box: Box): Box => ({
  left: box.left - ringPad,
  top: box.top - ringPad,
  width: box.width + ringPad * 2,
  height: box.height + ringPad * 2,
});

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

const overlaps = (a: Box, b: Box) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

export function bubblePlace(
  box: Box | null,
  view: Viewport,
  bubbleHeight: number,
): { left: number; top: number } {
  if (box === null) {
    return {
      left: clamp((view.width - bubbleWidth) / 2, edge, view.width - bubbleWidth - edge),
      top: clamp(view.height - bubbleHeight - 24, edge, view.height - bubbleHeight - edge),
    };
  }
  const ring = ringBox(box);
  const centred = ring.left + ring.width / 2 - bubbleWidth / 2;
  const middle = ring.top + ring.height / 2 - bubbleHeight / 2;
  const candidates = [
    { left: centred, top: ring.top + ring.height + gap },
    { left: centred, top: ring.top - bubbleHeight - gap },
    { left: ring.left + ring.width + gap, top: middle },
    { left: ring.left - bubbleWidth - gap, top: middle },
  ].map((place) => ({
    left: clamp(place.left, edge, view.width - bubbleWidth - edge),
    top: clamp(place.top, edge, view.height - bubbleHeight - edge),
  }));
  const free = candidates.find(
    (place) => !overlaps({ ...place, width: bubbleWidth, height: bubbleHeight }, ring),
  );
  return free ?? { left: edge, top: edge };
}
