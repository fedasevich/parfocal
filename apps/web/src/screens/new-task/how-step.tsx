import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { BlindFirstSwitch } from "@parfocal/ui/components/annotate-task";
import { DatePicker } from "@parfocal/ui/components/date-picker";
import { FormField } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { LockableRow } from "@parfocal/ui/components/lockable-row";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { Slider } from "@parfocal/ui/components/slider";
import { Zone } from "@parfocal/ui/components/zone";
import { lazyText } from "@parfocal/ui/lib/lazy-text";
import type { ReactNode } from "react";
import {
  type Display,
  type Draft,
  displaySummary,
  isAnnotate,
  type LockKey,
  lockKeys,
  reminderChoices,
} from "./model.ts";
import { FieldNote, fieldId, GroupTitle, ToggleRow, Warn } from "./parts.tsx";
import { type StepProps, setColours } from "./steps.tsx";

const displayRows = lazyText(
  () =>
    ({
      draw: {
        label: t`Draw as`,
        options: [
          ["outline", t`Outline`],
          ["fill", t`Fill`],
          ["dots", t`Dots`],
        ],
      },
      width: {
        label: t`Width`,
        options: [
          ["1", "1"],
          ["2", "2"],
          ["3", "3"],
        ],
      },
      colorBy: {
        label: t`Color by`,
        options: [
          ["class", t`Class`],
          ["score", t`Score`],
          ["decision", t`Decision`],
        ],
      },
      conf: {
        label: t`Confidence`,
        options: [
          ["number", t`Number`],
          ["word", t`Word`],
          ["color", t`Color`],
          ["hidden", t`Hidden`],
        ],
      },
      order: {
        label: t`Order`,
        options: [
          ["ai", "AI order"],
          ["size", t`Largest first`],
          ["leastsure", t`Least sure first`],
          ["random", t`Random`],
        ],
      },
      zoom: {
        label: t`Zoom around the object`,
        options: [
          ["fit", "Fit"],
          ["tight", t`Tight`],
          ["context", t`Context`],
        ],
      },
      buttons: {
        label: t`Buttons`,
        options: [
          ["right", t`In the card`],
          ["bottom", t`Under the slide`],
        ],
      },
    }) as const,
);

type SegKey = keyof typeof displayRows;

