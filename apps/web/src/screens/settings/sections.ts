import type { IconName } from "@parfocal/ui/components/icon";
import type { SettingScopeKind } from "@parfocal/ui/components/settings-dialog";
import type { SceneOf } from "../scenes.ts";
import { anyKeyMatches, type ShortcutScene } from "./shortcuts.ts";

export const settingsSectionKeys = [
  "display",
  "review",
  "layout",
  "ai",
  "navigation",
  "shortcuts",
  "notifications",
  "privacy",
  "account",
] as const;

export type SettingsSection = (typeof settingsSectionKeys)[number];

export type SettingsScene = SceneOf<"settings">;

export const settingsSections: { key: SettingsSection; title: string; icon: IconName }[] = [
  { key: "display", title: "Display", icon: "sun" },
  { key: "review", title: "Review", icon: "sliders" },
  { key: "layout", title: "Layout", icon: "panel" },
  { key: "ai", title: "AI and confidence", icon: "smart" },
  { key: "navigation", title: "Navigation and devices", icon: "mouse" },
  { key: "shortcuts", title: "Shortcuts", icon: "keyboard" },
  { key: "notifications", title: "Notifications", icon: "bell" },
  { key: "privacy", title: "Privacy and session", icon: "shield" },
  { key: "account", title: "Account", icon: "user" },
];

export type RowKey =
  | "theme"
  | "brightness"
  | "density"
  | "patientNames"
  | "lengths"
  | "magnificationLabel"
  | "language"
  | "presetKeys"
  | "presets"
  | "signature"
  | "homeLayout"
  | "tools"
  | "panelWidth"
  | "hidePanel"
  | "panelMoving"
  | "minimap"
  | "strip"
  | "defaultPreset"
  | "modelWarnings"
  | "trackRecord"
  | "calibration"
  | "decisionCutoff"
  | "tierOutline"
  | "outlineMode"
  | "confidenceWording"
  | "device"
  | "wheel"
  | "doubleClick"
  | "speed"
  | "deadZone"
  | "invertZoom"
  | "spaceMouseRotation"
  | "feel"
  | "coasting"
  | "animatedJumps"
  | "zoomAnchor"
  | "objectiveDetents"
  | "feelPreview"
  | "noticeTask"
  | "noticeMention"
  | "noticeReply"
  | "noticeStat"
  | "statSound"
  | "noticeSubmit"
  | "noticeRun"
  | "noticeDue"
  | "initials"
  | "analytics"
  | "lockAfter"
  | "patientBanner"
  | "otherDevices"
  | "name"
  | "email"
  | "role"
  | "workspace";

export type SettingRow = { key: RowKey; label: string; help: string; scope: SettingScopeKind };

const row = (key: RowKey, label: string, scope: SettingScopeKind, help = ""): SettingRow => ({
  key,
  label,
  help,
  scope,
});

