import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  AddKeyButton,
  KeyBinding,
  KeyCard,
  KeyFinder,
  KeyLegend,
  ShortcutGroup,
  ShortcutRow,
  UnboundKey,
} from "@parfocal/ui/components/shortcut-editor";
import { Switch } from "@parfocal/ui/components/switch";
import { type ReactNode, useEffect, useRef } from "react";
import {
  directionSets,
  type KeyAction,
  keyAction,
  keyGroups,
  reservedKeys,
  shortcutPresetNames,
} from "./keymap.ts";
import {
  applySafeCombo,
  cancelRecording,
  capture,
  conflicts,
  currentKeys,
  foundBy,
  isChanged,
  isSingleCharacter,
  type Outcome,
  pickDirection,
  resetKey,
  type ShortcutFilter,
  type ShortcutState,
  safeCombo,
  startRecording,
  swap,
  take,
  visibleActions,
  type WholeSlide,
} from "./shortcuts.ts";

export type ShortcutPresetKey = keyof typeof shortcutPresetNames;

const presetOrder: ShortcutPresetKey[] = ["default", "qupath", "figma"];

const holdNotes: Record<WholeSlide, string> = {
  both: "tap keeps it open, hold shows it while held",
  hold: "only while held",
  tap: "tap opens and closes",
};

export const isListening = (state: ShortcutState) =>
  state.finding || (state.recording !== null && !keyAction(state.recording.id).direction);

export function useKeyCapture(state: ShortcutState, apply: (outcome: Outcome) => void) {
  const listening = isListening(state);
  useEffect(() => {
    if (!listening) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      apply(capture(state, event));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, state, apply]);
}

function PendingCard({
  state,
  action,
  apply,
}: {
  state: ShortcutState;
  action: KeyAction;
  apply: (outcome: Outcome) => void;
}) {
  const pending = state.pending;
  const slot = state.recording?.slot ?? 0;
  const cancel = (
    <Button variant="ghost" onClick={() => apply({ state: cancelRecording(state) })}>
      Cancel
    </Button>
  );
  if (action.direction) {
    const clash = pending?.kind === "dirclash" ? pending : null;
    return (
      <KeyCard
        tone={clash ? "warn" : "recording"}
        title={`Pick the keys for ${action.name.toLowerCase()}`}
        actions={directionSets.map(([value, label]) => (
          <Button
            key={value}
            variant={currentKeys(state, action)[0] === value ? "selected" : "secondary"}
            onClick={() => apply({ state: pickDirection(state, action.id, value) })}
          >
            {label}
          </Button>
        ))}
        keys={
          <>
            <Keycap keys="Esc" /> cancel
          </>
        }
      >
        {clash
          ? `${clash.value.split("").join(" ")} would take keys from ${clash.names.join(" and ")}. Change those first, or keep the arrows.`
          : "Directions come as a set of four."}
      </KeyCard>
    );
  }
  if (pending === null) {
    return (
      <KeyCard
        tone="recording"
        title={`Press the new key for ${action.name.toLowerCase()}`}
        keys={
          <>
            <Keycap keys="Esc" /> cancel <Keycap keys="⌫" /> remove this key
          </>
        }
      >
        {action.range
          ? "Press only the modifier, for example ⌥ or ⌃. The numbers 1 to 6 stay the same."
          : action.sequence
            ? "Press the first key. A number from 1 to 9 always follows it."
            : "A key, or a key with ⌘, ⌃, ⌥ or ⇧. Keys are matched by their position, so this works on a Czech keyboard too."}
      </KeyCard>
    );
  }
  if (pending.kind === "conflict") {
    const other = keyAction(pending.other);
    const old = currentKeys(state, action)[slot];
    const otherName = other.name.toLowerCase();
    return (
      <KeyCard
        tone="warn"
        title={`${pending.combo} is already ${otherName} in ${other.group.toLowerCase()}`}
        actions={
          <>
            {old ? (
              <Button onClick={() => apply(swap(state))}>
                Swap: {otherName} gets {old}
              </Button>
            ) : null}
            <Button onClick={() => apply(take(state))}>
              Use {pending.combo} here, leave {otherName} without a key
            </Button>
            {cancel}
          </>
        }
      >
        One key can only do one thing in the same place. Choose what happens to {otherName}.
      </KeyCard>
    );
  }
  if (pending.kind === "reserved") {
    return (
      <KeyCard
        tone="bad"
        title={`The browser keeps ${pending.combo}`}
        actions={
          <>
            <Button onClick={() => apply({ state: startRecording(state, action.id, slot) })}>
              Try another key
            </Button>
            {cancel}
          </>
        }
      >
        It {reservedKeys[pending.combo]}, before the viewer can see the key. Pick another key.
      </KeyCard>
    );
  }
  if (pending.kind === "safe") {
    return (
      <KeyCard
        tone="warn"
        title={`${action.name} needs ⌘ or ⌃`}
        actions={
          <>
            <Button onClick={() => apply({ state: applySafeCombo(state) })}>
              Use {safeCombo(pending.combo)} instead
            </Button>
            {cancel}
          </>
        }
      >
        It changes the report, so a single key could be pressed by accident while reading. Your lab
        requires a modifier for it.
      </KeyCard>
    );
  }
  return null;
}

