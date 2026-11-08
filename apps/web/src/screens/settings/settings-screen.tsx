import {
  getGetMySettingLayersQueryKey,
  getGetMySettingsQueryKey,
  getListNotificationPreferencesQueryKey,
  getListSessionsQueryKey,
  type MySettings,
  type NotificationKind,
  type Preference,
  useEndOtherSessions,
  useGetMe,
  useGetMySettingLayers,
  useGetMySettings,
  useGetSessionPolicy,
  useListNotificationPreferences,
  useListSessions,
  useSetMySettingLayers,
  useSetMyShortcuts,
  useSetNotificationPreferences,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { PersonAvatar } from "@parfocal/ui/components/person";
import { SegmentedControl, type SegmentOption } from "@parfocal/ui/components/segmented-control";
import {
  SettingsDialog,
  SettingsEmpty,
  SettingsFact,
  SettingsNav,
  SettingsNavItem,
  SettingsRow,
  SettingsRows,
  SettingsScopeLegend,
} from "@parfocal/ui/components/settings-dialog";
import { Slider } from "@parfocal/ui/components/slider";
import { Switch } from "@parfocal/ui/components/switch";
import { Toast } from "@parfocal/ui/components/undo-toast";
import type { WordingSetting } from "@parfocal/ui/lib/confidence-words";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { now } from "../../clock.ts";
import { setLengthUnits } from "../../measure/length-units.ts";
import { applyDensity } from "../../shell/density.ts";
import { writeDeviceSetting } from "../../shell/device-settings.ts";
import { personOf } from "../../shell/global-shell.tsx";
import { readStatNotice, writeStatChannel, writeStatSound } from "../../shell/notification-gate.ts";
import { usePinnedStrip } from "../../shell/pinned-strip.ts";
import { chooseTheme, readTheme, type ThemeChoice } from "../../shell/theme.ts";
import {
  type OutlineModeChoice,
  outlineModeChoices,
  outlineModeLabels,
  useOutlineMode,
} from "../../viewer/outline-mode.ts";
import { andJoin } from "../format.ts";
import { type HomeLayoutChoice, homeLayoutOptions } from "../home/home-layout.ts";
import { okData } from "../placeholder.tsx";
import { lockAfterText, patientBannerText } from "./privacy.ts";
import {
  matchCount,
  matchingRows,
  normalQuery,
  type RowKey,
  type SettingRow,
  type SettingsScene,
  type SettingsSection,
  shortcutSceneOf,
  shownSection,
  visibleSections,
} from "./sections.ts";
import {
  cancelRecording,
  freshShortcuts,
  type Outcome,
  type ShortcutState,
  sceneShortcuts,
  shortcutSettingsOf,
} from "./shortcuts.ts";
import { isListening, ShortcutsSection, useKeyCapture } from "./shortcuts-section.tsx";
import { wordingNow, wordingPairs } from "./wording-row.ts";

type Personal = MySettings["personal"];

type Device = {
  brightness: number;
  device: string;
  wheel: string;
  speed: number;
  invertZoom: boolean;
  spaceMouseRotation: boolean;
};

const deviceDefaults: Device = {
  brightness: 100,
  device: "mouse",
  wheel: "zoom",
  speed: 60,
  invertZoom: false,
  spaceMouseRotation: false,
};

type Channel = "email" | "bell" | "quiet";

const channelOf = (preference: Preference | undefined): Channel =>
  preference === undefined || !preference.in_app ? "quiet" : preference.email ? "email" : "bell";

const noticeKinds: Partial<Record<RowKey, string>> = {
  noticeTask: "task-assigned",
  noticeMention: "mention",
  noticeReply: "reply",
  noticeRun: "model-run-finished",
  noticeDue: "task-due-soon",
};

const options = (pairs: [string, string][]): SegmentOption[] =>
  pairs.map(([value, label]) => ({ value, label }));

function Segments({
  label,
  value,
  pairs,
  onChange,
}: {
  label: string;
  value: string;
  pairs: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <SegmentedControl
      fill
      aria-label={label}
      value={value}
      onValueChange={(next) => onChange(String(next))}
      options={options(pairs)}
    />
  );
}

function Stepper({
  label,
  value,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const step = (delta: number) => onChange(Math.max(20, Math.min(140, value + delta)));
  return (
    <div className="flex items-center gap-2.5">
      <Button size="icon-sm" aria-label={`Lower ${label}`} onClick={() => step(-10)}>
        <Icon name="minus" size="xs" />
      </Button>
      <Slider
        className="data-[orientation=horizontal]:w-[180px]"
        min={20}
        max={140}
        step={10}
        value={[value]}
        getAriaLabel={() => label}
        onValueChange={(next: number | readonly number[]) =>
          onChange(typeof next === "number" ? next : (next[0] ?? value))
        }
      />
      <Button size="icon-sm" aria-label={`Raise ${label}`} onClick={() => step(10)}>
        <Icon name="plus" size="xs" />
      </Button>
      <span className="min-w-10 font-mono text-body-sm text-fg">
        {value}
        {unit}
      </span>
    </div>
  );
}

const toggle = (label: string, checked: boolean, onChange: (value: boolean) => void) => (
  <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
);

const clockTime = (at: Date) =>
  `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;

const withArticle = (device: string) => `${/^[aeiouAEIOU]/.test(device) ? "an" : "a"} ${device}`;

type SettingsScreenProps = {
  section: SettingsSection;
  scene: SettingsScene | undefined;
  query: string;
  onQuery: (query: string) => void;
  onSection: (section: SettingsSection) => void;
  onEditPresets: (() => void) | undefined;
  onClose: () => void;
};

export function SettingsScreen(props: SettingsScreenProps) {
  const settings = useGetMySettings().data?.data;
  if (settings === undefined) return null;
  return <LoadedSettings {...props} settings={settings} />;
}

function LoadedSettings({
  section,
  scene,
  query: typed,
  onQuery,
  onSection,
  onEditPresets,
  onClose,
  settings,
}: SettingsScreenProps & { settings: MySettings }) {
  const me = okData(useGetMe().data);
  const sessions = okData(useListSessions().data) ?? [];
  const policy = okData(useGetSessionPolicy().data);
  const preferences = okData(useListNotificationPreferences().data) ?? [];
  const queryClient = useQueryClient();
  const endOthers = useEndOtherSessions();
  const layers = okData(useGetMySettingLayers().data);
  const saveLayers = useSetMySettingLayers({
    mutation: {
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() }),
    },
  });
  const [homeLayout, setHomeLayout] = useState<HomeLayoutChoice | null>(null);
  const [personal, setPersonal] = useState<Personal>(settings.personal);
  const [device, setDevice] = useState<Device>(deviceDefaults);
  const [pinnedStrip, setPinnedStrip] = usePinnedStrip();
  const [outlineMode, setOutlineMode] = useOutlineMode();
  const [wordingPicked, setWordingPicked] = useState<WordingSetting | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>(() => readTheme());
  const [stat, setStat] = useState(readStatNotice);
  const savePreferences = useSetNotificationPreferences({
    mutation: {
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: getListNotificationPreferencesQueryKey() }),
    },
  });
  const [channels, setChannels] = useState<Partial<Record<RowKey, Channel>>>({});
  const [signedOutAt, setSignedOutAt] = useState<{ count: number; at: Date } | null>(null);
  const { mutate: saveShortcuts } = useSetMyShortcuts({
    mutation: {
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: getGetMySettingsQueryKey() }),
    },
  });
  const base = freshShortcuts({
    preset: settings.shortcuts.preset,
    custom: settings.shortcuts.custom,
    singleLetter: settings.shortcuts.single_letter,
    byPosition: settings.shortcuts.by_position,
    wholeSlide: settings.shortcuts.whole_slide_key,
  });
  const [shortcuts, setShortcuts] = useState<ShortcutState>(() =>
    sceneShortcuts(shortcutSceneOf(scene), base),
  );
  const [message, setMessage] = useState<{ id: number; text: string } | null>(null);
  const [lastScene, setLastScene] = useState(scene);
  if (scene !== lastScene) {
    setLastScene(scene);
    if (scene !== undefined) setShortcuts(sceneShortcuts(shortcutSceneOf(scene), base));
  }

  const notify = useCallback((text: string) => setMessage({ id: Date.now(), text }), []);
  const apply = useCallback(
    (outcome: Outcome) => {
      const saved = shortcutSettingsOf(outcome.state);
      if (JSON.stringify(saved) !== JSON.stringify(shortcutSettingsOf(shortcuts)))
        saveShortcuts({ data: saved });
      setShortcuts(outcome.state);
      if (outcome.message) notify(outcome.message);
    },
    [notify, shortcuts, saveShortcuts],
  );
  useKeyCapture(shortcuts, apply);
  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const query = normalQuery(typed);
  const shown = shownSection(section, query);
  const visible = visibleSections(query);
  const presetNames = ["task", ...personal.presets.slice(0, 3)];
  const presetName = (name: string) => (name === "task" ? "Task default" : name);
  const others = sessions.filter((session) => !session.current);
  const setP = <Key extends keyof Personal>(key: Key, value: Personal[Key]) =>
    setPersonal((previous) => ({ ...previous, [key]: value }));
  const setD = <Key extends keyof Device>(key: Key, value: Device[Key]) =>
    setDevice((previous) => ({ ...previous, [key]: value }));
  const channel = (key: RowKey): Channel =>
    channels[key] ??
    (key === "noticeSubmit"
      ? personal.slide_submitted_notice
      : key === "noticeStat"
        ? stat.channel
        : channelOf(preferences.find((item) => item.kind === noticeKinds[key])));
  const chooseChannel = (key: RowKey, choice: Channel) => {
    setChannels((previous) => ({ ...previous, [key]: choice }));
    if (key === "noticeStat") {
      writeStatChannel(choice);
      setStat((previous) => ({ ...previous, channel: choice }));
      return;
    }
    const kind = noticeKinds[key];
    if (kind === undefined) return;
    savePreferences.mutate({
      data: {
        preferences: [
          {
            kind: kind as NotificationKind,
            in_app: choice !== "quiet",
            email: choice === "email",
            realtime: false,
          },
        ],
      },
    });
  };
  const workspace = me?.workspaces.find((item) => item.tenant_id === me.active_tenant_id);

  const controls: Record<RowKey, () => ReactNode> = {
    homeLayout: () => (
      <Segments
        label="Home"
        value={
          homeLayout ?? (layers?.personal.home_layout as HomeLayoutChoice | undefined) ?? "role"
        }
        pairs={homeLayoutOptions.map((option) => [option.value, option.label])}
        onChange={(value) => {
          const choice = value as HomeLayoutChoice;
          setHomeLayout(choice);
          saveLayers.mutate({
            data: { values: { home_layout: choice === "role" ? null : choice } },
          });
        }}
      />
    ),
    theme: () => (
      <Segments
        label="Theme"
        value={theme}
        pairs={[
          ["dark", "Dark"],
          ["light", "Light"],
          ["system", "System"],
        ]}
        onChange={(value) => {
          setTheme(value as ThemeChoice);
          chooseTheme(value as ThemeChoice);
        }}
      />
    ),
    brightness: () => (
      <Stepper
        label="Slide brightness"
        value={device.brightness}
        unit="%"
        onChange={(value) => setD("brightness", value)}
      />
    ),
    density: () => (
      <Segments
        label="Density"
        value={personal.density}
        pairs={[
          ["comfortable", "Comfortable"],
          ["compact", "Compact"],
        ]}
        onChange={(value) => {
          setP("density", value as Personal["density"]);
          applyDensity(value as Personal["density"]);
        }}
      />
    ),
    lengths: () => (
      <Segments
        label="Lengths"
        value={personal.lengths}
        pairs={[
          ["auto", "µm and mm"],
          ["um", "Always µm"],
        ]}
        onChange={(value) => {
          setP("lengths", value as Personal["lengths"]);
          setLengthUnits(value === "um" ? "um" : "auto");
        }}
      />
    ),
    language: () => (
      <Segments
        label="Language"
        value={personal.language}
        pairs={[
          ["en", "English"],
          ["cs", "Čeština"],
        ]}
        onChange={(value) => setP("language", value as Personal["language"])}
      />
    ),
    presetKeys: () =>
      presetNames.map((name, index) => (
        <span key={name} className="inline-flex items-center gap-1.5 text-body-sm">
          <Keycap action={`preset:${index + 1}`} keys={`⇧${index + 1}`} />
          {presetName(name)}
        </span>
      )),
    presets: () => (
      <Button
        onClick={onEditPresets}
        disabled={onEditPresets === undefined}
        title={onEditPresets === undefined ? "Open a review task first" : undefined}
      >
        <Icon name="sliders" />
        Edit in the Display panel
      </Button>
    ),
    signature: () =>
      toggle("Signature block", personal.signature_block, (value) =>
        setP("signature_block", value),
      ),
    tools: () => (
      <Segments
        label="Tools"
        value={personal.tools}
        pairs={[
          ["left", "Left rail"],
          ["bottom", "Bottom dock"],
        ]}
        onChange={(value) => setP("tools", value as Personal["tools"])}
      />
    ),
    panelWidth: () => (
      <Segments
        label="Side panel width"
        value={String(personal.side_panel_width)}
        pairs={[
          ["300", "Narrow"],
          ["340", "Default"],
          ["420", "Wide"],
        ]}
        onChange={(value) => {
          setP("side_panel_width", Number(value) as Personal["side_panel_width"]);
          setP("hide_side_panel", false);
        }}
      />
    ),
    hidePanel: () =>
      toggle("Hide the panel", personal.hide_side_panel, (value) => setP("hide_side_panel", value)),
    panelMoving: () => (
      <Segments
        label="Panel while moving"
        value={personal.panel_while_moving}
        pairs={[
          ["pinned", "Stays put"],
          ["auto", "Hides while panning"],
        ]}
        onChange={(value) => setP("panel_while_moving", value as Personal["panel_while_moving"])}
      />
    ),
    minimap: () => (
      <Segments
        label="Minimap"
        value={personal.minimap}
        pairs={[
          ["useful", "When useful"],
          ["always", "Always"],
          ["never", "Never"],
        ]}
        onChange={(value) => setP("minimap", value as Personal["minimap"])}
      />
    ),
    strip: () => toggle("Pinned slide strip", pinnedStrip, setPinnedStrip),
    defaultPreset: () => (
      <Segments
        label="Default preset"
        value={presetNames.includes(personal.default_preset) ? personal.default_preset : "task"}
        pairs={presetNames.map((name) => [name, presetName(name)])}
        onChange={(value) => {
          setP("default_preset", value);
          notify(
            `${presetName(value)} is your default preset. Settings a task locks still follow the task.`,
          );
        }}
      />
    ),
    outlineMode: () => (
      <Segments
        label="Outline display"
        value={outlineMode}
        pairs={outlineModeChoices.map((choice) => [choice, outlineModeLabels[choice]])}
        onChange={(value) => setOutlineMode(value as OutlineModeChoice)}
      />
    ),
    confidenceWording: () => (
      <Segments
        label="Confidence wording"
        value={
          wordingPicked ??
          wordingNow({
            lab: layers?.lab ?? { values: {}, locked: [] },
            personal: layers?.personal ?? {},
            device: {},
          })
        }
        pairs={wordingPairs}
        onChange={(value) => {
          const choice = value as WordingSetting;
          setWordingPicked(choice);
          saveLayers.mutate({ data: { values: { confidence_wording: choice } } });
        }}
      />
    ),
    modelWarnings: () =>
      toggle("Model warnings", personal.model_warnings, (value) => setP("model_warnings", value)),
    device: () => (
      <Segments
        label="Main input device"
        value={device.device}
        pairs={[
          ["mouse", "Mouse"],
          ["trackpad", "Trackpad"],
          ["spacemouse", "SpaceMouse"],
          ["gamepad", "Gamepad"],
          ["pen", "Pen"],
        ]}
        onChange={(value) => {
          writeDeviceSetting("device", value);
          setD("device", value);
        }}
      />
    ),
    wheel: () => (
      <Segments
        label="Mouse wheel"
        value={device.wheel}
        pairs={[
          ["zoom", "Zoom"],
          ["pan", "Pan"],
          ["detect", "Detect device"],
        ]}
        onChange={(value) => setD("wheel", value)}
      />
    ),
    doubleClick: () => (
      <Segments
        label="Double-click"
        value={personal.double_click}
        pairs={[
          ["zoom", "Zoom in 2×"],
          ["toggle", "Last two magnifications"],
        ]}
        onChange={(value) => setP("double_click", value as Personal["double_click"])}
      />
    ),
    speed: () => (
      <Stepper
        label="Pan and zoom speed"
        value={device.speed}
        unit=""
        onChange={(value) => setD("speed", value)}
      />
    ),
    invertZoom: () =>
      toggle("Invert zoom direction", device.invertZoom, (value) => setD("invertZoom", value)),
    spaceMouseRotation: () =>
      toggle("SpaceMouse rotation", device.spaceMouseRotation, (value) =>
        setD("spaceMouseRotation", value),
      ),
    noticeTask: () => notice("noticeTask", "A task is given to me"),
    noticeMention: () => notice("noticeMention", "Someone mentions me"),
    noticeReply: () => notice("noticeReply", "Someone replies to me"),
    noticeStat: () => notice("noticeStat", "A STAT task is given to me"),
    statSound: () =>
      toggle("Sound for STAT tasks", stat.sound, (value) => {
        writeStatSound(value);
        setStat((previous) => ({ ...previous, sound: value }));
      }),
    noticeSubmit: () => notice("noticeSubmit", "A reviewer submits a slide of my task"),
    noticeRun: () => notice("noticeRun", "A model run finishes"),
    noticeDue: () => notice("noticeDue", "A reminder before a due date"),
    initials: () =>
      toggle("Initials while sharing", personal.initials_while_sharing, (value) =>
        setP("initials_while_sharing", value),
      ),
    lockAfter: () => lockAfterText(policy?.idle_lock_minutes),
    patientBanner: () => patientBannerText(layers?.lab),
    otherDevices: () =>
      others.length === 0 ? (
        <span className="text-body text-fg">Only this device</span>
      ) : (
        <Button
          disabled={endOthers.isPending}
          onClick={() =>
            endOthers.mutate(undefined, {
              onSuccess: (response) => {
                const count = response.status === 200 ? response.data.ended : others.length;
                setSignedOutAt({ count, at: now() });
                notify(`Signed out of the ${count} other devices`);
                void queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
              },
            })
          }
        >
          Sign out on other devices
        </Button>
      ),
    name: () => (
      <span className="inline-flex items-center gap-2">
        <PersonAvatar person={personOf(me)} size={20} />
        {me?.display_name}
      </span>
    ),
    email: () => <span className="font-mono">{me?.email}</span>,
    role: () => me?.title ?? "",
    workspace: () => workspace?.name ?? "",
  };

  function notice(key: RowKey, label: string) {
    return (
      <Segments
        label={label}
        value={channel(key)}
        pairs={[
          ["email", "Email"],
          ["bell", "Bell"],
          ["quiet", "Quiet"],
        ]}
        onChange={(value) => chooseChannel(key, value as Channel)}
      />
    );
  }

  const help = (item: SettingRow): string => {
    if (item.key !== "otherDevices") return item.help;
    if (signedOutAt && others.length === 0) {
      return `Signed out of ${signedOutAt.count} other devices at ${clockTime(signedOutAt.at)}. They ask for a sign-in next time.`;
    }
    if (others.length === 0) return "No other device is signed in.";
    return `${others.length === 2 ? "Two" : others.length} other devices are signed in: ${andJoin(
      others.map((session) => withArticle(session.user_agent ?? "unknown device")),
    )}.`;
  };

  const facts: RowKey[] = ["presetKeys", "lockAfter", "patientBanner"];
  const factIcons = { name: "user", email: "mail", role: "flag", workspace: "folder" } as const;

  const body = (() => {
    if (shown === undefined) {
      return <SettingsEmpty query={typed.trim()} onClear={() => onQuery("")} />;
    }
    if (shown.key === "shortcuts") {
      return <ShortcutsSection state={shortcuts} query={query} apply={apply} notify={notify} />;
    }
    const rows = matchingRows(shown.key, query);
    if (shown.key === "account") {
      return (
        <div className="pt-1.5">
          {rows.map((item) => (
            <SettingsFact
              key={item.key}
              icon={factIcons[item.key as keyof typeof factIcons]}
              label={item.label}
            >
              {controls[item.key]()}
            </SettingsFact>
          ))}
        </div>
      );
    }
    return (
      <SettingsRows>
        {rows.map((item) => (
          <SettingsRow
            key={item.key}
            label={item.label}
            help={help(item)}
            scope={item.scope}
            fact={facts.includes(item.key)}
          >
            {controls[item.key]()}
          </SettingsRow>
        ))}
      </SettingsRows>
    );
  })();

  return (
    <SettingsDialog
      title={shown?.title ?? "Settings"}
      hint={query && shown ? `Matching "${typed.trim()}"` : undefined}
      onOpenChange={(open) => {
        if (open) return;
        if (shortcuts.recording !== null || shortcuts.finding) {
          if (!isListening(shortcuts)) setShortcuts(cancelRecording(shortcuts));
          return;
        }
        onClose();
      }}
      nav={
        <SettingsNav
          query={typed}
          onQueryChange={onQuery}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !query) return;
            event.preventDefault();
            event.stopPropagation();
            onQuery("");
          }}
          empty={visible.length === 0 ? "No section matches" : undefined}
        >
          {visible.map((item) => (
            <SettingsNavItem
              key={item.key}
              icon={item.icon}
              label={item.title}
              current={item.key === shown?.key}
              count={query && item.key !== "shortcuts" ? matchCount(item.key, query) : undefined}
              onClick={() => (item.key === shown?.key ? undefined : onSection(item.key))}
            />
          ))}
          <SettingsScopeLegend />
        </SettingsNav>
      }
    >
      {body}
      {message ? (
        <Toast key={message.id} className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2">
          {message.text}
        </Toast>
      ) : null}
    </SettingsDialog>
  );
}
