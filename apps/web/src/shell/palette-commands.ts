import type { IconName } from "@parfocal/ui/components/icon";
import { openFeedback } from "../feedback/feedback-state.ts";
import { developerNav } from "../screens/developer/developer-data.ts";
import { keyAction } from "../screens/settings/keymap.ts";
import {
  type RowKey,
  type SettingsSection,
  sectionRows,
  settingsSections,
} from "../screens/settings/sections.ts";
import { destinations } from "./destinations.ts";

export const paletteGroups = ["Actions", "Go to", "Settings", "Lab"] as const;

export type PaletteGroup = (typeof paletteGroups)[number];

export type PaletteEntry = {
  id: string;
  group: PaletteGroup;
  icon: IconName;
  label: string;
  keys?: string;
  keywords: string[];
  featured?: boolean;
  run: () => void;
};

export type PaletteContext = {
  projectId: string;
  onSlide: boolean;
  developerMode: boolean;
  go: (href: string) => void;
  measure: () => void;
  openNotifications: () => void;
  setDeveloperMode: (on: boolean) => void;
};

const keysOf = (...ids: string[]) =>
  ids
    .map((id) => keyAction(id).keys[0])
    .filter((keys): keys is string => keys !== undefined)
    .join(" ");

const rowKeys: Partial<Record<RowKey, string[]>> = {
  brightness: ["brightup", "brightdown", "brightreset"],
  hidePanel: ["panel"],
};

const rowKeywords: Partial<Record<RowKey, string[]>> = {
  lengths: ["units", "measurement display", "millimetres", "micrometres"],
  theme: ["dark", "light", "appearance"],
  wheel: ["scroll", "zoom"],
};

const rowIcons: Partial<Record<RowKey, IconName>> = {
  brightness: "sun",
  theme: "sun",
};

const featuredRows: RowKey[] = ["brightness", "wheel", "theme"];

function settingEntries(ctx: PaletteContext): PaletteEntry[] {
  const sectionOf = (section: SettingsSection) => settingsSections.find((s) => s.key === section);
  const rows = (Object.keys(sectionRows) as Exclude<SettingsSection, "shortcuts">[]).flatMap(
    (section) =>
      sectionRows[section].map((row): PaletteEntry => {
        const keys = rowKeys[row.key];
        const entry: PaletteEntry = {
          id: `setting-${row.key}`,
          group: "Settings",
          icon: rowIcons[row.key] ?? sectionOf(section)?.icon ?? "gear",
          label: row.label,
          keywords: [
            ...(rowKeywords[row.key] ?? []),
            sectionOf(section)?.title ?? section,
            row.help,
            "settings",
          ],
          run: () => ctx.go(destinations.settings(section)),
        };
        if (keys) entry.keys = keysOf(...keys);
        if (featuredRows.includes(row.key)) entry.featured = true;
        return entry;
      }),
  );
  const shortcuts: PaletteEntry = {
    id: "setting-shortcuts",
    group: "Settings",
    icon: "keyboard",
    label: "Keyboard shortcuts",
    keys: keysOf("sheet"),
    keywords: ["keys", "hotkeys", "bindings", "rebind", "settings"],
    featured: true,
    run: () => ctx.go(destinations.settings("shortcuts")),
  };
  const developer: PaletteEntry = {
    id: "setting-developer-mode",
    group: "Settings",
    icon: "gear",
    label: ctx.developerMode ? "Turn developer mode off" : "Turn developer mode on",
    keywords: ["developer", "lab", "benchmark", "hud", "debug"],
    run: () => ctx.setDeveloperMode(!ctx.developerMode),
  };
  return [...rows, shortcuts, developer];
}

function actionEntries(ctx: PaletteContext): PaletteEntry[] {
  const { projectId } = ctx;
  const entries: PaletteEntry[] = [];
  if (ctx.onSlide) {
    entries.push({
      id: "measure",
      group: "Actions",
      icon: "ruler",
      label: "Measure",
      keys: keysOf("truler"),
      keywords: ["ruler", "length", "distance", "tool"],
      run: ctx.measure,
    });
  }
  entries.push(
    {
      id: "upload",
      group: "Actions",
      icon: "upload",
      label: "Upload slides and results",
      keywords: ["import", "add slides"],
      run: () => ctx.go(destinations.upload(projectId)),
    },
    {
      id: "run-model",
      group: "Actions",
      icon: "smart",
      label: "Run a model",
      keywords: ["ai", "analyse", "analyze"],
      run: () => ctx.go(destinations.runModel(projectId)),
    },
    {
      id: "new-task",
      group: "Actions",
      icon: "users",
      label: "New review task",
      keywords: ["assign", "reviewers", "hand out"],
      run: () => ctx.go(destinations.newReviewTask(projectId)),
    },
    {
      id: "new-project",
      group: "Actions",
      icon: "folder",
      label: "New project",
      keywords: ["create"],
      run: () => ctx.go(destinations.newProject()),
    },
    {
      id: "my-work",
      group: "Actions",
      icon: "slides",
      label: "Open My work",
      keywords: ["worklist", "to review", "assigned"],
      run: () => ctx.go(destinations.myWork()),
    },
    {
      id: "home",
      group: "Actions",
      icon: "home",
      label: "Open Home",
      keywords: ["launchpad", "start"],
      run: () => ctx.go(destinations.home()),
    },
    {
      id: "notifications",
      group: "Actions",
      icon: "bell",
      label: "Notifications",
      keywords: ["bell", "inbox", "mentions"],
      run: ctx.openNotifications,
    },
    {
      id: "feedback",
      group: "Actions",
      icon: "comment",
      label: "Send feedback",
      keywords: ["bug", "report a problem", "screenshot", "support", "idea"],
      run: () => void openFeedback(),
    },
    {
      id: "open-settings",
      group: "Actions",
      icon: "gear",
      label: "Open Settings",
      keys: keysOf("settings"),
      keywords: ["preferences", "options"],
      run: () => ctx.go(destinations.settings("display")),
    },
  );
  return entries;
}

function labEntries(ctx: PaletteContext): PaletteEntry[] {
  if (!ctx.developerMode) return [];
  return developerNav.flatMap((group) =>
    group.items.map(
      (item): PaletteEntry => ({
        id: `lab-${item.value}`,
        group: "Lab",
        icon: "gear",
        label: item.label,
        keywords: ["developer", "lab", group.title],
        run: () => ctx.go(destinations.developer(item.value)),
      }),
    ),
  );
}

export function paletteEntries(ctx: PaletteContext): PaletteEntry[] {
  return [...actionEntries(ctx), ...settingEntries(ctx), ...labEntries(ctx)];
}
