import { Trans, useLingui } from "@lingui/react/macro";
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
import { PreviewOption, type SettingPreviewKind } from "@parfocal/ui/components/setting-preview";
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
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { now } from "../../clock.ts";
import {
  type Calibration,
  calibrationDefaults,
  readCalibration,
  writeCalibration,
} from "../../devices/calibration.ts";
import {
  chooseFeel,
  type Navigation,
  readNavigation,
  type WheelChoice,
  writeNavigation,
} from "../../devices/navigation.ts";
import { type HidLike, hasWebHid, requestSpaceMouse } from "../../devices/spacemouse-source.ts";
import { useActiveTourStep } from "../../help/tour-state.ts";
import { useHintsSeen } from "../../hints/hints-seen.ts";
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
import { setSlideBrightness, useSlideBrightness } from "../../viewer/slide-brightness.ts";
import { andJoin } from "../format.ts";
import { type HomeLayoutChoice, homeLayoutOptions } from "../home/home-layout.ts";
import { okData } from "../placeholder.tsx";
import { FeelPreview } from "./feel-preview.tsx";
import { lockAfterText, patientBannerText } from "./privacy.ts";
import {
  hintId,
  matchCount,
  matchingRows,
  normalQuery,
  type RowKey,
  type SettingRow,
  type SettingsScene,
  type SettingsSection,
  shortcutSceneOf,
  shownSection,
  showsOnce,
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
  device: string;
  speed: number;
  deadZone: number;
  spaceMouseRotation: boolean;
};

