import { boxes, type LaneKey, lanes, type MapBox } from "./review-flow.ts";

export type ArrowDirection = "r" | "l" | "u" | "d";

export type MapArrow = {
  d: string;
  kind: "step" | "hand" | "wait";
  heads: { x: number; y: number; direction: ArrowDirection }[];
};

export const grid = {
  x0: 40,
  columnWidth: 118,
  gap: 20,
  boxHeight: 80,
  rowGap: 26,
  head: 34,
  pad: 10,
  band: 34,
  top: 82,
  width: 1440,
  height: 900,
} as const;

export type LaneRect = { y: number; h: number; boxesTop: number };

export type BoxRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  r: number;
  b: number;
};

export type Pill = { x: number; y: number; label: string };

export type Caption = { x: number; y: number; w: number };

export function laneRects(): Record<LaneKey, LaneRect> {
  const rects: Partial<Record<LaneKey, LaneRect>> = {};
  let y = grid.top;
  lanes.forEach((lane, index) => {
    if (index > 0) y += lane.gapBefore ?? grid.band;
    const h = grid.head + lane.rows * grid.boxHeight + (lane.rows - 1) * grid.rowGap + grid.pad;
    rects[lane.key] = { y, h, boxesTop: y + grid.head };
    y += h;
  });
  return rects as Record<LaneKey, LaneRect>;
}

export const columnX = (column: number) => grid.x0 + column * (grid.columnWidth + grid.gap);

export const columnCentre = (column: number) => columnX(column) + grid.columnWidth / 2;

export function boxRect(box: MapBox, rects: Record<LaneKey, LaneRect>): BoxRect {
  const span = box.span ?? 1;
  const x = columnX(box.column);
  const w = span * grid.columnWidth + (span - 1) * grid.gap;
  const y = rects[box.lane].boxesTop + (box.row ?? 0) * (grid.boxHeight + grid.rowGap);
  const h = grid.boxHeight;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: x + w, b: y + h };
}

export function boxRects(rects = laneRects()): Record<string, BoxRect> {
  return Object.fromEntries(boxes.map((box) => [box.id, boxRect(box, rects)]));
}

export type MapLayout = {
  width: number;
  height: number;
  lanes: Record<LaneKey, LaneRect>;
  boxes: Record<string, BoxRect>;
  arrows: MapArrow[];
  pills: Pill[];
  wait: Caption;
  note: Caption;
};

