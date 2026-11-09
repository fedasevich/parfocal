import {
  getGetMeQueryKey,
  getGetMySettingLayersQueryKey,
  getListNotificationPreferencesQueryKey,
  getListSessionsQueryKey,
  type MySettingLayers,
  type NotificationKind,
  type Preference,
  resolveSettings,
  type SettingValues,
  useEndOtherSessions,
  useGetMe,
  useGetMySettingLayers,
  useGetSessionPolicy,
  useListNotificationPreferences,
  useListSessions,
  useSetMySettingLayers,
  useSetNotificationPreferences,
  useUpdateMe,
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
import {
  type Calibration,
  calibrationDefaults,
  readCalibration,
  writeCalibration,
} from "../../devices/calibration.ts";
import { settingValuesOfShortcuts, shortcutsOfSettings } from "../../keys/shortcut-settings.ts";
import { setLengthUnits } from "../../measure/length-units.ts";
import { applyDensity } from "../../shell/density.ts";
import { readDeviceSettings, writeDeviceSetting } from "../../shell/device-settings.ts";
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
import { wordingExample } from "./wording-example.ts";
import { wordingNow, wordingPairs } from "./wording-row.ts";

type Device = {
  brightness: number;
  device: string;
  wheel: string;
  speed: number;
  deadZone: number;
  invertZoom: boolean;
  spaceMouseRotation: boolean;
};

const deviceDefaults: Device = {
  brightness: 100,
  device: "mouse",
  wheel: "zoom",
  speed: calibrationDefaults.speed,
  deadZone: calibrationDefaults.deadZone,
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
  const layers = okData(useGetMySettingLayers().data);
  if (layers === undefined) return null;
  return <LoadedSettings {...props} layers={layers} />;
}

function LoadedSettings({
  section,
  scene,
  query: typed,
  onQuery,
  onSection,
  onEditPresets,
  onClose,
  layers,
}: SettingsScreenProps & { layers: MySettingLayers }) {
  const me = okData(useGetMe().data);
  const sessions = okData(useListSessions().data) ?? [];
  const policy = okData(useGetSessionPolicy().data);
  const preferences = okData(useListNotificationPreferences().data) ?? [];
  const queryClient = useQueryClient();
  const endOthers = useEndOtherSessions();
  const saveLayers = useSetMySettingLayers({
    mutation: {
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() }),
    },
  });
  const { mutate: saveShortcutValues } = saveLayers;
  const [picked, setPicked] = useState<Partial<SettingValues>>({});
  const values: SettingValues = {
    ...resolveSettings({ ...layers, device: readDeviceSettings() }),
    ...picked,
  };
  const save = (change: Partial<SettingValues>) => {
    setPicked((previous) => ({ ...previous, ...change }));
    saveLayers.mutate({ data: { values: change } });
  };
  const [device, setDevice] = useState<Device>(() => {
    const chosen = readDeviceSettings().device;
    const main = typeof chosen === "string" ? chosen : deviceDefaults.device;
    return { ...deviceDefaults, device: main, ...readCalibration(main) };
  });
  const [pinnedStrip, setPinnedStrip] = usePinnedStrip();
  const [, setOutlineMode] = useOutlineMode();
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
  const savedShortcuts = shortcutsOfSettings(values);
  const base = freshShortcuts({
    preset: savedShortcuts.preset,
    custom: savedShortcuts.custom,
    singleLetter: savedShortcuts.single_letter,
    byPosition: savedShortcuts.by_position,
    wholeSlide: savedShortcuts.whole_slide_key,
  });
  const [shortcuts, setShortcuts] = useState<ShortcutState>(() =>
    sceneShortcuts(shortcutSceneOf(scene), base),
  );
  const [message, setMessage] = useState<{ id: number; text: string } | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const updateMe = useUpdateMe();
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [lastScene, setLastScene] = useState(scene);
  if (scene !== lastScene) {
    setLastScene(scene);
    if (scene !== undefined) setShortcuts(sceneShortcuts(shortcutSceneOf(scene), base));
  }

  const notify = useCallback((text: string) => setMessage({ id: Date.now(), text }), []);
  const apply = useCallback(
    (outcome: Outcome) => {
      const saved = shortcutSettingsOf(outcome.state);
      if (JSON.stringify(saved) !== JSON.stringify(shortcutSettingsOf(shortcuts))) {
        const change = settingValuesOfShortcuts(saved);
        setPicked((previous) => ({ ...previous, ...change }));
        saveShortcutValues({ data: { values: change } });
      }
      setShortcuts(outcome.state);
      if (outcome.message) notify(outcome.message);
    },
    [notify, shortcuts, saveShortcutValues],
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
  const presetNames = ["task", ...values.presets.slice(0, 3)];
  const presetName = (name: string) => (name === "task" ? "Task default" : name);
  const others = sessions.filter((session) => !session.current);
  const setD = <Key extends keyof Device>(key: Key, value: Device[Key]) =>
    setDevice((previous) => ({ ...previous, [key]: value }));
  const changeCalibration = (change: Partial<Calibration>) =>
    setDevice((previous) => ({ ...previous, ...writeCalibration(previous.device, change) }));
  const channel = (key: RowKey): Channel =>
    channels[key] ??
    (key === "noticeSubmit"
      ? values.slide_submitted_notice
      : key === "noticeStat"
        ? stat.channel
        : channelOf(preferences.find((item) => item.kind === noticeKinds[key])));
  const chooseChannel = (key: RowKey, choice: Channel) => {
    setChannels((previous) => ({ ...previous, [key]: choice }));
    if (key === "noticeSubmit") {
      save({ slide_submitted_notice: choice });
      return;
    }
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
        value={values.home_layout}
        pairs={homeLayoutOptions.map((option) => [option.value, option.label])}
        onChange={(value) => {
          const choice = value as HomeLayoutChoice;
          setPicked((previous) => ({ ...previous, home_layout: choice }));
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
        value={values.density}
        pairs={[
          ["comfortable", "Comfortable"],
          ["compact", "Compact"],
        ]}
        onChange={(value) => {
          const density = value as SettingValues["density"];
          save({ density });
          applyDensity(density);
        }}
      />
    ),
    lengths: () => (
      <Segments
        label="Lengths"
        value={values.length_unit}
        pairs={[
          ["auto", "µm and mm"],
          ["um", "Always µm"],
        ]}
        onChange={(value) => {
          const lengths = value === "um" ? "um" : "auto";
          save({ length_unit: lengths });
          setLengthUnits(lengths);
        }}
      />
    ),
    language: () => (
      <Segments
        label="Language"
        value={values.language}
        pairs={[
          ["en", "English"],
          ["cs", "Čeština"],
        ]}
        onChange={(value) => save({ language: value as SettingValues["language"] })}
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
      toggle("Signature block", values.signature_block, (value) =>
        save({ signature_block: value }),
      ),
    tools: () => (
      <Segments
        label="Tools"
        value={values.tools}
        pairs={[
          ["rail", "Left rail"],
          ["dock", "Bottom dock"],
        ]}
        onChange={(value) => save({ tools: value as SettingValues["tools"] })}
      />
    ),
    panelWidth: () => (
      <Segments
        label="Side panel width"
        value={String(values.side_panel_width)}
        pairs={[
          ["300", "Narrow"],
          ["340", "Default"],
          ["420", "Wide"],
        ]}
        onChange={(value) => save({ side_panel_width: Number(value), hide_side_panel: false })}
      />
    ),
    hidePanel: () =>
      toggle("Hide the panel", values.hide_side_panel, (value) => save({ hide_side_panel: value })),
    panelMoving: () => (
      <Segments
        label="Panel while moving"
        value={values.panel_while_moving}
        pairs={[
          ["pinned", "Stays put"],
          ["auto", "Hides while panning"],
        ]}
        onChange={(value) =>
          save({ panel_while_moving: value as SettingValues["panel_while_moving"] })
        }
      />
    ),
    minimap: () => (
      <Segments
        label="Minimap"
        value={values.minimap}
        pairs={[
          ["useful", "When useful"],
          ["always", "Always"],
          ["never", "Never"],
        ]}
        onChange={(value) => save({ minimap: value as SettingValues["minimap"] })}
      />
    ),
    strip: () => toggle("Pinned slide strip", pinnedStrip, setPinnedStrip),
    defaultPreset: () => (
      <Segments
        label="Default preset"
        value={String(values.default_preset < presetNames.length ? values.default_preset : 0)}
        pairs={presetNames.map((name, index) => [String(index), presetName(name)])}
        onChange={(value) => {
          const index = Number(value);
          save({ default_preset: index });
          notify(
            `${presetName(presetNames[index] ?? "task")} is your default preset. Settings a task locks still follow the task.`,
          );
        }}
      />
    ),
    outlineMode: () => (
      <Segments
        label="Outline display"
        value={values.outline_mode}
        pairs={outlineModeChoices.map((choice) => [choice, outlineModeLabels[choice]])}
        onChange={(value) => {
          setOutlineMode(value as OutlineModeChoice);
          save({ outline_mode: value as OutlineModeChoice });
        }}
      />
    ),
    confidenceWording: () => {
      const current =
        picked.confidence_wording ??
        wordingNow({ lab: layers.lab, personal: layers.personal, device: {} });
      return (
        <span className="grid gap-1.5">
          <Segments
            label="Confidence wording"
            value={current}
            pairs={wordingPairs}
            onChange={(value) => save({ confidence_wording: value as WordingSetting })}
          />
          <small className="text-caption text-fg-dim" data-slot="wording-example">
            Example: {wordingExample(current)}
          </small>
        </span>
      );
    },
    decisionCutoff: () => lockedValue(`${values.decision_cutoff}%`, "Set by your lab for everyone"),
    tierOutline: () => (
      <Segments
        label="Outline model tier"
        value={values.tier_outline}
        pairs={[
          ["best", "Best"],
          ["good", "Good"],
          ["fast", "Fast"],
        ]}
        onChange={(value) => save({ tier_outline: value as SettingValues["tier_outline"] })}
      />
    ),
    trackRecord: () =>
      toggle("Track record block", values.inspector_track_record, (value) =>
        save({ inspector_track_record: value }),
      ),
    calibration: () =>
      toggle("Calibration details block", values.inspector_calibration, (value) =>
        save({ inspector_calibration: value }),
      ),
    modelWarnings: () =>
      toggle("Model warnings", values.model_warnings, (value) => save({ model_warnings: value })),
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
          setDevice((previous) => ({ ...previous, device: value, ...readCalibration(value) }));
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
        value={values.double_click}
        pairs={[
          ["zoom", "Zoom in 2×"],
          ["toggle", "Last two magnifications"],
        ]}
        onChange={(value) => save({ double_click: value as SettingValues["double_click"] })}
      />
    ),
    speed: () => (
      <Stepper
        label="Pan and zoom speed"
        value={device.speed}
        unit=""
        onChange={(value) => changeCalibration({ speed: value })}
      />
    ),
    deadZone: () => (
      <Stepper
        label="Dead zone"
        value={device.deadZone}
        unit="%"
        onChange={(value) => changeCalibration({ deadZone: value })}
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
      toggle("Initials while sharing", values.initials_while_sharing, (value) =>
        save({ initials_while_sharing: value }),
      ),
    analytics: () =>
      values.analytics_policy === "person"
        ? toggle("Share usage statistics", !values.analytics_opt_out, (value) =>
            save({ analytics_opt_out: !value }),
          )
        : lockedValue(
            values.analytics_policy === "on" ? "On" : "Off",
            "Set by your lab for everyone",
          ),
    lockAfter: () => lockAfterText(policy?.idle_lock_minutes),
    patientBanner: () => patientBannerText(layers.lab),
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
        <input
          aria-label="Name"
          maxLength={200}
          className="h-7 w-64 rounded-sm border border-line bg-surface px-2 text-body text-fg"
          value={nameDraft ?? shownName}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.stopPropagation();
              setNameDraft(null);
            }
          }}
        />
      </span>
    ),
    email: () => lockedValue(me?.email ?? "", "Comes from your sign-in", "font-mono"),
    role: () => lockedValue(me?.title ?? "", "Set by your lab admin"),
    workspace: () => lockedValue(workspace?.name ?? "", "Set by your lab admin"),
  };

  const shownName = savedName ?? me?.display_name ?? "";

  function commitName() {
    const next = (nameDraft ?? shownName).trim();
    setNameDraft(null);
    if (next === shownName) return;
    if (next === "") {
      notify("Your name can't be empty");
      return;
    }
    setSavedName(next);
    updateMe.mutate(
      { data: { display_name: next } },
      {
        onSuccess: () => {
          notify("Name saved");
          void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        },
        onError: () => {
          setSavedName(null);
          notify("Your name was not saved. Try again.");
        },
      },
    );
  }

  function lockedValue(value: string, reason: string, className?: string) {
    return (
      <span className="inline-flex items-center gap-2" data-locked>
        <Icon name="lock" size="xs" label="Locked" className="text-fg-faint" />
        <span className={className}>{value}</span>
        <small className="text-caption text-fg-faint">{reason}</small>
      </span>
    );
  }

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
          <SettingsRows>
            <SettingsRow
              label="Signature block"
              help={`Signs reports as ${shownName}${me?.title ? `, ${me.title}` : ""}.`}
              scope="personal"
            >
              {controls.signature()}
            </SettingsRow>
          </SettingsRows>
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