const deviceDefaults: Device = {
  device: "mouse",
  speed: calibrationDefaults.speed,
  deadZone: calibrationDefaults.deadZone,
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

const options = (pairs: [string, string][], preview?: SettingPreviewKind): SegmentOption[] =>
  pairs.map(([value, label]) => ({
    value,
    label:
      preview === undefined ? label : <PreviewOption kind={preview} option={value} label={label} />,
  }));

function Segments({
  label,
  value,
  pairs,
  preview,
  onChange,
}: {
  label: string;
  value: string;
  pairs: [string, string][];
  preview?: SettingPreviewKind;
  onChange: (value: string) => void;
}) {
  return (
    <SegmentedControl
      fill
      aria-label={label}
      value={value}
      onValueChange={(next) => onChange(String(next))}
      options={options(pairs, preview)}
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
  const { t } = useLingui();

  const step = (delta: number) => onChange(Math.max(20, Math.min(140, value + delta)));
  return (
    <div className="flex items-center gap-2.5">
      <Button size="icon-sm" aria-label={t`Lower ${label}`} onClick={() => step(-10)}>
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
      <Button size="icon-sm" aria-label={t`Raise ${label}`} onClick={() => step(10)}>
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
  const { t } = useLingui();

  const touring = useActiveTourStep() !== null;
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
  const hints = useHintsSeen();
  const [hintsShownAgain, setHintsShownAgain] = useState(0);
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
  const [navigation, setNavigation] = useState(() => readNavigation());
  const changeNavigation = (change: Partial<Navigation>) => {
    writeNavigation(change);
    setNavigation(readNavigation());
  };
  const [pinnedStrip, setPinnedStrip] = usePinnedStrip();
  const [, setOutlineMode] = useOutlineMode();
  const [theme, setTheme] = useState<ThemeChoice>(() => readTheme());
  const [slideBrightness] = useSlideBrightness();
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
  const sectionTitles: Record<SettingsSection, string> = {
    display: t`Display`,
    review: t`Review`,
    layout: t`Layout`,
    ai: t`AI and confidence`,
    navigation: t`Navigation and devices`,
    shortcuts: t`Shortcuts`,
    notifications: t`Notifications`,
    privacy: t`Privacy and session`,
    account: t`Account`,
  };
  const shown = shownSection(section, query);
  const visible = visibleSections(query);
  const presetNames = ["task", ...values.presets.slice(0, 3)];
  const presetName = (name: string) => (name === "task" ? t`Task default` : name);
  const others = sessions.filter((session) => !session.current);
  const setD = <Key extends keyof Device>(key: Key, value: Device[Key]) =>
    setDevice((previous) => ({ ...previous, [key]: value }));
  const changeCalibration = (change: Partial<Calibration>) => {
    setDevice((previous) => ({ ...previous, ...writeCalibration(previous.device, change) }));
    writeNavigation({});
  };
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
        label={t`Home`}
        preview="home"
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
        label={t`Theme`}
        preview="theme"
        value={theme}
        pairs={[
          ["dark", t`Dark`],
          ["light", t`Light`],
          ["system", t`System`],
        ]}
        onChange={(value) => {
          setTheme(value as ThemeChoice);
          chooseTheme(value as ThemeChoice);
        }}
      />
    ),
    brightness: () => (
      <Stepper
        label={t`Slide brightness`}
        value={slideBrightness}
        unit="%"
        onChange={setSlideBrightness}
      />
    ),
    density: () => (
      <Segments
        label={t`Density`}
        preview="density"
        value={values.density}
        pairs={[
          ["comfortable", t`Comfortable`],
          ["compact", t`Compact`],
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
        label={t`Lengths`}
        value={values.length_unit}
        pairs={[
          ["auto", t`µm and mm`],
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
      <SegmentedControl
        fill
        aria-label={t`Language`}
        value="en"
        onValueChange={() => undefined}
        options={[
          { value: "en", label: t`English` },
          { value: "cs", label: "Čeština", disabled: true },
        ]}
      />
    ),
    hints: () => (
      <Button
        disabled={hints.seen.size === 0}
        onClick={() => {
          hints.showAllAgain();
          setHintsShownAgain((count) => count + 1);
          notify(t`Every hint shows again, once, under its setting.`);
        }}
      >
        <Trans>Show all hints again</Trans>
      </Button>
    ),
    patientNames: () =>
      layers.lab.locked.includes("patient_names") ? (
        lockedValue(
          values.patient_names === "initials" ? t`Initials only` : t`Full name`,
          t`Set by your lab for everyone`,
        )
      ) : (
        <Segments
          label={t`Patient names`}
          value={values.patient_names}
          pairs={[
            ["full", t`Full name`],
            ["initials", t`Initials only`],
          ]}
          onChange={(value) => save({ patient_names: value as SettingValues["patient_names"] })}
        />
      ),
    magnificationLabel: () => (
      <Segments
        label={t`Magnification label`}
        value={values.magnification_label}
        pairs={[
          ["objective", t`Objective`],
          ["microns-per-pixel", t`µm per pixel`],
        ]}
        onChange={(value) =>
          save({ magnification_label: value as SettingValues["magnification_label"] })
        }
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
        title={onEditPresets === undefined ? t`Open a review task first` : undefined}
      >
        <Icon name="sliders" />
        <Trans>Edit in the Display panel</Trans>
      </Button>
    ),
    signature: () =>
      toggle(t`Signature block`, values.signature_block, (value) =>
        save({ signature_block: value }),
      ),
    tools: () => (
      <Segments
        label={t`Tools`}
        preview="tools"
        value={values.tools}
        pairs={[
          ["rail", t`Left rail`],
          ["dock", t`Bottom dock`],
        ]}
        onChange={(value) => save({ tools: value as SettingValues["tools"] })}
      />
    ),
    panelWidth: () => (
      <Segments
        label={t`Side panel width`}
        preview="panelWidth"
        value={String(values.side_panel_width)}
        pairs={[
          ["300", t`Narrow`],
          ["340", t`Default`],
          ["420", t`Wide`],
        ]}
        onChange={(value) => save({ side_panel_width: Number(value), hide_side_panel: false })}
      />
    ),
    hidePanel: () =>
      toggle(t`Hide the panel`, values.hide_side_panel, (value) =>
        save({ hide_side_panel: value }),
      ),
    panelMoving: () => (
      <Segments
        label={t`Panel while moving`}
        preview="panelMoving"
        value={values.panel_while_moving}
        pairs={[
          ["pinned", t`Stays put`],
          ["auto", t`Hides while panning`],
        ]}
        onChange={(value) =>
          save({ panel_while_moving: value as SettingValues["panel_while_moving"] })
        }
      />
    ),
    minimap: () => (
      <Segments
        label={t`Minimap`}
        preview="minimap"
        value={values.minimap}
        pairs={[
          ["useful", t`When useful`],
          ["always", t`Always`],
          ["never", t`Never`],
        ]}
        onChange={(value) => save({ minimap: value as SettingValues["minimap"] })}
      />
    ),
    strip: () => toggle(t`Pinned slide strip`, pinnedStrip, setPinnedStrip),
    defaultPreset: () => (
      <Segments
        label={t`Default preset`}
        value={String(values.default_preset < presetNames.length ? values.default_preset : 0)}
        pairs={presetNames.map((name, index) => [String(index), presetName(name)])}
        onChange={(value) => {
          const index = Number(value);
          save({ default_preset: index });
          notify(
            t`${presetName(presetNames[index] ?? "task")} is your default preset. Settings a task locks still follow the task.`,
          );
        }}
      />
    ),
    outlineMode: () => (
      <Segments
        label={t`Outline display`}
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
            label={t`Confidence wording`}
            value={current}
            pairs={wordingPairs}
            onChange={(value) => save({ confidence_wording: value as WordingSetting })}
          />
          <small className="text-caption text-fg-dim" data-slot="wording-example">
            <Trans>Example: {wordingExample(current)}</Trans>
          </small>
        </span>
      );
    },
    decisionCutoff: () =>
      lockedValue(`${values.decision_cutoff}%`, t`Set by your lab for everyone`),
    tierOutline: () => (
      <Segments
        label={t`Outline model tier`}
        value={values.tier_outline}
        pairs={[
          ["best", t`Best`],
          ["good", t`Good`],
          ["fast", t`Fast`],
        ]}
        onChange={(value) => save({ tier_outline: value as SettingValues["tier_outline"] })}
      />
    ),
    trackRecord: () =>
      toggle(t`Track record block`, values.inspector_track_record, (value) =>
        save({ inspector_track_record: value }),
      ),
    calibration: () =>
      toggle(t`Calibration details block`, values.inspector_calibration, (value) =>
        save({ inspector_calibration: value }),
      ),
    modelWarnings: () =>
      toggle(t`Model warnings`, values.model_warnings, (value) => save({ model_warnings: value })),
    device: () => (
      <Segments
        label={t`Main input device`}
        value={device.device}
        pairs={[
          ["mouse", t`Mouse`],
          ["trackpad", t`Trackpad`],
          ["spacemouse", "SpaceMouse"],
          ["gamepad", t`Gamepad`],
          ["pen", "Pen"],
        ]}
        onChange={(value) => {
          writeDeviceSetting("device", value);
          if (value === "spacemouse" && hasWebHid(navigator)) {
            void requestSpaceMouse((navigator as unknown as { hid: HidLike }).hid);
          }
          writeNavigation({});
          setDevice((previous) => ({ ...previous, device: value, ...readCalibration(value) }));
        }}
      />
    ),
    wheel: () => (
      <Segments
        label={t`Mouse wheel`}
        value={navigation.wheel}
        pairs={[
          ["zoom", t`Zoom`],
          ["pan", "Pan"],
          ["detect", t`Detect device`],
        ]}
        onChange={(value) => changeNavigation({ wheel: value as WheelChoice })}
      />
    ),
    doubleClick: () => (
      <Segments
        label={t`Double-click`}
        value={values.double_click}
        pairs={[
          ["zoom", t`Zoom in 2×`],
          ["toggle", t`Last two magnifications`],
        ]}
        onChange={(value) => save({ double_click: value as SettingValues["double_click"] })}
      />
    ),
    speed: () => (
      <Stepper
        label={t`Pan and zoom speed`}
        value={device.speed}
        unit=""
        onChange={(value) => changeCalibration({ speed: value })}
      />
    ),
    deadZone: () => (
      <Stepper
        label={t`Dead zone`}
        value={device.deadZone}
        unit="%"
        onChange={(value) => changeCalibration({ deadZone: value })}
      />
    ),
    invertZoom: () =>
      toggle(t`Invert zoom direction`, navigation.invertZoom, (value) =>
        changeNavigation({ invertZoom: value }),
      ),
    spaceMouseRotation: () =>
      toggle("SpaceMouse rotation", device.spaceMouseRotation, (value) =>
        setD("spaceMouseRotation", value),
      ),
    feel: () => (
      <Segments
        label={t`Camera feel`}
        value={navigation.feel}
        pairs={[
          ["smooth", t`Smooth`],
          ["precise", t`Precise`],
          ["instant", t`Instant`],
        ]}
        onChange={(value) => {
          chooseFeel(value as Navigation["feel"]);
          setNavigation(readNavigation());
        }}
      />
    ),
    coasting: () =>
      toggle(t`Coasting`, navigation.coasting, (value) => changeNavigation({ coasting: value })),
    animatedJumps: () =>
      toggle(t`Animated jumps`, navigation.animatedJumps, (value) =>
        changeNavigation({ animatedJumps: value }),
      ),
    zoomAnchor: () => (
      <Segments
        label={t`Zoom anchor`}
        value={navigation.zoomAnchor}
        pairs={[
          ["cursor", t`Cursor`],
          ["centre", t`View centre`],
        ]}
        onChange={(value) => changeNavigation({ zoomAnchor: value as Navigation["zoomAnchor"] })}
      />
    ),
    objectiveDetents: () =>
      toggle(t`Objective detents`, navigation.objectiveDetents, (value) =>
        changeNavigation({ objectiveDetents: value }),
      ),
    feelPreview: () => <FeelPreview navigation={navigation} />,
    noticeTask: () => notice("noticeTask", t`A task is given to me`),
    noticeMention: () => notice("noticeMention", t`Someone mentions me`),
    noticeReply: () => notice("noticeReply", t`Someone replies to me`),
    noticeStat: () => notice("noticeStat", t`A STAT task is given to me`),
    statSound: () =>
      toggle(t`Sound for STAT tasks`, stat.sound, (value) => {
        writeStatSound(value);
        setStat((previous) => ({ ...previous, sound: value }));
      }),
    noticeSubmit: () => notice("noticeSubmit", t`A reviewer submits a slide of my task`),
    noticeRun: () => notice("noticeRun", t`A model run finishes`),
    noticeDue: () => notice("noticeDue", t`A reminder before a due date`),
    initials: () =>
      toggle(t`Initials while sharing`, values.initials_while_sharing, (value) =>
        save({ initials_while_sharing: value }),
      ),
    analytics: () =>
      values.analytics_policy === "person"
        ? toggle(t`Share usage statistics`, !values.analytics_opt_out, (value) =>
            save({ analytics_opt_out: !value }),
          )
        : lockedValue(
            values.analytics_policy === "on" ? "On" : "Off",
            t`Set by your lab for everyone`,
          ),
    lockAfter: () => lockAfterText(policy?.idle_lock_minutes),
    patientBanner: () => patientBannerText(layers.lab),
    otherDevices: () =>
      others.length === 0 ? (
        <span className="text-body text-fg">
          <Trans>Only this device</Trans>
        </span>
      ) : (
        <Button
          disabled={endOthers.isPending}
          onClick={() =>
            endOthers.mutate(undefined, {
              onSuccess: (response) => {
                const count = response.status === 200 ? response.data.ended : others.length;
                setSignedOutAt({ count, at: now() });
                notify(t`Signed out of the ${count} other devices`);
                void queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
              },
            })
          }
        >
          <Trans>Sign out on other devices</Trans>
        </Button>
      ),
    name: () => (
      <span className="inline-flex items-center gap-2">
        <PersonAvatar person={personOf(me)} size={20} />
        <input
          aria-label={t`Name`}
          maxLength={200}
          className="h-7 w-64 rounded-sm border border-line bg-surf-field px-2 text-body text-fg"
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
    email: () => lockedValue(me?.email ?? "", t`Comes from your sign-in`, "font-mono"),
    role: () => lockedValue(me?.title ?? "", t`Set by your lab admin`),
    workspace: () => lockedValue(workspace?.name ?? "", t`Set by your lab admin`),
  };

  const shownName = savedName ?? me?.display_name ?? "";

  function commitName() {
    const next = (nameDraft ?? shownName).trim();
    setNameDraft(null);
    if (next === shownName) return;
    if (next === "") {
      notify(t`Your name can't be empty`);
      return;
    }
    setSavedName(next);
    updateMe.mutate(
      { data: { display_name: next } },
      {
        onSuccess: () => {
          notify(t`Name saved`);
          void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        },
        onError: () => {
          setSavedName(null);
          notify(t`Your name was not saved. Try again.`);
        },
      },
    );
  }

  function lockedValue(value: string, reason: string, className?: string) {
    return (
      <span className="inline-flex items-center gap-2" data-locked>
        <Icon name="lock" size="xs" label={t`Locked`} className="text-fg-faint" />
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
          ["email", t`Email`],
          ["bell", t`Bell`],
          ["quiet", t`Quiet`],
        ]}
        onChange={(value) => chooseChannel(key, value as Channel)}
      />
    );
  }

  const help = (item: SettingRow): string => {
    if (item.key !== "otherDevices") return item.help;
    if (signedOutAt && others.length === 0) {
      return t`Signed out of ${signedOutAt.count} other devices at ${clockTime(signedOutAt.at)}. They ask for a sign-in next time.`;
    }
    if (others.length === 0) return t`No other device is signed in.`;
    return t`${others.length === 2 ? "Two" : others.length} other devices are signed in: ${andJoin(
      others.map((session) => withArticle(session.user_agent ?? "unknown device")),
    )}.`;
  };

  const facts: RowKey[] = ["presetKeys", "lockAfter", "patientBanner"];
  const factIcons = { name: "user", email: "mail", role: "flag", workspace: "folder" } as const;

  const sectionKey = shown?.key;
  const [entry, setEntry] = useState({
    key: sectionKey,
    again: hintsShownAgain,
    seen: hints.seen,
  });
  if (entry.key !== sectionKey || entry.again !== hintsShownAgain) {
    setEntry({
      key: sectionKey,
      again: hintsShownAgain,
      seen: entry.again !== hintsShownAgain ? new Set<string>() : hints.seen,
    });
  }
  const notedRows =
    sectionKey === undefined || sectionKey === "shortcuts"
      ? []
      : matchingRows(sectionKey, query)
          .filter(showsOnce)
          .map((item) => hintId(item.key));
  const leavingNotes = useRef<string[]>([]);
  const visiting = useRef<string | undefined>(undefined);
  const markHintsSeen = useRef(hints.markSeen);
  useEffect(() => {
    leavingNotes.current = notedRows;
    markHintsSeen.current = hints.markSeen;
  });
  useEffect(() => {
    if (sectionKey === undefined) return;
    visiting.current = sectionKey;
    return () => {
      const leaving = leavingNotes.current;
      visiting.current = undefined;
      setTimeout(() => {
        if (visiting.current !== sectionKey) markHintsSeen.current(leaving);
      }, 0);
    };
  }, [sectionKey]);

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
              label={t`Signature block`}
              help={t`Signs reports as ${shownName}${me?.title ? `, ${me.title}` : ""}.`}
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
            {...(showsOnce(item)
              ? {
                  note: item.help,
                  noteHidden: entry.seen.has(hintId(item.key)),
                  onControlChange: () => hints.markSeen([hintId(item.key)]),
                }
              : { help: help(item) })}
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
      modal={!touring}
      title={shown ? sectionTitles[shown.key] : t`Settings`}
      hint={query && shown ? t`Matching "${typed.trim()}"` : undefined}
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
          empty={visible.length === 0 ? t`No section matches` : undefined}
        >
          {visible.map((item) => (
            <SettingsNavItem
              key={item.key}
              icon={item.icon}
              label={sectionTitles[item.key]}
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
