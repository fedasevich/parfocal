export type Layer = "lab" | "personal" | "device";

export type SettingValues = {
  theme: "system" | "light" | "dark";
  slide_brightness: number;
  density: "comfortable" | "compact";
  patient_names: "full" | "initials";
  length_unit: "auto" | "um";
  language: "en" | "cs";
  magnification_label: "objective" | "microns-per-pixel";
  tools: "rail" | "dock";
  side_panel_width: number;
  hide_side_panel: boolean;
  panel_while_moving: "pinned" | "auto";
  minimap: "useful" | "always" | "never";
  slide_strip: boolean;
  confidence_wording: "words" | "numbers" | "frequency" | "colour" | "hidden";
  outline_mode: "fade" | "mark-unsure" | "bands";
  tier_outline: "best" | "good" | "fast";
  inspector_track_record: boolean;
  inspector_calibration: boolean;
  decision_cutoff: number;
  wheel_mode: "zoom" | "pan";
  invert_zoom: boolean;
  camera_feel: "smooth" | "precise" | "instant";
  notify_ai_finished: boolean;
  notify_replies: boolean;
  initials_while_sharing: boolean;
  analytics_policy: "person" | "on" | "off";
  analytics_opt_out: boolean;
  lock_after_minutes: number;
  two_factor_required: boolean;
  patient_banner: boolean;
  default_privacy_mode: "de-identified" | "clinical";
  default_classes: "none" | "sentinel-node" | "pannuke";
  default_study_template: string;
  tumor_share_cutoff: number;
  tumor_share_result_sentinel_node: boolean;
  tumor_share_result_pannuke: boolean;
  unsure_zone_square_px: number;
  unsure_zone_min_nuclei: number;
  unsure_zone_min_unsure_percent: number;
  unsure_zone_min_unsure_cells: number;
  home_layout: "role" | "review" | "research" | "both";
  getting_started_hidden: boolean;
  presets: string[];
  default_preset: number;
  signature_block: boolean;
  double_click: "zoom" | "toggle";
  model_warnings: boolean;
  slide_submitted_notice: "email" | "bell" | "quiet";
  shortcut_preset: "default" | "qupath" | "figma";
  shortcut_custom: Record<string, string[]>;
  shortcut_single_letter: boolean;
  shortcut_by_position: boolean;
  shortcut_whole_slide_key: "both" | "hold" | "tap";
};

export type SettingKey = keyof SettingValues;

export type SettingEntry = {
  kind: "choice" | "switch" | "whole" | "id" | "names" | "keys";
  default: string | boolean | number | string[] | Record<string, string[]>;
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
    "default": "auto",
    "layers": [
      "personal"
    ],
    "options": [
      "auto",
      "um"
    ]
  },
  "language": {
    "kind": "choice",
    "default": "en",
    "layers": [
      "personal"
    ],
    "options": [
      "en",
      "cs"
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
    "default": 340,
    "layers": [
      "personal"
    ],
    "minimum": 240,
    "maximum": 560
  },
  "hide_side_panel": {
    "kind": "switch",
    "default": false,
    "layers": [
      "personal"
    ]
  },
  "panel_while_moving": {
    "kind": "choice",
    "default": "pinned",
    "layers": [
      "personal"
    ],
    "options": [
      "pinned",
      "auto"
    ]
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
    "default": "fade",
    "layers": [
      "personal"
    ],
    "options": [
      "fade",
      "mark-unsure",
      "bands"
    ]
  },
  "tier_outline": {
    "kind": "choice",
    "default": "best",
    "layers": [
      "personal"
    ],
    "options": [
      "best",
      "good",
      "fast"
    ]
  },
  "inspector_track_record": {
    "kind": "switch",
    "default": true,
    "layers": [
      "personal"
    ]
  },
  "inspector_calibration": {
    "kind": "switch",
    "default": true,
    "layers": [
      "personal"
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
  "analytics_policy": {
    "kind": "choice",
    "default": "person",
    "layers": [
      "lab"
    ],
    "options": [
      "person",
      "on",
      "off"
    ]
  },
  "analytics_opt_out": {
    "kind": "switch",
    "default": false,
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
  "two_factor_required": {
    "kind": "switch",
    "default": false,
    "layers": [
      "lab"
    ]
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
  "unsure_zone_square_px": {
    "kind": "whole",
    "default": 128,
    "layers": [
      "lab"
    ],
    "minimum": 16,
    "maximum": 1024
  },
  "unsure_zone_min_nuclei": {
    "kind": "whole",
    "default": 3,
    "layers": [
      "lab"
    ],
    "minimum": 1,
    "maximum": 100
  },
  "unsure_zone_min_unsure_percent": {
    "kind": "whole",
    "default": 30,
    "layers": [
      "lab"
    ],
    "minimum": 1,
    "maximum": 100
  },
  "unsure_zone_min_unsure_cells": {
    "kind": "whole",
    "default": 4,
    "layers": [
      "lab"
    ],
    "minimum": 1,
    "maximum": 1000
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
  },
  "getting_started_hidden": {
    "kind": "switch",
    "default": false,
    "layers": [
      "personal"
    ]
  },
  "presets": {
    "kind": "names",
    "default": [],
    "layers": [
      "personal"
    ],
    "maximum": 3
  },
  "default_preset": {
    "kind": "whole",
    "default": 0,
    "layers": [
      "personal"
    ],
    "minimum": 0,
    "maximum": 3
  },
  "signature_block": {
    "kind": "switch",
    "default": true,
    "layers": [
      "personal"
    ]
  },
  "double_click": {
    "kind": "choice",
    "default": "zoom",
    "layers": [
      "personal"
    ],
    "options": [
      "zoom",
      "toggle"
    ]
  },
  "model_warnings": {
    "kind": "switch",
    "default": true,
    "layers": [
      "personal"
    ]
  },
  "slide_submitted_notice": {
    "kind": "choice",
    "default": "bell",
    "layers": [
      "personal"
    ],
    "options": [
      "email",
      "bell",
      "quiet"
    ]
  },
  "shortcut_preset": {
    "kind": "choice",
    "default": "default",
    "layers": [
      "personal"
    ],
    "options": [
      "default",
      "qupath",
      "figma"
    ]
  },
  "shortcut_custom": {
    "kind": "keys",
    "default": {},
    "layers": [
      "personal"
    ]
  },
  "shortcut_single_letter": {
    "kind": "switch",
    "default": true,
    "layers": [
      "personal"
    ]
  },
  "shortcut_by_position": {
    "kind": "switch",
    "default": true,
    "layers": [
      "personal"
    ]
  },
  "shortcut_whole_slide_key": {
    "kind": "choice",
    "default": "both",
    "layers": [
      "personal"
    ],
    "options": [
      "both",
      "hold",
      "tap"
    ]
  }
};
