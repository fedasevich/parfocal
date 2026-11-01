import type { RailTool } from "../review/viewer-frame.tsx";

export const reviewRail: RailTool[][] = [
  [
    { tool: "select", icon: "select", label: "Select", key: "V" },
    { tool: "hand", icon: "hand", label: "Pan", key: "H" },
  ],
  [
    { tool: "ruler", icon: "ruler", label: "Measure", key: "L" },
    { tool: "comment", icon: "comment", label: "Comment on an ID", key: "C" },
  ],
  [{ tool: "smart", icon: "smart", label: "Smart select", key: "S", ai: true }],
];

export const annotateRail: RailTool[][] = [
  [
    { tool: "select", icon: "select", label: "Select", key: "V" },
    { tool: "hand", icon: "hand", label: "Pan", key: "H" },
  ],
  [
    { tool: "smart", icon: "smart", label: "Smart select", key: "S", ai: true },
    { tool: "auto", icon: "auto", label: "Auto region", key: "U", ai: true },
  ],
  [
    { tool: "poly", icon: "poly", label: "Polygon", key: "P" },
    { tool: "free", icon: "free", label: "Freehand", key: "⇧P" },
    { tool: "rect", icon: "rect", label: "Rectangle", key: "R" },
    { tool: "ellipse", icon: "ellipse", label: "Ellipse", key: "O" },
    { tool: "marker", icon: "marker", label: "Count marker", key: "M" },
  ],
  [
    { tool: "ruler", icon: "ruler", label: "Ruler", key: "L" },
    { tool: "arrow", icon: "arrow", label: "Arrow", key: "⇧L" },
    { tool: "text", icon: "text", label: "Text", key: "T" },
    { tool: "comment", icon: "comment", label: "Comment", key: "C" },
  ],
  [{ tool: "brush", icon: "brush", label: "Brush", key: "B" }],
];

export const toolHints: Record<string, string[]> = {
  select: ["Drag on empty tissue for a marquee", "⇧ adds to the selection"],
  hand: ["Drag to pan", "Space+drag pans in any tool"],
  smart: ["Click a nucleus", "⇧click adds, right-click removes", "Enter accepts"],
  poly: ["Click to add points", "Enter or double-click closes", "⇧ snaps to 45°"],
  free: ["Drag to draw", "Release to close the shape"],
  rect: ["Drag corner to corner", "⇧ makes a square"],
  ellipse: ["Drag corner to corner", "⇧ makes a circle"],
  marker: ["Click to count", "Class 1 tumor"],
  ruler: ["Drag to measure", "⇧ snaps to 45°"],
  arrow: ["Drag to point at something"],
  text: ["Click and type", "Enter keeps, Esc drops"],
  comment: ["Click to pin a thread", "Enter posts"],
  brush: ["24 px", "⇧ erases", "Paints the tumor map"],
};
