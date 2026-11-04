import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { PersonAvatar } from "@parfocal/ui/components/person";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import { RadioGroup, RadioRow } from "@parfocal/ui/components/radio-group";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { Switch } from "@parfocal/ui/components/switch";
import type { PersonInfo } from "@parfocal/ui/lib/avatar-colours";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";
import { useId } from "react";

type Origin = "ai" | "ai-edited" | "ai-confirmed" | "human";

const originNames: Record<Origin, string> = {
  ai: "AI",
  "ai-edited": "AI, edited",
  "ai-confirmed": "AI, confirmed",
  human: "By hand",
};

const originHints: Record<Origin, string> = {
  ai: "Made by the model and not checked yet",
  "ai-edited": "Made by the model, then fixed by an expert",
  "ai-confirmed": "Made by the model and kept as it is by an expert",
  human: "Drawn or imported by an expert",
};

const originTone: Record<Origin, string> = {
  ai: "bg-chrome-3 text-fg-dim",
  "ai-edited": "bg-[color-mix(in_srgb,var(--warn)_16%,transparent)] text-warn",
  "ai-confirmed": "bg-[color-mix(in_srgb,var(--ok)_16%,transparent)] text-ok",
  human: "bg-accent-soft text-accent",
};

type OriginMarkProps = React.ComponentProps<"span"> & {
  origin: Origin;
  author?: PersonInfo | undefined;
};

function OriginMark({ origin, author, className, ...props }: OriginMarkProps) {
  return (
    <span
      data-slot="origin-mark"
      data-origin={origin}
      title={originHints[origin]}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.25 rounded-full pr-2 pl-1 text-label leading-none font-semibold whitespace-nowrap select-none",
        originTone[origin],
        className,
      )}
      {...props}
    >
      {origin === "human" && author ? (
        <PersonAvatar person={author} size={14} />
      ) : (
        <span
          aria-hidden="true"
          className="inline-grid size-3.5 place-items-center rounded-full bg-current/20"
        >
          {origin === "ai" ? (
            <Icon name="smart" size="xs" />
          ) : (
            <Icon name={origin === "ai-edited" ? "pen" : "check"} size="xs" />
          )}
        </span>
      )}
      {originNames[origin]}
    </span>
  );
}

type HistoryEntry = { id: string; who: PersonInfo | null; what: string; when: string };

type ModelInfo = { name: string; version?: string | null | undefined };

type OriginCardProps = React.ComponentProps<"section"> & {
  objectId: string;
  classLabel: string;
  classColour: string;
  origin: Origin;
  author?: PersonInfo | undefined;
  model?: ModelInfo | undefined;
  history: HistoryEntry[];
};

const modelLabel = (model: ModelInfo) =>
  model.version ? `${model.name} ${model.version}` : model.name;

const authorVerbs: Record<Origin, string> = {
  ai: "Made by",
  "ai-edited": "Edited by",
  "ai-confirmed": "Kept as it is by",
  human: "Drawn by",
};

function OriginLines({
  origin,
  author,
  model,
}: Pick<OriginCardProps, "origin" | "author" | "model">) {
  const made =
    model && origin !== "human" ? (
      <p data-slot="origin-model" className="m-0 text-body-sm text-fg-dim">
        Made by <b className="font-semibold text-fg">{modelLabel(model)}</b>
      </p>
    ) : null;
  if (!author) {
    return model ? (
      <p data-slot="origin-model" className="m-0 text-body-sm text-fg-dim">
        Made by <b className="font-semibold text-fg">{modelLabel(model)}</b>, nobody has changed it.
      </p>
    ) : (
      <p className="m-0 text-body-sm text-fg-dim">Made by the model, nobody has changed it.</p>
    );
  }
  return (
    <>
      <p data-slot="origin-author" className="m-0 text-body-sm text-fg-dim">
        {authorVerbs[origin]} <b className="font-semibold text-fg">{author.name}</b>
      </p>
      {made}
    </>
  );
}