function Row({
  state,
  action,
  clashes,
  apply,
}: {
  state: ShortcutState;
  action: KeyAction;
  clashes: [string, string, string][];
  apply: (outcome: Outcome) => void;
}) {
  const keys = currentKeys(state, action);
  const changed = isChanged(state, action);
  const recordingHere = state.recording?.id === action.id;
  const clashing = clashes.filter(([a, b]) => a === action.id || b === action.id);
  const found = state.findKey !== null && foundBy(keys, state.findKey);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (recordingHere) row.current?.scrollIntoView({ block: "center" });
  }, [recordingHere]);
  const chip = (key: string, slot: number) => {
    const recording = recordingHere && state.recording?.slot === slot;
    const off = !state.singleLetter && isSingleCharacter(key) && !action.fixed;
    const conflict = clashing.some(([, , clash]) => clash === key);
    return (
      <KeyBinding
        key={`${key}-${slot}`}
        state={
          recording
            ? "recording"
            : off
              ? "off"
              : conflict
                ? "conflict"
                : changed
                  ? "mine"
                  : "default"
        }
        disabled={action.fixed ?? false}
        aria-label={`${action.name}: ${key}`}
        title={
          action.fixed
            ? "Kept fixed so there is always a way back"
            : off
              ? "Single-letter shortcuts are off"
              : "Click, then press the new key"
        }
        onClick={() => apply({ state: startRecording(state, action.id, slot) })}
      >
        {recording ? "Press a key" : key}
      </KeyBinding>
    );
  };
  const notes: ReactNode[] = [
    ...(action.note ? [action.note] : []),
    ...(action.hold ? [holdNotes[state.wholeSlide]] : []),
    ...(action.fixed ? ["fixed"] : []),
  ];
  const settable = !(action.fixed || action.range || action.direction || action.sequence);
  return (
    <ShortcutRow
      ref={row}
      name={action.name}
      notes={notes}
      source={action.source}
      highlight={found ? "found" : recordingHere ? "recording" : undefined}
      keys={
        <>
          {keys.length > 0 ? keys.map(chip) : <UnboundKey />}
          {settable ? (
            <AddKeyButton
              onClick={() => apply({ state: startRecording(state, action.id, keys.length) })}
            />
          ) : null}
        </>
      }
      standard={
        changed ? (
          <>
            <span>default {action.keys.join(", ")}</span>
            <Button
              variant="link"
              size="xs"
              onClick={() => apply({ state: resetKey(state, action.id) })}
            >
              Reset
            </Button>
          </>
        ) : action.fixed ? null : (
          <span>default</span>
        )
      }
      card={recordingHere ? <PendingCard state={state} action={action} apply={apply} /> : undefined}
    />
  );
}

type ShortcutsSectionProps = {
  state: ShortcutState;
  query: string;
  preset: ShortcutPresetKey;
  apply: (outcome: Outcome) => void;
  onPreset: (preset: ShortcutPresetKey) => void;
  notify: (message: string) => void;
};

