import type { DeveloperScene } from "../developer/developer-data.ts";
import type { SettingsScene } from "./sections.ts";

export const settingsPrototypeScenes: { scene: SettingsScene; label: string; note: string }[] = [
  { scene: "display", label: "Settings · Display", note: "Theme, slide brightness, density" },
  { scene: "review", label: "Settings · Review", note: "Preset keys and the signature block" },
  { scene: "layout", label: "Settings · Layout", note: "Tools, side panel, minimap" },
  { scene: "ai", label: "Settings · AI and confidence", note: "The default display preset" },
  { scene: "nav", label: "Settings · Navigation and devices", note: "Device, wheel, speed" },
  { scene: "notify", label: "Settings · Notifications", note: "Email, bell or quiet per event" },
  {
    scene: "privacy",
    label: "Settings · Privacy and session",
    note: "Lock set by the lab, other devices",
  },
  { scene: "account", label: "Settings · Account", note: "Facts only, no controls" },
  { scene: "search", label: "Settings · search for zoom", note: "Sections and rows filtered" },
  { scene: "keys", label: "Shortcuts", note: "Every key grouped by where it works" },
  { scene: "changed", label: "Shortcuts · your changes", note: "Three keys changed" },
  { scene: "recording", label: "Shortcuts · recording a key", note: "Ruler waits for a key" },
  {
    scene: "conflict",
    label: "Shortcuts · key already used",
    note: "Issue, M is the count marker",
  },
  { scene: "reserved", label: "Shortcuts · kept by the browser", note: "Issue, ⌘W is refused" },
  { scene: "safety", label: "Shortcuts · risky single key", note: "Issue, sign out needs ⌘ or ⌃" },
  { scene: "findkey", label: "Shortcuts · what does this key do", note: "L found on the ruler" },
];

export const developerPrototypeScenes: { scene: DeveloperScene; label: string; note: string }[] = [
  { scene: "renderer", label: "Developer · Renderer", note: "Viv on WebGL2 by default" },
  { scene: "tiles", label: "Developer · Tiles and source", note: "The 20 sample slides" },
  { scene: "annot", label: "Developer · Annotations", note: "Synthetic nuclei and detail" },
  { scene: "heatmap", label: "Developer · Heatmap", note: "Source, colormap, grid" },
  { scene: "models", label: "Developer · Models", note: "Segmentation and the MONAI server" },
  { scene: "typing", label: "Developer · Typing and confidence", note: "Typer and calibration" },
  { scene: "job", label: "Developer · Whole-slide job", note: "A job running, tumor first" },
  { scene: "bench", label: "Developer · Benchmark", note: "Pan sweep and the CSV" },
  { scene: "hud", label: "Developer · HUD", note: "Readouts per route" },
  { scene: "ref", label: "Developer · URL and debug handle", note: "Every URL switch" },
  { scene: "webgpu", label: "Developer · WebGPU picked", note: "WebGPU-only controls turn on" },
];