function OriginCard({
  objectId,
  classLabel,
  classColour,
  origin,
  author,
  model,
  history,
  className,
  ...props
}: OriginCardProps) {
  return (
    <section
      data-slot="origin-card"
      aria-label={`${objectId} origin and history`}
      className={cn("grid gap-3 rounded-zone border border-line bg-surf-panel p-3.5", className)}
      {...props}
    >
      <header className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-body-sm font-semibold text-fg">
          <i
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ background: classColour }}
          />
          <span className="font-mono">{objectId}</span>
          <span className="font-medium text-fg-dim">{classLabel}</span>
        </span>
        <OriginMark origin={origin} author={author} />
      </header>
      <OriginLines origin={origin} author={author} model={model} />
      <ol aria-label="History" className="m-0 grid list-none gap-2 p-0">
        {history.map((entry) => (
          <li key={entry.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
            {entry.who ? (
              <PersonAvatar person={entry.who} size={18} />
            ) : (
              <span
                aria-hidden="true"
                className="inline-grid size-4.5 place-items-center rounded-full bg-chrome-3 text-fg-dim"
              >
                <Icon name="smart" size="xs" />
              </span>
            )}
            <span className="min-w-0 text-body-sm text-fg">{entry.what}</span>
            <time className="text-caption whitespace-nowrap text-fg-faint tabular-nums">
              {entry.when}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}

type AiResultToggleProps = Omit<React.ComponentProps<"label">, "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  resultName: string;
  count: number;
};

function AiResultToggle({
  checked,
  onCheckedChange,
  resultName,
  count,
  className,
  ...props
}: AiResultToggleProps) {
  const id = useId();
  return (
    <label
      data-slot="ai-result-toggle"
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 rounded-zone border border-line bg-surf-panel px-3 py-2.5",
        className,
      )}
      {...props}
    >
      <span className="grid min-w-0 gap-0.5">
        <b id={`${id}-name`} className="text-body-sm font-semibold text-fg">
          Show the AI result
        </b>
        <small id={`${id}-sub`} className="text-caption text-fg-dim">
          {resultName} · {count} objects
        </small>
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-sub`}
      />
    </label>
  );
}

type CheckCounts = { confirmed: number; edited: number; deleted: number; total: number };

function checkedOf(counts: CheckCounts) {
  return counts.confirmed + counts.edited + counts.deleted;
}

type CheckProgressProps = React.ComponentProps<"div"> & {
  counts: CheckCounts;
  scope: string;
};

function CheckProgress({ counts, scope, className, ...props }: CheckProgressProps) {
  const done = checkedOf(counts);
  return (
    <div data-slot="check-progress" className={cn("grid gap-2", className)} {...props}>
      <ProgressBar
        label={`${done} of ${counts.total} ${scope} checked`}
        valueText={`${counts.total === 0 ? 0 : Math.round((done / counts.total) * 100)}%`}
        value={done}
        max={Math.max(counts.total, 1)}
        tone={done === counts.total && counts.total > 0 ? "ok" : "accent"}
      />
      <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-caption text-fg-dim">
        <li>{counts.confirmed} confirmed</li>
        <li>{counts.edited} edited</li>
        <li>{counts.deleted} deleted</li>
        <li>{counts.total - done} left</li>
      </ul>
    </div>
  );
}

type CheckState = "unchecked" | "confirmed" | "edited" | "deleted";

const checkNames: Record<CheckState, string> = {
  unchecked: "Not checked",
  confirmed: "Confirmed",
  edited: "Edited",
  deleted: "Deleted",
};

function CheckStateTag({
  state,
  className,
  ...props
}: React.ComponentProps<"span"> & { state: CheckState }) {
  return (
    <span
      data-slot="check-state-tag"
      data-state={state}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-label leading-none font-semibold whitespace-nowrap",
        state === "unchecked" && "bg-chrome-3 text-fg-faint",
        state === "confirmed" && "bg-[color-mix(in_srgb,var(--ok)_16%,transparent)] text-ok",
        state === "edited" && "bg-[color-mix(in_srgb,var(--warn)_16%,transparent)] text-warn",
        state === "deleted" && "bg-[color-mix(in_srgb,var(--bad)_16%,transparent)] text-bad",
        className,
      )}
      {...props}
    >
      {state === "unchecked" ? null : (
        <Icon
          name={state === "confirmed" ? "check" : state === "edited" ? "pen" : "close"}
          size="xs"
        />
      )}
      {checkNames[state]}
    </span>
  );
}

type CheckedCardProps = React.ComponentProps<"section"> & {
  nothingToMark?: boolean;
  summary: string;
  onUndo?: () => void;
  onNext?: () => void;
  nextLabel?: string;
};

function CheckedCard({
  nothingToMark = false,
  summary,
  onUndo,
  onNext,
  nextLabel = "Next slide",
  className,
  ...props
}: CheckedCardProps) {
  return (
    <section
      data-slot="checked-card"
      data-nothing={nothingToMark || undefined}
      aria-label="Slide checked"
      className={cn(
        "grid w-88 gap-3 rounded-zone border border-line-strong bg-surf-panel p-4 shadow-[0_8px_24px_rgb(0_0_0/0.35)]",
        className,
      )}
      {...props}
    >
      <header className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="inline-grid size-7 place-items-center rounded-full bg-[color-mix(in_srgb,var(--ok)_18%,transparent)] text-ok"
        >
          <Icon name="check" />
        </span>
        <h3 className="m-0 text-lead font-semibold text-fg">
          {nothingToMark ? "Nothing to mark" : "You checked this slide"}
        </h3>
      </header>
      <p className="m-0 text-body-sm text-fg-dim">{summary}</p>
      <footer className="flex items-center justify-between gap-2">
        {onUndo ? (
          <Button size="sm" variant="ghost" onClick={onUndo}>
            Reopen for changes
          </Button>
        ) : (
          <span />
        )}
        {onNext ? (
          <Button size="sm" variant="primary" onClick={onNext}>
            {nextLabel}
          </Button>
        ) : null}
      </footer>
    </section>
  );
}

type SignOffExpert = { person: PersonInfo; checked: boolean; sub?: string };

type SignOffCardProps = React.ComponentProps<"section"> & {
  slideName: string;
  experts: SignOffExpert[];
  openThreads: number;
  signedOff?: boolean;
  onSignOff?: () => void;
  onShowThreads?: () => void;
};

function SignOffCard({
  slideName,
  experts,
  openThreads,
  signedOff = false,
  onSignOff,
  onShowThreads,
  className,
  ...props
}: SignOffCardProps) {
  const waiting = experts.filter((expert) => !expert.checked);
  const reason =
    waiting.length > 0
      ? `${waiting.map((expert) => expert.person.name).join(" and ")} ${waiting.length > 1 ? "have" : "has"} not checked this slide yet`
      : undefined;
  return (
    <section
      data-slot="sign-off-card"
      data-signed={signedOff || undefined}
      aria-label="Sign off"
      className={cn(
        "grid w-104 gap-3.5 rounded-zone border border-line-strong bg-surf-panel p-4 shadow-[0_8px_24px_rgb(0_0_0/0.35)]",
        className,
      )}
      {...props}
    >
      <header className="grid gap-0.5">
        <h3 className="m-0 text-lead font-semibold text-fg">
          {signedOff ? "Signed off" : "Sign off this slide"}
        </h3>
        <p className="m-0 text-body-sm text-fg-dim">
          {signedOff
            ? `${slideName} is locked. Later changes go to the change log.`
            : `${slideName} locks for everyone once you sign it off.`}
        </p>
      </header>
      <ul aria-label="Experts" className="m-0 grid list-none gap-2 p-0">
        {experts.map((expert) => (
          <li key={expert.person.name} className="flex items-center gap-2.5">
            <PersonAvatar person={expert.person} size={22} />
            <span className="min-w-0 flex-1 text-body-sm text-fg">{expert.person.name}</span>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-caption font-semibold",
                expert.checked ? "text-ok" : "text-fg-faint",
              )}
            >
              <Icon name={expert.checked ? "check" : "clock"} size="xs" />
              {expert.checked ? (expert.sub ?? "Checked") : "Not yet"}
            </span>
          </li>
        ))}
      </ul>
      {openThreads > 0 && !signedOff ? (
        <Banner
          tone="warn"
          inline
          actions={
            onShowThreads ? (
              <Button size="sm" onClick={onShowThreads}>
                Show threads
              </Button>
            ) : undefined
          }
        >
          {openThreads === 1 ? "1 thread is still open." : `${openThreads} threads are still open.`}{" "}
          They stay open after the sign-off.
        </Banner>
      ) : null}
      {signedOff ? null : (
        <footer className="flex items-center justify-between gap-2">
          <small className="min-w-0 text-caption text-fg-faint">{reason ?? ""}</small>
          <Button
            size="sm"
            variant="primary"
            disabled={reason !== undefined}
            onClick={onSignOff}
            title={reason}
          >
            {openThreads > 0 ? "Sign off anyway" : "Sign off"}
          </Button>
        </footer>
      )}
    </section>
  );
}

type PresetKey = "hand" | "run" | "sample" | "regions" | "mixed";

type CheckScopeKind = "none" | "all" | "sample" | "regions";
type CheckOrder = "least-sure" | "position";
type SignOffRule = "require" | "warn";

type CheckOptionValues = {
  scope: CheckScopeKind;
  order: CheckOrder;
  rule: SignOffRule;
  exportUnchecked: boolean;
  hasResult: boolean;
};

type Preset = { key: PresetKey; title: string; text: string; options: CheckOptionValues };

const annotatePresets: Preset[] = [
  {
    key: "hand",
    title: "Annotate by hand",
    text: "No result set. Experts draw with the fast tools.",
    options: {
      scope: "none",
      order: "position",
      rule: "warn",
      exportUnchecked: false,
      hasResult: false,
    },
  },
  {
    key: "run",
    title: "Check a whole-slide run",
    text: "Every AI object is checked, least sure first, and all must be checked.",
    options: {
      scope: "all",
      order: "least-sure",
      rule: "require",
      exportUnchecked: false,
      hasResult: true,
    },
  },
  {
    key: "sample",
    title: "Check a sample",
    text: "A random sample is checked, the rest stays unchecked and out of the export.",
    options: {
      scope: "sample",
      order: "least-sure",
      rule: "require",
      exportUnchecked: false,
      hasResult: true,
    },
  },
  {
    key: "regions",
    title: "Fix AI on selected areas",
    text: "Only objects inside the regions you draw are checked.",
    options: {
      scope: "regions",
      order: "position",
      rule: "require",
      exportUnchecked: false,
      hasResult: true,
    },
  },
  {
    key: "mixed",
    title: "Mixed",
    text: "AI is checked least sure first, and experts draw what it missed.",
    options: {
      scope: "all",
      order: "least-sure",
      rule: "warn",
      exportUnchecked: false,
      hasResult: true,
    },
  },
];

type PresetPickerProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  value: PresetKey;
  onValueChange: (value: PresetKey) => void;
};

function PresetPicker({ value, onValueChange, className, ...props }: PresetPickerProps) {
  return (
    <div data-slot="preset-picker" className={cn("grid gap-2", className)} {...props}>
      <RadioGroup
        aria-label="Preset"
        value={value}
        onValueChange={(next) => onValueChange(next as PresetKey)}
        className="grid gap-2"
      >
        {annotatePresets.map((preset) => (
          <RadioRow
            key={preset.key}
            value={preset.key}
            title={preset.title}
            text={preset.text}
            className={cn(
              "rounded-zone border px-3.5 py-3",
              value === preset.key ? "border-accent bg-accent-soft" : "border-line bg-surf-panel",
            )}
          />
        ))}
      </RadioGroup>
      <small className="text-caption text-fg-dim">
        A preset only fills in the options. You can change each of them on the next step.
      </small>
    </div>
  );
}

type CheckOptionsProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  values: CheckOptionValues;
  onValuesChange: (values: CheckOptionValues) => void;
};

function OptionRow({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 border-b border-line pb-3.5 last:border-b-0 last:pb-0">
      <span className="text-body-sm font-semibold text-fg">{label}</span>
      {children}
      <small className="text-caption text-fg-dim">{help}</small>
    </div>
  );
}

function CheckOptions({ values, onValuesChange, className, ...props }: CheckOptionsProps) {
  const set = (patch: Partial<CheckOptionValues>) => onValuesChange({ ...values, ...patch });
  const noScope = values.scope === "none";
  return (
    <div
      data-slot="check-options"
      className={cn("grid gap-3.5 rounded-zone border border-line bg-surf-panel p-4", className)}
      {...props}
    >
      <OptionRow
        label="Check scope"
        help={
          values.hasResult
            ? "Objects that a model run in the task adds join the scope as they land."
            : "This task has no result set, so there is nothing for the experts to check."
        }
      >
        <SegmentedControl
          aria-label="Check scope"
          fill
          value={values.scope}
          onValueChange={(next) => set({ scope: next as CheckScopeKind })}
          options={[
            { value: "none", label: "Nothing" },
            { value: "all", label: "All AI objects", disabled: !values.hasResult },
            { value: "sample", label: "Random sample", disabled: !values.hasResult },
            { value: "regions", label: "Inside regions", disabled: !values.hasResult },
          ]}
        />
      </OptionRow>
      <OptionRow
        label="Check order"
        help="Least sure first starts with the objects the model was least sure of."
      >
        <SegmentedControl
          aria-label="Check order"
          fill
          value={values.order}
          onValueChange={(next) => set({ order: next as CheckOrder })}
          options={[
            { value: "least-sure", label: "Least sure first", disabled: noScope },
            { value: "position", label: "By position", disabled: noScope },
          ]}
        />
      </OptionRow>
      <OptionRow
        label="Sign-off rule"
        help="Decides what happens when the owner signs a slide off with objects left unchecked."
      >
        <SegmentedControl
          aria-label="Sign-off rule"
          fill
          value={values.rule}
          onValueChange={(next) => set({ rule: next as SignOffRule })}
          options={[
            { value: "require", label: "All must be checked", disabled: noScope },
            { value: "warn", label: "Only warn", disabled: noScope },
          ]}
        />
      </OptionRow>
      <OptionRow
        label="Export unchecked AI objects"
        help="Left out by default. When included they carry the origin ai-unchecked."
      >
        <label className="flex items-center gap-2.5 text-body-sm text-fg">
          <Switch
            checked={values.exportUnchecked}
            disabled={noScope}
            onCheckedChange={(next) => set({ exportUnchecked: next })}
            aria-label="Export unchecked AI objects"
          />
          {values.exportUnchecked ? "Included in the export" : "Left out of the export"}
        </label>
      </OptionRow>
    </div>
  );
}

type BlindFirstSwitchProps = Omit<React.ComponentProps<"label">, "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

function BlindFirstSwitch({
  checked,
  onCheckedChange,
  className,
  ...props
}: BlindFirstSwitchProps) {
  const id = useId();
  return (
    <label
      data-slot="blind-first-switch"
      className={cn(
        "flex cursor-pointer items-start justify-between gap-4 rounded-zone border border-line bg-surf-panel px-4 py-3.5",
        className,
      )}
      {...props}
    >
      <span className="grid gap-0.5">
        <b id={`${id}-name`} className="text-body-sm font-semibold text-fg">
          Blind first
        </b>
        <small id={`${id}-sub`} className="text-body-sm text-fg-dim">
          {checked
            ? "Each expert's new objects stay hidden from colleagues until that expert marks the slide checked."
            : "Experts see each other's work from the start. Turn this on to keep first opinions independent."}
        </small>
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-sub`}
        className="mt-0.5"
      />
    </label>
  );
}

