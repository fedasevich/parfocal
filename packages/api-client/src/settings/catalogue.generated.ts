export type Layer = "lab" | "personal" | "device";

export type SettingValues = {
  theme: "system" | "light" | "dark";
  slide_brightness: number;
  density: "comfortable" | "compact";
  patient_names: "full" | "initials";
  length_unit: "um" | "mm";
  magnification_label: "objective" | "microns-per-pixel";
  tools: "rail" | "dock";
  side_panel_width: number;
  minimap: "corner" | "hidden";
  slide_strip: boolean;
  confidence_wording: "words" | "numbers" | "colour" | "hidden";
  outline_mode: "outline" | "fill" | "dots";
  decision_cutoff: number;
  wheel_mode: "zoom" | "pan";
  invert_zoom: boolean;
  camera_feel: "smooth" | "precise" | "instant";
  notify_ai_finished: boolean;
  notify_replies: boolean;
  initials_while_sharing: boolean;
  lock_after_minutes: number;
  patient_banner: boolean;
};

export type SettingKey = keyof SettingValues;

export type SettingEntry = {
  kind: "choice" | "switch" | "whole";
  default: string | boolean | number;
  layers: Layer[];
  options?: string[];
  minimum?: number;
  maximum?: number;
};

export const catalogue: Record<SettingKey, SettingEntry> = {
  "theme": {
    "kind": "choice",
    "default": "system",
    "layers": [
      "device"
    ],
    "options": [
      "system",
      "light",
      "dark"
    ]
  },
  "slide_brightness": {
    "kind": "whole",
    "default": 100,
    "layers": [
      "device"
    ],
    "minimum": 50,
    "maximum": 150
  },
  "density": {
    "kind": "choice",
    "default": "comfortable",
    "layers": [
      "personal"
    ],
    "options": [
      "comfortable",
      "compact"
    ]
  },
  "patient_names": {
    "kind": "choice",
    "default": "full",
    "layers": [
      "lab",
      "personal"
    ],
    "options": [
      "full",
      "initials"
    ]
  },
  "length_unit": {
    "kind": "choice",
    "default": "um",
    "layers": [
      "personal"
    ],
    "options": [
      "um",
      "mm"
    ]
  },
  "magnification_label": {
    "kind": "choice",
    "default": "objective",
    "layers": [
      "personal"
    ],
    "options": [
      "objective",
      "microns-per-pixel"
    ]
  },
  "tools": {
    "kind": "choice",
    "default": "rail",
    "layers": [
      "personal"
    ],
    "options": [
      "rail",
      "dock"
    ]
  },
  "side_panel_width": {
    "kind": "whole",
    "default": 320,
    "layers": [
      "personal"
    ],
    "minimum": 240,
    "maximum": 560
  },
  "minimap": {
    "kind": "choice",
    "default": "corner",
    "layers": [
      "personal"
    ],
    "options": [
      "corner",
      "hidden"
    ]
  },
  "slide_strip": {
    "kind": "switch",
    "default": false,
    "layers": [
      "personal"
    ]
  },
  "confidence_wording": {
    "kind": "choice",
    "default": "words",
    "layers": [
      "personal"
    ],
    "options": [
      "words",
      "numbers",
      "colour",
      "hidden"
    ]
  },
  "outline_mode": {
    "kind": "choice",
    "default": "outline",
    "layers": [
      "personal"
    ],
    "options": [
      "outline",
      "fill",
      "dots"
    ]
  },
  "decision_cutoff": {
    "kind": "whole",
    "default": 50,
    "layers": [
      "lab"
    ],
    "minimum": 0,
    "maximum": 100
  },
  "wheel_mode": {
    "kind": "choice",
    "default": "zoom",
    "layers": [
      "device"
    ],
    "options": [
      "zoom",
      "pan"
    ]
  },
  "invert_zoom": {
    "kind": "switch",
    "default": false,
    "layers": [
      "device"
    ]
  },
  "camera_feel": {
    "kind": "choice",
    "default": "smooth",
    "layers": [
      "device"
    ],
    "options": [
      "smooth",
      "precise",
      "instant"
    ]
  },
  "notify_ai_finished": {
    "kind": "switch",
    "default": true,
    "layers": [
      "personal"
    ]
  },
  "notify_replies": {
    "kind": "switch",
    "default": true,
    "layers": [
      "personal"
    ]
  },
  "initials_while_sharing": {
    "kind": "switch",
    "default": true,
    "layers": [
      "personal"
    ]
  },
  "lock_after_minutes": {
    "kind": "whole",
    "default": 15,
    "layers": [
      "lab"
    ],
    "minimum": 1,
    "maximum": 240
  },
  "patient_banner": {
    "kind": "switch",
    "default": true,
    "layers": [
      "lab"
    ]
  }
};