function DisplayZone({ draft, data, update, errors }: StepProps) {
  const { t } = useLingui();

  const display = draft.display;
  const setDisplay = (change: Partial<Display>) =>
    update((current) => ({ ...current, display: { ...current.display, ...change } }));
  const row = (key: string, label: string, control: ReactNode) => {
    const lockable = (lockKeys as readonly string[]).includes(key);
    const lockKey = key as LockKey;
    return (
      <LockableRow
        key={key}
        label={label}
        lockable={lockable}
        locked={draft.locks[lockKey] !== undefined}
        reason={draft.locks[lockKey] ?? ""}
        id={fieldId(`locks.${key}`)}
        reasonError={errors.get(`locks.${key}`)}
        onLockedChange={(locked) =>
          update((current) => {
            const locks = { ...current.locks };
            if (locked) locks[lockKey] = "";
            else delete locks[lockKey];
            return { ...current, locks };
          })
        }
        onReasonChange={(reason) =>
          update((current) => ({
            ...current,
            locks: { ...current.locks, [lockKey]: reason },
            touched: { ...current.touched, [`locks.${key}`]: true },
          }))
        }
      >
        {control}
      </LockableRow>
    );
  };
  const seg = (key: SegKey) =>
    row(
      key,
      displayRows[key].label,
      <SegmentedControl
        aria-label={displayRows[key].label}
        value={String(display[key])}
        onValueChange={(value) =>
          setDisplay({
            [key]: key === "width" ? Number(value) : String(value),
          })
        }
        options={displayRows[key].options.map(([value, label]) => ({ value, label }))}
      />,
    );
  const range = (
    key: "opacity" | "heat" | "cutoff",
    label: string,
    lo: number,
    hi: number,
    step: number,
  ) => {
    const value = display[key];
    const text =
      key === "heat"
        ? value
          ? `${value}%`
          : "Off"
        : key === "cutoff"
          ? value.toFixed(2)
          : `${value}%`;
    return row(
      key,
      label,
      <div className="grid min-h-8 grid-cols-[240px_auto] items-center gap-3">
        <Slider
          min={lo}
          max={hi}
          step={step}
          value={[value]}
          getAriaLabel={() => label}
          onValueChange={(next) => {
            const number = Number(Array.isArray(next) ? next[0] : next);
            setDisplay({
              [key]: key === "heat" && number > 0 && number < 20 ? 20 : number,
            });
          }}
        />
        <span className="min-w-10 font-mono text-body-sm text-fg">{text}</span>
      </div>,
    );
  };
  const others = data.resultSets.filter((set) => set.id !== draft.resultSetId);
  const sets: { key: "cam" | "sam" | "rev"; title: string; sub: string }[] = [
    ...others.map((set) => ({
      key: set.key,
      title: set.label,
      sub: set.detail.replace(/^Imported/, "imported").replace(/^Run here/, "run here"),
    })),
    { key: "rev", title: t`Your review`, sub: t`The reviewed layer, as the reviewer edits it` },
  ];
  return (
    <section className="grid gap-4 rounded-zone border border-surf-edge bg-surf-section p-(--pad-zone)">
      <button
        type="button"
        id={fieldId("disp")}
        aria-expanded={draft.dispOpen}
        onClick={() => update((current) => ({ ...current, dispOpen: !current.dispOpen }))}
        className="flex cursor-pointer items-start gap-2.5 rounded-md border-0 bg-transparent p-0 text-left text-fg"
      >
        <Icon name={draft.dispOpen ? "down" : "next"} className="mt-0.5 text-fg-dim" />
        <span className="grid gap-0.5">
          <b className="text-body font-semibold">
            <Trans>Display defaults for reviewers</Trans>
          </b>
          <small className="text-caption text-fg-dim">{displaySummary(draft)}</small>
        </span>
      </button>
      {draft.dispOpen ? (
        <>
          <p className="m-0 -mt-1 ml-6.5 text-body-sm leading-[1.45] text-fg-dim">
            <Trans>
              Lock a setting to keep it the same for every reviewer. Confidence, the heatmap, the
              score cutoff, other layers and the order can be locked.
            </Trans>
          </p>
          <div className="grid gap-3 border-t border-line pt-4">
            <GroupTitle>
              <Trans>How objects draw</Trans>
            </GroupTitle>
            {seg("draw")}
            {seg("width")}
            {range("opacity", t`Opacity`, 20, 100, 10)}
            {seg("colorBy")}
            {row(
              "ids",
              "ID labels",
              <ToggleRow
                inline
                title={t`Show the ID tags on the slide`}
                checked={display.ids}
                onChange={(ids) => setDisplay({ ids })}
              />,
            )}
          </div>
          <div className="grid gap-3 border-t border-line pt-4">
            <GroupTitle>
              <Trans>What the AI shows</Trans>
            </GroupTitle>
            {seg("conf")}
            {range("heat", t`Heatmap`, 0, 100, 10)}
            {range("cutoff", t`Score cutoff`, 0, 1, 0.05)}
            {row(
              "sets",
              t`Other layers`,
              <div className="grid w-full max-w-110 gap-2.5">
                {sets.map((set) => (
                  <div key={set.key} className="flex items-start gap-2.5">
                    <i
                      aria-hidden="true"
                      className="mt-0.75 size-3 shrink-0 rounded-[3px]"
                      style={{ background: setColours[set.key] }}
                    />
                    <span className="flex-1">
                      <ToggleRow
                        title={set.title}
                        sub={set.sub}
                        checked={display.sets[set.key]}
                        onChange={(checked) =>
                          setDisplay({ sets: { ...display.sets, [set.key]: checked } })
                        }
                      />
                    </span>
                  </div>
                ))}
              </div>,
            )}
          </div>
          <div className="grid gap-3 border-t border-line pt-4">
            <GroupTitle>
              <Trans>How the review moves</Trans>
            </GroupTitle>
            {seg("order")}
            {seg("zoom")}
            {row(
              "auto",
              t`Move on by itself`,
              <ToggleRow
                inline
                title={t`The next object comes after an answer`}
                checked={display.auto}
                onChange={(auto) => setDisplay({ auto })}
              />,
            )}
            {seg("buttons")}
          </div>
        </>
      ) : null}
    </section>
  );
}

