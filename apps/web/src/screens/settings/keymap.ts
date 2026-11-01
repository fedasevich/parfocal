import type { ShortcutSource } from "@parfocal/ui/components/shortcut-editor";

export type KeyContext = "all" | "review";

export type KeyAction = {
  id: string;
  name: string;
  keys: string[];
  source: ShortcutSource;
  group: string;
  context: KeyContext;
  range?: boolean;
  direction?: boolean;
  hold?: boolean;
  sequence?: boolean;
  safe?: boolean;
  fixed?: boolean;
  note?: string;
};

type Row = [string, string, string[], ShortcutSource, Partial<KeyAction>?];

const keymap: [string, KeyContext, Row[]][] = [
  [
    "Move around",
    "all",
    [
      ["zoomin", "Zoom in", ["="], "clin"],
      ["zoomout", "Zoom out", ["-"], "clin"],
      ["fit", "Fit the slide", ["0"], "new"],
      ["mag", "Objective 1.25× to 40×", ["⌥1 … ⌥6"], "clin", { range: true }],
      ["pan", "Pan", ["Arrows"], "clin", { direction: true }],
      ["peek", "Whole slide", ["Z"], "new", { hold: true }],
      ["prevslide", "Previous slide", ["Q"], "clin"],
      [
        "nextslide",
        "Next slide",
        ["E"],
        "clin",
        { note: "full viewer only. Guided review opens the next slide after Submit" },
      ],
      ["area", "Go to AI area n", ["G then 1 … 9"], "new", { sequence: true }],
      ["brightup", "Slide brighter", ["⌥↑"], "new"],
      ["brightdown", "Slide dimmer", ["⌥↓"], "new"],
    ],
  ],
  [
    "Deciding",
    "review",
    [
      ["dagree", "Agree", ["K"], "new", { note: "in the style Agree with the AI" }],
      ["ddisagree", "Disagree", ["X"], "new", { note: "in the style Agree with the AI" }],
      ["dyes", "Yes", ["Y"], "new", { note: "in the style Yes or no" }],
      ["dno", "No", ["N"], "new", { note: "in the style Yes or no" }],
      [
        "dcert",
        "How sure, from Certainly not to Certainly",
        ["1 … 5"],
        "new",
        { range: true, note: "in the style 5-point certainty" },
      ],
      [
        "dclass",
        "The class: Tumor, Stroma, Immune, Other",
        ["1 … 4"],
        "qp",
        { range: true, note: "in the style Pick the class blind" },
      ],
      ["dunsure", "Not sure", ["U"], "new", { note: "every style but 5-point certainty" }],
      [
        "drest",
        "Agree with the rest",
        ["⇧K"],
        "new",
        { note: "the open cells in the cells panel" },
      ],
      ["dnext", "Skip for now, next object", ["J"], "new"],
      ["dprev", "Previous object", ["⇧J"], "new"],
      [
        "dnear",
        "Nearest cell on the slide",
        ["Arrows"],
        "new",
        { direction: true, note: "in the cells panel" },
      ],
      ["dadd", "Add something the AI missed", [], "new"],
      ["dsubmit", "Submit the slide", ["↵"], "new", { note: "on the Slide done card" }],
    ],
  ],
  [
    "Tools",
    "all",
    [
      ["tselect", "Select", ["V"], "fig"],
      ["thand", "Hand", ["H"], "fig"],
      ["tsmart", "Smart select (AI)", ["S"], "new"],
      ["tauto", "Auto region (AI)", ["U"], "new"],
      ["tpoly", "Polygon", ["P"], "qp"],
      ["tfree", "Freehand", ["⇧P"], "fig"],
      ["trect", "Rectangle", ["R"], "qp"],
      ["tellipse", "Ellipse", ["O"], "fig"],
      ["tmarker", "Count marker", ["M"], "new"],
      ["truler", "Ruler", ["L"], "qp"],
      ["tarrow", "Arrow", ["⇧L"], "fig"],
      ["ttext", "Text", ["T"], "fig"],
      ["tcomment", "Comment", ["C"], "fig"],
      ["tbrush", "Brush", ["B"], "qp"],
    ],
  ],
  [
    "Panels and the slide",
    "all",
    [
      ["panel", "Show or hide the panel", ["I"], "new"],
      ["preset", "Display preset 1 to 4", ["⇧1 … ⇧4"], "new", { range: true }],
      ["overlays", "Show or hide overlays", ["A"], "qp"],
      ["fill", "Fill outlines", ["F"], "qp"],
      ["tumormap", "Tumor map", ["⇧H"], "new"],
      ["search", "Find any action", ["⌘K"], "fig"],
      ["sheet", "Shortcut sheet", ["?"], "fig"],
      ["settings", "Settings", ["⌘,"], "fig"],
      ["hideui", "Hide all UI", ["⌘\\"], "fig"],
      ["signout", "Sign out the case", ["⌘↵"], "new", { safe: true }],
      ["undo", "Undo", ["⌘Z"], "fig", { fixed: true }],
      ["esc", "Close or go back", ["Esc"], "fig", { fixed: true }],
    ],
  ],
];

export const keyGroups = keymap.map(([group, context]) => ({ group, context }));

export const keyActions: KeyAction[] = keymap.flatMap(([group, context, rows]) =>
  rows.map(([id, name, keys, source, extra]) => ({
    id,
    name,
    keys,
    source,
    group,
    context,
    ...extra,
  })),
);

const byId = new Map(keyActions.map((action) => [action.id, action]));

export function keyAction(id: string): KeyAction {
  const action = byId.get(id);
  if (action === undefined) throw new Error(`no shortcut ${id}`);
  return action;
}

export const reservedKeys: Record<string, string> = {
  "⌘W": "closes the browser tab",
  "⌘T": "opens a new tab",
  "⌘Q": "quits the browser",
  "⌘N": "opens a new window",
  "⌘R": "reloads the page",
  "⌘L": "jumps to the address bar",
  "⌘⇧T": "reopens a closed tab",
  "⌘P": "prints",
  "⌘H": "hides the window",
  "⌘M": "minimises the window",
  F5: "reloads the page",
  F11: "goes full screen",
};

export const directionSets: [string, string][] = [
  ["Arrows", "Arrow keys"],
  ["WASD", "W A S D"],
  ["IJKL", "I J K L"],
];

export const shortcutPresetNames = {
  default: "Viewer default",
  qupath: "QuPath-like",
  figma: "Figma-like",
} as const;