export const sectionRows: Record<Exclude<SettingsSection, "shortcuts">, SettingRow[]> = {
  display: [
    row("theme", "Theme", "device", "The interface only. Slides keep their own colors."),
    row(
      "brightness",
      "Slide brightness",
      "device",
      "Changes the slide only, never the interface or the monitor. ⌥↑ and ⌥↓ do the same on the slide.",
    ),
    row("density", "Density", "personal", "Compact fits more rows on a laptop screen."),
    row(
      "patientNames",
      "Patient names",
      "personal",
      "Full name or initials in the clinical viewer. Your lab can set this for everyone.",
    ),
    row("lengths", "Lengths", "personal", "How sizes read on the slide and in reports."),
    row(
      "magnificationLabel",
      "Magnification label",
      "personal",
      "What the bar on the slide shows first. The objective is 20× or 40×, the other is the scale in µm per pixel.",
    ),
    row(
      "language",
      "Language",
      "personal",
      "Report wording follows the lab's language, not this setting.",
    ),
  ],
  review: [
    row("presetKeys", "Preset keys", "personal", "Switch presets while you review."),
    row(
      "presets",
      "Your presets",
      "personal",
      "Save, rename and reorder presets where you see the slide change.",
    ),
    row(
      "signature",
      "Signature block on reports",
      "personal",
      "Adds your name and role under the reports you sign.",
    ),
  ],
  layout: [
    row(
      "homeLayout",
      "Home",
      "personal",
      "What comes first on your home. From my role follows the role you chose at setup.",
    ),
    row(
      "tools",
      "Tools",
      "personal",
      "The bottom dock gives the slide its full height. The left rail matches QuPath and ImageScope.",
    ),
    row("panelWidth", "Side panel width", "personal", "Drag the panel edge for any other width."),
    row("hidePanel", "Hide the side panel", "personal", "I hides and shows it on the slide."),
    row(
      "panelMoving",
      "Panel while moving",
      "personal",
      "Hiding gives the slide more room while you pan.",
    ),
    row(
      "minimap",
      "Minimap",
      "personal",
      "When useful shows it once you zoom in until half of the tissue or less is on screen. Never still lets you hold Z for the whole slide.",
    ),
    row(
      "strip",
      "Pinned slide strip",
      "personal",
      "Off by default. The slide switcher in the top bar does the same job without taking width.",
    ),
  ],
  ai: [
    row(
      "outlineMode",
      "Outline display",
      "personal",
      "How the review viewer shows how sure the AI is about each outline.",
    ),
    row(
      "confidenceWording",
      "Confidence wording",
      "personal",
      "How the review card says how sure the AI is. A task that locks confidence keeps its own.",
    ),
    row(
      "defaultPreset",
      "Default display preset",
      "personal",
      "Guided review and the full viewer open with it. Settings a task locks stay as the task sets them.",
    ),
    row(
      "decisionCutoff",
      "Decision cutoff",
      "lab",
      "Set by your lab. Outlines scoring under it are faded in the viewer.",
    ),
    row(
      "tierOutline",
      "Outline model tier",
      "personal",
      "The tier the annotate tools start with when you ask for outlines. Your lab decides which model each tier uses.",
    ),
    row(
      "modelWarnings",
      "Model warnings",
      "personal",
      "Says when a model was trained on other tissue.",
    ),
    row(
      "trackRecord",
      "Track record block",
      "personal",
      "Shows how often your checks kept the model's calls, in the inspector.",
    ),
    row(
      "calibration",
      "Calibration details block",
      "personal",
      "Shows whether the model's confidence was calibrated and on how many sites, in the inspector.",
    ),
  ],
  navigation: [
    row("device", "Main input device", "device", "Shows that device's controls on the slide."),
    row(
      "wheel",
      "Mouse wheel",
      "device",
      "Zoom matches ImageScope, QuPath and Sectra. Trackpads always pan.",
    ),
    row("doubleClick", "Double-click", "personal", "What a double click on the slide does."),
    row("speed", "Pan and zoom speed", "device", "For the mouse, the trackpad and the arrow keys."),
    row("deadZone", "Dead zone", "device", "Ignores small movements of a stick or SpaceMouse cap."),
    row("invertZoom", "Invert zoom direction", "device", "Scrolling up zooms out instead of in."),
    row(
      "spaceMouseRotation",
      "SpaceMouse rotation",
      "device",
      "Off by default. Twisting the cap moved slides by accident in the 38-pathologist study.",
    ),
    row(
      "feel",
      "Camera feel",
      "device",
      "Smooth coasts and eases. Precise stops where you let go. Instant cuts straight to the view. Reduced motion in your system always uses Instant.",
    ),
    row("coasting", "Coasting", "device", "The slide keeps gliding after you let go of a drag."),
    row(
      "animatedJumps",
      "Animated jumps",
      "device",
      "Fit, go to and next area fly to the new view instead of cutting.",
    ),
    row(
      "zoomAnchor",
      "Zoom anchor",
      "device",
      "Where the wheel and the keys zoom toward. Cursor keeps the point under your pointer still.",
    ),
    row(
      "objectiveDetents",
      "Objective detents",
      "device",
      "Wheel zoom holds briefly at 5×, 10×, 20× and 40×. Off by default.",
    ),
    row(
      "feelPreview",
      "Try it",
      "device",
      "Scroll on the grid, drag it and jump to feel the setting.",
    ),
  ],
  notifications: [
    row("noticeTask", "A task is given to me", "personal", "A new review task or an adjudication."),
    row(
      "noticeMention",
      "Someone mentions me",
      "personal",
      "An @mention in a thread or a comment.",
    ),
    row("noticeReply", "Someone replies to me", "personal", "A reply in a thread you wrote in."),
    row(
      "noticeStat",
      "A STAT task is given to me",
      "device",
      "Urgent work that cannot wait for the next review round.",
    ),
    row(
      "statSound",
      "Sound for STAT tasks",
      "device",
      "Plays a short chime on this device when a STAT task arrives.",
    ),
    row(
      "noticeSubmit",
      "A reviewer submits a slide of my task",
      "personal",
      "For the researcher who set up the task.",
    ),
    row(
      "noticeRun",
      "A model run finishes",
      "personal",
      "AI finished: runs you started, and the ones that failed.",
    ),
    row("noticeDue", "A reminder before a due date", "personal", "Two days before, then each day."),
  ],
  privacy: [
    row(
      "initials",
      "Initials while sharing",
      "personal",
      "Shows initials while your screen is shared or a guest is viewing.",
    ),
    row(
      "analytics",
      "Share usage statistics",
      "personal",
      "Counts of what is used, never names, patient data or slide content. Off stops them at once, on every device you sign in on, unless your lab decides.",
    ),
    row("lockAfter", "Lock after", "lab", "Set by your lab. Unlocking returns to the same view."),
    row(
      "patientBanner",
      "Patient banner",
      "lab",
      "Set by your lab. Whether the clinical viewer shows the patient and in what form.",
    ),
    row("otherDevices", "Other devices", "personal", "Other devices that are signed in."),
  ],
  account: [
    row("name", "Name", "personal"),
    row("email", "Email", "personal"),
    row("role", "Role", "lab"),
    row("workspace", "Workspace", "lab"),
  ],
};