function WhenZone({ draft, data, update, errors }: StepProps) {
  const { t } = useLingui();

  return (
    <Zone title={t`When`}>
      <div className="grid grid-cols-2 gap-4">
        <FormField id={fieldId("due")} labelId="due-label" label={t`Due`} error={errors.get("due")}>
          <DatePicker
            aria-labelledby="due-label"
            value={draft.due}
            today={data.today}
            invalid={errors.has("due")}
            onValueChange={(due) => {
              update((current) => ({
                ...current,
                due,
                touched: { ...current.touched, due: true },
              }));
            }}
          />
        </FormField>
        <div className="grid content-start gap-1.5">
          <span className="text-body-sm font-semibold text-fg">
            <Trans>Reminders</Trans>
          </span>
          <Select
            value={draft.reminders}
            onValueChange={(value) =>
              update((current) => ({ ...current, reminders: value as Draft["reminders"] }))
            }
          >
            <SelectTrigger aria-label={t`Reminders`} className="w-full">
              <SelectValue>
                {reminderChoices.find((choice) => choice.key === draft.reminders)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {reminderChoices.map((choice) => (
                <SelectItem key={choice.key} value={choice.key}>
                  {choice.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </Zone>
  );
}

function AnnotateHowStep(props: StepProps) {
  const { t } = useLingui();

  const { draft, update } = props;
  return (
    <>
      <Zone title={t`How it runs`}>
        <BlindFirstSwitch
          checked={draft.blindFirst}
          onCheckedChange={(blindFirst) => update((current) => ({ ...current, blindFirst }))}
        />
      </Zone>
      <WhenZone {...props} />
    </>
  );
}

export function HowStep(props: StepProps) {
  return isAnnotate(props.draft) ? <AnnotateHowStep {...props} /> : <ReviewHowStep {...props} />;
}

function ReviewHowStep(props: StepProps) {
  const { t } = useLingui();

  const { draft, update } = props;
  const claimShown =
    draft.hide && (draft.decision.kind === "certainty5" || draft.decision.kind === "agree");
  return (
    <>
      <Zone title={t`Blinding`}>
        <div className="grid gap-3.5">
          <ToggleRow
            title={t`Blind review`}
            sub={t`Reviewers see each other's decisions only after they submit.`}
            checked={draft.blind}
            onChange={(blind) => update((current) => ({ ...current, blind }))}
          />
          <ToggleRow
            title={t`Hide the AI for a first read`}
            sub={t`Reviewers mark the slide on their own first, then the AI result is shown.`}
            checked={draft.hide}
            onChange={(hide) => update((current) => ({ ...current, hide }))}
          />
        </div>
        {claimShown ? (
          <Warn>
            <Trans>
              These questions show the AI's claim. With the AI hidden the first read uses Pick the
              class blind, then the claim is revealed.
            </Trans>
          </Warn>
        ) : null}
      </Zone>
      <Zone title={t`Reviewers start in`}>
        <div className="grid gap-1.5">
          <SegmentedControl
            aria-label={t`Reviewers start in`}
            size="lg"
            className="w-fit"
            value={draft.start}
            onValueChange={(value) =>
              update((current) => ({ ...current, start: value as Draft["start"] }))
            }
            options={[
              { value: "guided", label: t`Guided review` },
              { value: "full", label: t`Full viewer` },
            ]}
          />
          <FieldNote
            help={
              draft.start === "guided"
                ? t`One object at a time with big buttons. They can still zoom and pan.`
                : t`The whole slide with every tool and the object list.`
            }
          />
        </div>
      </Zone>
      <DisplayZone {...props} />
      <WhenZone {...props} />
    </>
  );
}