export function ShortcutsSection({
  state,
  query,
  preset,
  apply,
  onPreset,
  notify,
}: ShortcutsSectionProps) {
  const clashes = conflicts(state);
  const changedCount = Object.keys(state.custom).length;
  const visible = visibleActions(state, query);
  const groups = keyGroups
    .map(({ group, context }) => ({
      group,
      context,
      rows: visible.filter((action) => action.group === group),
    }))
    .filter((group) => group.rows.length > 0);
  const set = (patch: Partial<ShortcutState>) => apply({ state: { ...state, ...patch } });
  const nextPreset =
    presetOrder[(presetOrder.indexOf(preset) + 1) % presetOrder.length] ?? "default";
  return (
    <>
      <div className="flex items-center gap-2.5">
        <KeyFinder
          listening={state.finding}
          found={state.findKey ?? undefined}
          onClick={() => set({ finding: true, findKey: null, recording: null, pending: null })}
          onClear={() => set({ finding: false, findKey: null })}
        />
        <SegmentedControl
          fill
          aria-label="Show"
          className="flex-none"
          value={state.filter}
          onValueChange={(value) => set({ filter: value as ShortcutFilter })}
          options={[
            { value: "all", label: "All" },
            { value: "changed", label: `Changed${changedCount ? ` ${changedCount}` : ""}` },
            {
              value: "conflicts",
              label: `Conflicts${clashes.length ? ` ${clashes.length}` : ""}`,
            },
          ]}
        />
      </div>
      <div className="-mt-1.5 flex items-center justify-between gap-3 text-caption text-fg-faint">
        <span className="inline-flex items-center gap-1">
          Preset
          <Button
            variant="ghost"
            size="xs"
            className="font-medium text-fg"
            onClick={() => {
              onPreset(nextPreset);
              notify(
                `Preset ${shortcutPresetNames[nextPreset]}. Your own changes stay on top of it.`,
              );
            }}
          >
            {shortcutPresetNames[preset]}
            <Icon name="down" size="xs" />
          </Button>
        </span>
        <KeyLegend />
        <Button
          variant="ghost"
          disabled={changedCount === 0}
          title={changedCount === 0 ? "Nothing changed" : undefined}
          onClick={() => {
            set({ custom: {} });
            notify("Every shortcut is back to the default");
          }}
        >
          Reset all
        </Button>
      </div>
      {state.findKey !== null && groups.length === 0 ? (
        <div className="rounded-lg border border-line bg-chrome-2 px-3 py-2.5 text-body-sm text-fg-dim">
          {state.findKey} does nothing yet. Click any action below, then press {state.findKey} to
          give it that key.
        </div>
      ) : null}
      <div className="grid gap-4">
        {groups.length > 0 ? (
          groups.map(({ group, context, rows }) => (
            <ShortcutGroup
              key={group}
              title={group}
              where={
                context === "review"
                  ? "in a review. The answer keys follow the task's decision style"
                  : "everywhere"
              }
            >
              {rows.map((action) => (
                <Row
                  key={action.id}
                  state={state}
                  action={action}
                  clashes={clashes}
                  apply={apply}
                />
              ))}
            </ShortcutGroup>
          ))
        ) : state.findKey === null ? (
          <div className="rounded-lg border border-line bg-chrome-2 px-3 py-2.5 text-body-sm text-fg-dim">
            Nothing here.{" "}
            {state.filter === "changed"
              ? "You have not changed any key."
              : "No two actions share a key."}
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 border-t border-line pt-3.5">
        <OptionRow
          label="Single-letter shortcuts"
          help="Turn off if keys fire by accident, for example with speech input. Keys with ⌘, ⌃ or ⌥ keep working."
        >
          <Switch
            aria-label="Single-letter shortcuts"
            checked={state.singleLetter}
            onCheckedChange={(checked) => set({ singleLetter: checked })}
          />
        </OptionRow>
        <OptionRow
          label="Match keys by position, not by letter"
          help="Keeps ⌥1 to ⌥6 and the type keys in place on Czech QWERTZ, where the number row types ě, š, č."
        >
          <Switch
            aria-label="Match keys by position"
            checked={state.byPosition}
            onCheckedChange={(checked) => set({ byPosition: checked })}
          />
        </OptionRow>
        <OptionRow label="Whole slide key" help="How Z behaves.">
          <SegmentedControl
            fill
            aria-label="Whole slide key"
            value={state.wholeSlide}
            onValueChange={(value) => set({ wholeSlide: value as WholeSlide })}
            options={[
              { value: "both", label: "Tap or hold" },
              { value: "hold", label: "Hold only" },
              { value: "tap", label: "Tap toggles" },
            ]}
          />
        </OptionRow>
        <OptionRow label="Your shortcuts" help="Personal: they follow you to any workstation.">
          <Button
            onClick={() =>
              notify(
                `shortcuts.json saved to Downloads, with ${
                  changedCount
                    ? `your ${changedCount} changed key${changedCount > 1 ? "s" : ""}`
                    : "the default keys"
                }`,
              )
            }
          >
            Export
          </Button>
        </OptionRow>
      </div>
    </>
  );
}

function OptionRow({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-body-sm text-fg">
        {label}
        <small className="block max-w-[520px] text-body-sm leading-[1.45] text-fg-dim">
          {help}
        </small>
      </span>
      {children}
    </div>
  );
}
