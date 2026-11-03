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
  minimap: "useful" | "always" | "never";
  slide_strip: boolean;
  confidence_wording: "words" | "numbers" | "frequency" | "colour" | "hidden";
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
  default_privacy_mode: "de-identified" | "clinical";
  default_classes: "none" | "sentinel-node" | "pannuke";
  default_study_template: string;
  tumor_share_cutoff: number;
  tumor_share_result_sentinel_node: boolean;
  tumor_share_result_pannuke: boolean;
  home_layout: "role" | "review" | "research" | "both";
};

export type SettingKey = keyof SettingValues;

export type SettingEntry = {
  kind: "choice" | "switch" | "whole" | "id";
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
    "minimum": 20,
    "maximum": 140
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
    "default": "useful",
    "layers": [
      "personal"
    ],
    "options": [
      "useful",
      "always",
      "never"
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
      "frequency",
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
  },
  "default_privacy_mode": {
    "kind": "choice",
    "default": "de-identified",
    "layers": [
      "lab"
    ],
    "options": [
      "de-identified",
      "clinical"
    ]
  },
  "default_classes": {
    "kind": "choice",
    "default": "none",
    "layers": [
      "lab"
    ],
    "options": [
      "none",
      "sentinel-node",
      "pannuke"
    ]
  },
  "default_study_template": {
    "kind": "id",
    "default": "",
    "layers": [
      "lab"
    ]
  },
  "tumor_share_cutoff": {
    "kind": "whole",
    "default": 20,
    "layers": [
      "lab"
    ],
    "minimum": 1,
    "maximum": 99
  },
  "tumor_share_result_sentinel_node": {
    "kind": "switch",
    "default": false,
    "layers": [
      "lab"
    ]
  },
  "tumor_share_result_pannuke": {
    "kind": "switch",
    "default": true,
    "layers": [
      "lab"
    ]
  },
  "home_layout": {
    "kind": "choice",
    "default": "role",
    "layers": [
      "personal"
    ],
    "options": [
      "role",
      "review",
      "research",
      "both"
    ]
  }
};
