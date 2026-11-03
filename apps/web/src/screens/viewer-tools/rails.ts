import type { RailTool } from "../review/viewer-frame.tsx";

export const reviewRail: RailTool[][] = [
  [
    { tool: "select", icon: "select", label: "Select", action: "tselect" },
    { tool: "hand", icon: "hand", label: "Pan", action: "thand" },
  ],
  [
    { tool: "ruler", icon: "ruler", label: "Measure", action: "truler" },
    { tool: "comment", icon: "comment", label: "Comment on an ID", action: "tcomment" },
  ],
  [{ tool: "smart", icon: "smart", label: "Smart select", action: "tsmart", ai: true }],
];

export const annotateRail: RailTool[][] = [
  [
    { tool: "select", icon: "select", label: "Select", action: "tselect" },
    { tool: "hand", icon: "hand", label: "Pan", action: "thand" },
  ],
  [
    { tool: "smart", icon: "smart", label: "Smart select", action: "tsmart", ai: true },
    { tool: "auto", icon: "auto", label: "Auto region", action: "tauto", ai: true },
  ],
  [
    { tool: "poly", icon: "poly", label: "Polygon", action: "tpoly" },
    { tool: "free", icon: "free", label: "Freehand", action: "tfree" },
    { tool: "rect", icon: "rect", label: "Rectangle", action: "trect" },
    { tool: "ellipse", icon: "ellipse", label: "Ellipse", action: "tellipse" },
    { tool: "marker", icon: "marker", label: "Count marker", action: "tmarker" },
  ],
  [
    { tool: "ruler", icon: "ruler", label: "Ruler", action: "truler" },
    { tool: "arrow", icon: "arrow", label: "Arrow", action: "tarrow" },
    { tool: "text", icon: "text", label: "Text", action: "ttext" },
    { tool: "comment", icon: "comment", label: "Comment", action: "tcomment" },
  ],
  [{ tool: "brush", icon: "brush", label: "Brush", action: "tbrush" }],
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
