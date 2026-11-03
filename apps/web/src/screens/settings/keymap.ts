import type { ShortcutSource } from "@parfocal/ui/components/shortcut-editor";
import type { ActionDef, Scope } from "../../keys/actions.ts";

export type KeyContext = "all" | "review" | "compare";

export type KeyAction = {
  id: string;
  name: string;
  keys: string[];
  source: ShortcutSource;
  group: string;
  context: KeyContext;
  scope: Scope;
  presets?: NonNullable<ActionDef["presets"]>;
  holdMs?: number;
  inInputs?: boolean;
  range?: boolean;
  direction?: boolean;
  hold?: boolean;
  sustain?: boolean;
  sequence?: boolean;
  safe?: boolean;
  fixed?: boolean;
  note?: string;
};

type Row = [string, string, string[], ShortcutSource, Partial<KeyAction>?];

const keymap: [string, KeyContext, Scope, Row[]][] = [
  [
    "Move around",
    "all",
    "viewer",
    [
      ["zoomin", "Zoom in", ["+"], "clin"],
      ["zoomout", "Zoom out", ["-"], "clin"],
      ["fit", "Fit the slide", ["0"], "new"],
      ["mag", "Objective 1.25× to 40×", ["⌥1 … ⌥6"], "clin", { range: true }],
      ["pan", "Pan, faster with Shift", ["Arrows"], "clin", { direction: true, sustain: true }],
      ["peek", "Whole slide", ["Z"], "new", { hold: true }],
      ["viewback", "Back to the previous view", ["⌥←"], "new"],
      ["viewforward", "Forward to the next view", ["⌥→"], "new"],
      ["prevslide", "Previous slide", ["Q"], "clin"],
      [
        "nextslide",
        "Next slide",
        ["E"],
        "clin",
        { note: "full viewer only. Guided review opens the next slide after Submit" },
      ],
      ["area", "Go to AI area n", ["G then 1 … 9"], "new", { sequence: true }],
      ["brightup", "Slide brighter", ["⌥↑"], "new", { inInputs: true }],
      ["brightdown", "Slide dimmer", ["⌥↓"], "new", { inInputs: true }],
      ["brightreset", "Slide brightness back to 100%", ["⌥0"], "new"],
    ],
  ],
  [
    "Deciding",
    "review",
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
    "annotate",
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
    "Compare",
    "compare",
    "compare",
    [
      [
        "linkviews",
        "Link or unlink the panes",
        ["⇧L"],
        "new",
        { note: "in compare only. In Annotate the same key draws an arrow" },
      ],
    ],
  ],
  [
    "Panels and the slide",
    "all",
    "viewer",
    [
      ["panel", "Show or hide the panel", ["I"], "new"],
      ["preset", "Display preset 1 to 4", ["⇧1 … ⇧4"], "new", { range: true }],
      ["overlays", "Show or hide overlays", ["A"], "qp"],
      ["fill", "Fill outlines", ["F"], "qp"],
      ["tumormap", "Tumor map", ["⇧H"], "new"],
      ["search", "Find any action", ["⌘K"], "fig", { scope: "global", inInputs: true }],
      ["sheet", "Shortcut sheet", ["?"], "fig", { scope: "global" }],
      ["settings", "Settings", ["⌘,"], "fig", { scope: "global", inInputs: true }],
      ["hideui", "Hide all UI", ["⌘\\"], "fig", { inInputs: true }],
      [
        "signout",
        "Sign out the case",
        ["⌘↵"],
        "new",
        { safe: true, scope: "review", inInputs: true },
      ],
      ["undo", "Undo", ["⌘Z"], "fig", { fixed: true, scope: "global" }],
      ["esc", "Close or go back", ["Esc"], "fig", { fixed: true, scope: "global", inInputs: true }],
    ],
  ],
];

export const keyGroups = keymap.map(([group, context]) => ({ group, context }));

export const keyActions: KeyAction[] = keymap.flatMap(([group, context, scope, rows]) =>
  rows.map(([id, name, keys, source, extra]) => ({
    id,
    name,
    keys,
    source,
    group,
    context,
    scope,
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
