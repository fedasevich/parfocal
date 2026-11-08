export const legendDevices = [
  "mouse",
  "trackpad",
  "spacemouse",
  "gamepad",
  "pen",
  "keyboard",
  "footswitch",
] as const;

export type LegendDevice = (typeof legendDevices)[number];

export const legendContexts = ["read", "review", "annotate"] as const;

export type LegendContext = (typeof legendContexts)[number];

export type LegendRow = readonly [action: string, control: string];

export const deviceNames: Record<LegendDevice, string> = {
  mouse: "Mouse",
  trackpad: "Trackpad",
  spacemouse: "SpaceMouse",
  gamepad: "Gamepad",
  pen: "Tablet and pen",
  keyboard: "Keyboard",
  footswitch: "Footswitch",
};

export const footswitchDefaultKey = "J";

export const legendRows: Record<LegendDevice, Record<LegendContext, readonly LegendRow[]>> = {
  mouse: {
    read: [
      ["Pan", "Drag, or middle-drag"],
      ["Zoom", "Wheel, to the cursor"],
      ["Preset", "Alt+1 to Alt+6"],
      ["Next area", "]"],
    ],
    review: [
      ["Next cell", "J"],
      ["Keep", "K"],
      ["Retype", "1 to 4"],
      ["Not a cell", "X"],
    ],
    annotate: [
      ["Select", "Drag on empty tissue"],
      ["Pan", "Space+drag, middle-drag"],
      ["Refine", "Shift+click, right-click"],
      ["Accept", "Enter"],
    ],
  },
  trackpad: {
    read: [
      ["Pan", "Two fingers"],
      ["Zoom", "Pinch"],
      ["Preset", "Alt+1 to Alt+6"],
      ["Whole slide", "Hold Z"],
    ],
    review: [
      ["Next cell", "J"],
      ["Keep", "K"],
      ["Retype", "1 to 4"],
      ["Pan", "Two fingers"],
    ],
    annotate: [
      ["Select", "Click and drag"],
      ["Pan", "Two fingers"],
      ["Add", "Shift+click"],
      ["Remove", "Two-finger click"],
    ],
  },
  spacemouse: {
    read: [
      ["Pan", "Tilt the cap"],
      ["Zoom", "Push or pull"],
      ["Preset", "Side buttons"],
      ["Whole slide", "Pull fully"],
    ],
    review: [
      ["Next cell", "Left button"],
      ["Keep", "Right button"],
      ["Retype", "1 to 4 on the keyboard"],
      ["Pan", "Tilt, speed follows tilt"],
    ],
    annotate: [
      ["Pan", "Tilt"],
      ["Zoom", "Push or pull"],
      ["Draw", "Mouse in the other hand"],
      ["Accept", "Enter"],
    ],
  },
  gamepad: {
    read: [
      ["Pan", "Left stick"],
      ["Zoom", "Triggers"],
      ["Preset", "Shoulder buttons"],
      ["Next area", "Start"],
    ],
    review: [
      ["Next cell", "B"],
      ["Keep", "A"],
      ["Retype", "D-pad"],
      ["Not a cell", "X"],
    ],
    annotate: [
      ["Pan", "Left stick"],
      ["Zoom", "Triggers"],
      ["Draw", "Use the mouse"],
      ["Accept", "A"],
    ],
  },
  pen: {
    read: [
      ["Pan", "One finger"],
      ["Zoom", "Pinch"],
      ["To 40x", "Double tap"],
      ["Whole slide", "Two-finger double tap"],
    ],
    review: [
      ["Next cell", "Swipe the sheet"],
      ["Keep", "Keep button"],
      ["Retype", "Type buttons"],
      ["Not a cell", "Button"],
    ],
    annotate: [
      ["Draw", "Pen"],
      ["Pan", "One finger"],
      ["Last tool", "Double tap the pen"],
      ["Erase", "Pen side button"],
    ],
  },
  keyboard: {
    read: [
      ["Pan", "Arrows, Shift for 3x"],
      ["Zoom", "+ and -"],
      ["Preset", "Alt+1 to Alt+6"],
      ["Area", "G then a number"],
    ],
    review: [
      ["Next cell", "J"],
      ["Keep", "K"],
      ["Retype", "1 to 4"],
      ["Back", "Shift+J"],
    ],
    annotate: [
      ["Tools", "V H S U P R O L T C B"],
      ["Accept", "Enter"],
      ["Discard", "Esc"],
      ["Undo", "⌘Z"],
    ],
  },
  footswitch: {
    read: [
      ["Next area", "]"],
      ["Previous area", "["],
      ["Pan", "Use the mouse"],
      ["Zoom", "Use the mouse"],
    ],
    review: [
      ["Next cell", footswitchDefaultKey],
      ["Keep", "K"],
      ["Back", "Shift+J"],
      ["Retype", "Use the keyboard"],
    ],
    annotate: [
      ["Accept", "Enter"],
      ["Discard", "Esc"],
      ["Draw", "Use the mouse"],
      ["Undo", "⌘Z"],
    ],
  },
};

export const legendDeviceOf = (value: unknown): LegendDevice =>
  legendDevices.find((device) => device === value) ?? "mouse";