type RunState = "running" | "cancelled" | "done";

type RunProgressProps = React.ComponentProps<"div"> & {
  state: RunState;
  tilesDone: number;
  tilesTotal: number;
  objects: number;
  estimate?: string;
  onCancel?: () => void;
};

function RunProgress({
  state,
  tilesDone,
  tilesTotal,
  objects,
  estimate,
  onCancel,
  className,
  ...props
}: RunProgressProps) {
  const heading =
    state === "running"
      ? "Running on the whole slide"
      : state === "cancelled"
        ? "Run cancelled, finished tiles kept"
        : "Run finished";
  return (
    <div
      data-slot="run-progress"
      data-state={state}
      className={cn(
        "grid w-92 gap-2.5 rounded-zone border border-line-strong bg-surf-panel p-3.5 shadow-[0_8px_24px_rgb(0_0_0/0.35)]",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <b className="text-body-sm font-semibold text-fg">{heading}</b>
        {state === "running" && onCancel ? (
          <Button size="sm" onClick={onCancel}>
            Cancel run
          </Button>
        ) : null}
      </div>
      <ProgressBar
        label={`${tilesDone} of ${tilesTotal} tiles finished`}
        valueText={`${objects.toLocaleString("en-US")} objects`}
        value={tilesDone}
        max={tilesTotal}
        tone={state === "running" ? "tiles" : state === "done" ? "ok" : "warn"}
      />
      <small className="text-caption text-fg-dim">
        {state === "running"
          ? `About ${estimate ?? "a few minutes"} left. Objects appear as each tile finishes.`
          : state === "cancelled"
            ? "The objects of finished tiles are in the layer and join the check scope."
            : "All objects are in the layer and join the check scope."}
      </small>
    </div>
  );
}

type RunTilesProps = React.ComponentProps<"g"> & {
  columns: number;
  rows: number;
  width: number;
  height: number;
  finished: ReadonlySet<number>;
  runningTile?: number | undefined;
};

function RunTiles({
  columns,
  rows,
  width,
  height,
  finished,
  runningTile,
  ...props
}: RunTilesProps) {
  const tileWidth = width / columns;
  const tileHeight = height / rows;
  const tiles = Array.from({ length: columns * rows }, (_, index) => index);
  return (
    <g data-slot="run-tiles" {...props}>
      {tiles.map((index) => {
        const done = finished.has(index);
        const active = index === runningTile;
        return (
          <rect
            key={index}
            data-tile={index}
            data-state={done ? "finished" : active ? "running" : "waiting"}
            x={(index % columns) * tileWidth}
            y={Math.floor(index / columns) * tileHeight}
            width={tileWidth}
            height={tileHeight}
            fill={done ? "rgb(52 211 153 / 0.10)" : active ? "rgb(255 255 255 / 0.12)" : "none"}
            stroke={done ? "rgb(52 211 153 / 0.7)" : "rgb(255 255 255 / 0.28)"}
            strokeWidth={done ? 3 : 2}
            strokeDasharray={done ? undefined : "10 8"}
          />
        );
      })}
    </g>
  );
}

type ChangesByMarkerProps = Omit<React.ComponentProps<"button">, "children"> & {
  people: PersonInfo[];
  count: number;
};

function ChangesByMarker({ people, count, className, ...props }: ChangesByMarkerProps) {
  const names = people.map((person) => person.name).join(" and ");
  return (
    <button
      type="button"
      data-slot="changes-by-marker"
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-2 rounded-full border border-line-strong bg-surf-panel pr-3 pl-1.5 text-body-sm font-medium text-fg shadow-[0_4px_14px_rgb(0_0_0/0.35)] outline-none hover:bg-chrome-3 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent",
        className,
      )}
      {...props}
    >
      <span className="inline-flex -space-x-1.5">
        {people.map((person) => (
          <PersonAvatar key={person.name} person={person} size={18} />
        ))}
      </span>
      {count === 1 ? "1 change" : `${count} changes`} by {names}
      <span className="text-accent">Show</span>
    </button>
  );
}

function ChangedDot({ className, ...props }: React.ComponentProps<"i">) {
  return (
    <i
      data-slot="changed-dot"
      aria-hidden="true"
      className={cn(
        "inline-block size-2 rounded-full bg-accent-fill ring-2 ring-white/80",
        className,
      )}
      {...props}
    />
  );
}

export {
  AiResultToggle,
  type AiResultToggleProps,
  annotatePresets,
  BlindFirstSwitch,
  ChangedDot,
  ChangesByMarker,
  type CheckCounts,
  CheckedCard,
  CheckOptions,
  type CheckOptionValues,
  type CheckOrder,
  CheckProgress,
  type CheckScopeKind,
  type CheckState,
  CheckStateTag,
  checkedOf,
  type HistoryEntry,
  type ModelInfo,
  type Origin,
  OriginCard,
  OriginMark,
  originNames,
  type Preset,
  type PresetKey,
  PresetPicker,
  RunProgress,
  type RunState,
  RunTiles,
  SignOffCard,
  type SignOffExpert,
  type SignOffRule,
};