const hit = (query: string, ...texts: string[]) =>
  !query || texts.some((text) => text.toLowerCase().includes(query));

export function matchingRows(section: Exclude<SettingsSection, "shortcuts">, query: string) {
  const title = settingsSections.find((item) => item.key === section)?.title ?? "";
  const rows = sectionRows[section];
  return hit(query, title) ? rows : rows.filter((item) => hit(query, item.label, item.help));
}

export function matchCount(section: SettingsSection, query: string): number {
  if (section === "shortcuts") return anyKeyMatches(query) ? 1 : 0;
  return matchingRows(section, query).length;
}

export const normalQuery = (query: string | undefined) => (query ?? "").trim().toLowerCase();

export function visibleSections(query: string) {
  return settingsSections.filter((section) => matchCount(section.key, query) > 0);
}

export function shownSection(section: SettingsSection, query: string) {
  const visible = visibleSections(query);
  return visible.find((item) => item.key === section) ?? visible[0];
}

const sceneSections: Partial<Record<SettingsScene, SettingsSection>> = {
  display: "display",
  review: "review",
  layout: "layout",
  ai: "ai",
  nav: "navigation",
  notify: "notifications",
  privacy: "privacy",
  account: "account",
  search: "navigation",
};

export const sectionOfScene = (scene: SettingsScene): SettingsSection =>
  sceneSections[scene] ?? "shortcuts";

export const queryOfScene = (scene: SettingsScene | undefined) =>
  scene === "search" ? "zoom" : undefined;

export const shortcutSceneOf = (scene: SettingsScene | undefined): ShortcutScene =>
  scene !== undefined && sectionOfScene(scene) === "shortcuts" ? (scene as ShortcutScene) : "keys";