export function mapLayout(): MapLayout {
  const rects = laneRects();
  const all = boxRects(rects);
  const at = (id: string) => {
    const rect = all[id];
    if (rect === undefined) throw new Error(`the map has no box ${id}`);
    return rect;
  };
  const arrows: MapArrow[] = [];
  const pills: Pill[] = [];
  const head = (x: number, y: number, direction: ArrowDirection) => ({ x, y, direction });
  const step = (d: string, x: number, y: number, direction: ArrowDirection) =>
    arrows.push({ d, kind: "step", heads: [head(x, y, direction)] });
  const right = (from: string, to: string) => {
    const a = at(from);
    const b = at(to);
    step(`M${a.r + 3} ${a.cy} H${b.x - 3}`, b.x - 3, a.cy, "r");
  };

  right("upload", "runmodel");
  right("runmodel", "task");
  right("task", "team");
  const team = at("team");
  const disagree = at("disagree");
  arrows.push({
    d: `M${team.r + 3} ${team.cy} H${disagree.x - 3}`,
    kind: "wait",
    heads: [head(disagree.x - 3, team.cy, "r")],
  });
  right("disagree", "signoff");
  right("worklist", "guided");
  right("guided", "gallery");
  right("gallery", "done");
  right("done", "next");

  const fullViewer = at("case");
  const guided = at("guided");
  const joinX = fullViewer.r + grid.gap / 2;
  arrows.push({
    d: `M${fullViewer.r + 3} ${fullViewer.cy} H${joinX} V${guided.cy + 1}`,
    kind: "step",
    heads: [],
  });
  step(
    `M${guided.cx - 7} ${guided.b + 3} V${fullViewer.y - 3}`,
    guided.cx - 7,
    fullViewer.y - 3,
    "d",
  );
  step(`M${guided.cx + 7} ${fullViewer.y - 3} V${guided.b + 3}`, guided.cx + 7, guided.b + 3, "u");
  const next = at("next");
  const reopen = at("reopen");
  step(`M${next.cx} ${next.b + 3} V${reopen.y - 3}`, next.cx, reopen.y - 3, "d");

  right("ccase", "creport");
  right("creport", "crsign");
  const creport = at("creport");
  const crcosign = at("crcosign");
  const reportJoinX = creport.r + grid.gap / 2;
  step(
    `M${reportJoinX} ${creport.cy} V${crcosign.cy} H${crcosign.x - 3}`,
    crcosign.x - 3,
    crcosign.cy,
    "r",
  );
  const crsign = at("crsign");
  const signed = at("signed");
  step(`M${crsign.r + 3} ${crsign.cy} H${signed.x - 3}`, signed.x - 3, crsign.cy, "r");
  const cosign = at("cosign");
  const cosignJoinX = cosign.r + grid.gap / 2;
  arrows.push({
    d: `M${cosign.r + 3} ${cosign.cy} H${cosignJoinX} V${signed.cy + 1}`,
    kind: "step",
    heads: [],
  });

  const band1 = rects.res.y + rects.res.h + grid.band / 2;
  const band2 = rects.rev.y + rects.rev.h + grid.band / 2;
  const task = at("task");
  const worklist = at("worklist");
  arrows.push({
    d: `M${task.cx} ${task.b + 3} V${worklist.y - 3}`,
    kind: "hand",
    heads: [head(task.cx, worklist.y - 3, "d")],
  });
  pills.push({ x: task.cx, y: band1, label: "Task sent" });
  const submittedX = columnCentre(6);
  arrows.push({
    d: `M${submittedX} ${next.y - 3} V${disagree.b + 3}`,
    kind: "hand",
    heads: [head(submittedX, disagree.b + 3, "u")],
  });
  pills.push({ x: submittedX, y: band1, label: "Submitted" });
  const adjudicate = at("adjudicate");
  const decidedX = columnCentre(7);
  arrows.push({
    d: `M${decidedX} ${disagree.b + 4} V${adjudicate.y - 4}`,
    kind: "hand",
    heads: [head(decidedX, adjudicate.y - 3, "d"), head(decidedX, disagree.b + 3, "u")],
  });
  pills.push({ x: decidedX, y: band1, label: "Decided" });
  pills.push({ x: decidedX, y: band2, label: "Sent to the adjudicator" });
  const signoff = at("signoff");
  const evaluation = at("evaluation");
  arrows.push({
    d: `M${signoff.cx} ${signoff.b + 3} V${band1} H${evaluation.cx} V${evaluation.b + 3}`,
    kind: "hand",
    heads: [head(evaluation.cx, evaluation.b + 3, "u")],
  });
  pills.push({ x: (signoff.cx + evaluation.cx) / 2, y: band1, label: "Signed off" });
  arrows.push({
    d: `M${crcosign.r + 3} ${crcosign.cy} H${cosign.x - 3}`,
    kind: "hand",
    heads: [head(cosign.x - 3, crcosign.cy, "r")],
  });
  pills.push({ x: (crcosign.r + cosign.x) / 2, y: crcosign.cy, label: "Sent for co-sign" });

  const noteX = columnX(6);
  return {
    width: grid.width,
    height: grid.height,
    lanes: rects,
    boxes: all,
    arrows,
    pills,
    wait: { x: team.r, y: team.cy - 24, w: disagree.x - team.r },
    note: { x: noteX, y: rects.cli.boxesTop, w: grid.width - noteX - 40 },
  };
}
