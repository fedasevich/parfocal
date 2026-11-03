import { Button } from "@parfocal/ui/components/button";
import { CountsAsLine } from "@parfocal/ui/components/counts-as";
import { DatePicker } from "@parfocal/ui/components/date-picker";
import type { DecisionStyle } from "@parfocal/ui/components/decision-buttons";
import { FormField } from "@parfocal/ui/components/form-field";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { LockableRow } from "@parfocal/ui/components/lockable-row";
import { Person } from "@parfocal/ui/components/person";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { Slider } from "@parfocal/ui/components/slider";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Textarea } from "@parfocal/ui/components/textarea";
import { TokenField, type TokenItem } from "@parfocal/ui/components/token-field";
import { Zone } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import type { ReactNode } from "react";
import {
  andJoin,
  type DecisionKindKey,
  type Display,
  type Draft,
  decisionKinds,
  displaySummary,
  dueText,
  estimateText,
  hoursText,
  isRetired,
  type LockKey,
  lockKeys,
  mapping as mappingOf,
  mappingOk,
  numberList,
  perSlideOn,
  pickedSlides,
  questionKinds,
  reminderChoices,
  roiRow,
  type ScopeKind,
  type StepKey,
  scopeKinds,
  scopePhrase,
  scopeRows,
  slideLine,
  slidesInTask,
  splitText,
  stepNames,
  summary,
  type TaskData,
  type TemplateChoice,
  whoReviews,
} from "./model.ts";
import {
  CheckRow,
  FieldNote,
  fieldId,
  GroupTitle,
  RadioRows,
  RowText,
  SlideThumb,
  ToggleRow,
  Warn,
} from "./parts.tsx";

export type StepProps = {
  draft: Draft;
  data: TaskData;
  update: (change: (draft: Draft) => Draft) => void;
  errors: ReadonlyMap<string, string>;
  onTemplate: (template: TemplateChoice) => void;
  openModal: (modal: "addslides" | "dpreview") => void;
  goTo: (step: StepKey) => void;
};

export const styleOf: Record<DecisionKindKey, DecisionStyle> = {
  certainty5: "certainty",
  agree: "agree",
  yesno: "yesno",
  blind: "blind",
};

const setColours = { cam: "var(--c-tumor)", sam: "#a3e635", rev: "#38bdf8" } as const;

const rsShort = (data: TaskData, id: string) =>
  data.resultSets.find((set) => set.id === id)?.short ?? "this result set";

function TextLink({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer border-0 bg-transparent p-0 text-body-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent"
    >
      {children}
    </button>
  );
}

export function SlidesStep({ draft, data, update, errors, onTemplate, openModal }: StepProps) {
  const sum = summary(draft, data);
  const all = pickedSlides(draft, data);
  const short = rsShort(data, draft.resultSetId);
  const byId = new Map(data.slides.map((slide) => [slide.id, slide]));
  const template = data.templates.find((candidate) => candidate.id === draft.templateId);
  const leftOut = data.groups
    .filter((group) => draft.groups[group.key])
    .map((group) => ({
      group,
      count: group.slideIds.filter((id) => !byId.get(id)?.sets.includes(draft.resultSetId)).length,
    }))
    .filter((item) => item.count > 0);
  return (
    <>
      <Zone title="Study template">
        <div className="grid gap-1.5">
          <div className="flex items-center gap-4">
            <Select
              value={draft.templateId}
              onValueChange={(value) => {
                const next = data.templates.find((candidate) => candidate.id === value);
                if (next) onTemplate(next);
              }}
            >
              <SelectTrigger
                id={fieldId("tpl")}
                aria-label="Study template"
                aria-invalid={errors.get("tpl") ? true : undefined}
                className="h-9.5 w-102 font-semibold"
              >
                <SelectValue>
                  {template
                    ? `${template.name} ${template.version}${isRetired(draft, template) ? " · retired" : ""}`
                    : "Pick a template"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {data.templates.map((choice) => (
                  <SelectItem key={choice.id} value={choice.id} disabled={isRetired(draft, choice)}>
                    <span className="grid">
                      <span>
                        {choice.name} {choice.version}
                        {isRetired(draft, choice) ? " · retired" : ""}
                      </span>
                      <small className="text-caption text-fg-dim">
                        {isRetired(draft, choice) ? "Retired" : choice.kind}
                      </small>
                    </span>
                    {choice.id === data.defaultTemplateId ? (
                      <StatusTag>Project default</StatusTag>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <TextLink>Preview the report</TextLink>
          </div>
          <FieldNote
            error={errors.get("tpl")}
            help="It fills in what to check, how it runs and the display defaults. You can still change each of them."
          />
        </div>
      </Zone>
      <Zone title="Slides" sub={slideLine(sum, short)}>
        <div id={fieldId("groups")} tabIndex={-1} className="grid gap-0.5 outline-none">
          {data.groups.map((group) => (
            <CheckRow
              key={group.key}
              className="min-h-11"
              label={group.title}
              checked={Boolean(draft.groups[group.key])}
              onChange={(checked) =>
                update((current) => ({
                  ...current,
                  groups: { ...current.groups, [group.key]: checked },
                  touched: { ...current.touched, groups: true, rset: true },
                }))
              }
              end={`${group.slideIds.length} slides`}
            >
              <SlideThumb />
              <RowText title={group.title} sub={group.sub} />
            </CheckRow>
          ))}
          {draft.extraSlides.map((id) => {
            const slide = byId.get(id);
            if (!slide) return null;
            return (
              <div
                key={id}
                className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 pl-7"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <SlideThumb />
                  <RowText
                    title={slide.name}
                    sub={`${slide.caseLabel ? `Case ${slide.caseLabel}` : "Loose"} · added`}
                  />
                </span>
                <SetTags data={data} ids={slide.sets} />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${slide.name}`}
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      extraSlides: current.extraSlides.filter((other) => other !== id),
                      touched: { ...current.touched, groups: true },
                    }))
                  }
                >
                  <Icon name="close" />
                </Button>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => openModal("addslides")}>
            <Icon name="slides" />
            Add slides
          </Button>
        </div>
        <FieldNote error={errors.get("groups")} />
      </Zone>
      <Zone title="AI result to check">
        <div className="grid gap-1.5">
          <RadioRows
            id={fieldId("rset")}
            label="AI result to check"
            value={draft.resultSetId}
            onChange={(value) =>
              update((current) => ({
                ...current,
                resultSetId: value,
                name: current.nameSet ? current.name : (data.names[value] ?? current.name),
                touched: { ...current.touched, rset: true },
              }))
            }
            options={data.resultSets.map((set) => ({
              value: set.id,
              title: set.label,
              sub: set.detail,
              end: `on ${all.filter((slide) => slide.sets.includes(set.id)).length} of ${sum.all}`,
            }))}
          />
          <FieldNote error={errors.get("rset")} />
          {!sum.ns && all.length ? (
            <Warn icon="smart">
              <a href="#run-model" className="text-accent">
                Run a model
              </a>{" "}
              on the picked slides, or pick another result set.
            </Warn>
          ) : null}
          {sum.ns
            ? leftOut.map(({ group, count }) => (
                <Warn key={group.key}>
                  {count} slide{count > 1 ? "s" : ""} in {group.title} {count > 1 ? "have" : "has"}{" "}
                  no {short} and {count > 1 ? "are" : "is"} left out.{" "}
                  <a href="#run-model" className="text-accent">
                    Run a model
                  </a>{" "}
                  to include {count > 1 ? "them" : "it"}.
                </Warn>
              ))
            : null}
        </div>
      </Zone>
      <Zone title="Task name">
        <div className="grid gap-1.5">
          <Input
            id={fieldId("name")}
            aria-label="Task name"
            aria-invalid={errors.get("name") ? true : undefined}
            value={draft.name}
            maxLength={80}
            placeholder="For example, Round 3 · CAMELYON v1.0"
            onChange={(event) => {
              const name = event.target.value;
              update((current) => ({ ...current, name, nameSet: true }));
            }}
            onBlur={() =>
              update((current) => ({ ...current, touched: { ...current.touched, name: true } }))
            }
          />
          <FieldNote
            error={errors.get("name")}
            help="Reviewers see this name in My work and in the email."
            count={`${draft.name.length} of 80`}
          />
        </div>
      </Zone>
    </>
  );
}

export function SetTags({ data, ids }: { data: TaskData; ids: string[] }) {
  if (!ids.length) return <span className="text-body-sm text-fg-dim">no result sets</span>;
  return (
    <span className="flex gap-1.5">
      {ids.map((id) => {
        const set = data.resultSets.find((candidate) => candidate.id === id);
        return set ? (
          <span
            key={id}
            title={set.label}
            className="inline-flex items-center gap-1 text-caption whitespace-nowrap text-fg-dim"
          >
            <Icon name="layers" size="xs" />
            {set.short}
          </span>
        ) : null;
      })}
    </span>
  );
}

function personItems(draft: Draft, data: TaskData): TokenItem[] {
  return [
    ...data.people.map((person) => ({
      id: person.id,
      name: person.name,
      sub: person.title,
      person: { initials: person.initials, name: person.name, color: person.colour },
      end: person.awayUntil
        ? `Away until ${person.awayUntil}`
        : person.openTasks
          ? `${person.openTasks} open task${person.openTasks > 1 ? "s" : ""}`
          : "No open tasks",
      ...(person.awayUntil ? { endTone: "warn" as const } : {}),
    })),
    ...draft.invites.map((email) => ({
      id: email,
      name: email,
      sub: "invited",
      find: email,
      icon: "mail" as const,
    })),
  ];
}

export function ReviewersStep({ draft, data, update, errors }: StepProps) {
  const sum = summary(draft, data);
  const awayPerson = data.people.find(
    (person) => person.awayUntil && draft.reviewers.includes(person.id),
  );
  const ceil = Math.ceil(sum.ns / Math.max(1, sum.n));
  const short = rsShort(data, draft.resultSetId);
  const counts = sum.counts;
  const unpick = (id: string) =>
    update((current) => {
      const reviewers = current.reviewers.filter((other) => other !== id);
      const invites = current.invites.filter((other) => other !== id);
      const split =
        reviewers.length + invites.length < 2 && current.split === "even" ? "all" : current.split;
      return { ...current, reviewers, invites, split, touched: { ...current.touched, revs: true } };
    });
  return (
    <>
      <Zone
        title="Who reviews"
        end={<span className="text-body-sm text-fg-dim">{sum.n} picked</span>}
      >
        <div className="grid gap-1.5" id={fieldId("revs")}>
          <TokenField
            label="Who reviews"
            items={personItems(draft, data)}
            picked={whoReviews(draft)}
            invalid={Boolean(errors.get("revs"))}
            defaultQuery={draft.findQuery}
            defaultOpen={draft.findQuery !== ""}
            onPickedChange={(ids) => {
              const removed = whoReviews(draft).filter((id) => !ids.includes(id));
              if (removed.length) {
                for (const id of removed) unpick(id);
                return;
              }
              update((current) => ({
                ...current,
                reviewers: ids.filter((id) => !current.invites.includes(id)),
                touched: { ...current.touched, revs: true },
              }));
            }}
            onInvite={(email) =>
              update((current) => {
                const address = email.trim().toLowerCase();
                return current.invites.includes(address)
                  ? current
                  : {
                      ...current,
                      invites: [...current.invites, address],
                      touched: { ...current.touched, revs: true },
                    };
              })
            }
          />
          {errors.get("revs") ? (
            <FieldNote error={errors.get("revs")} />
          ) : awayPerson ? (
            <Warn>
              {awayPerson.name} is away until {awayPerson.awayUntil}. The task waits for them unless
              you reassign.{" "}
              <TextLink onClick={() => unpick(awayPerson.id)}>Pick someone else</TextLink>
            </Warn>
          ) : (
            <FieldNote help="Type a name, or an email to invite someone new." />
          )}
        </div>
      </Zone>
      <Zone
        title="How the work is split"
        sub={`${plural(sum.ns, "slide")} with ${short} in this task.`}
      >
        <div className="grid gap-1.5" id={fieldId("split")}>
          <RadioRows
            label="How the work is split"
            value={draft.split}
            onChange={(value) =>
              update((current) => ({ ...current, split: value as Draft["split"] }))
            }
            options={[
              {
                value: "all",
                title: "Everyone reviews all",
                sub: "Each reviewer gets every slide, which gives agreement between them.",
                end: sum.n ? `${sum.ns} each` : "",
              },
              {
                value: "even",
                title: "Split evenly",
                sub: "Faster, with no agreement numbers.",
                end: `about ${ceil} each`,
                ...(sum.n < 2 ? { disabled: "Needs two or more reviewers" } : {}),
              },
              {
                value: "per",
                title: "Choose per slide",
                sub: "For example an expert for the hard ones.",
                end:
                  sum.n && draft.split === "per" && counts.length
                    ? Math.min(...counts) === Math.max(...counts)
                      ? `${counts[0]} each`
                      : `${Math.min(...counts)} to ${Math.max(...counts)} each`
                    : "",
                under: sum.n ? <PerSlideGrid {...{ draft, data, update }} /> : null,
              },
            ]}
          />
          <FieldNote error={errors.get("split")} />
        </div>
      </Zone>
    </>
  );
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function PerSlideGrid({ draft, data, update }: Pick<StepProps, "draft" | "data" | "update">) {
  const who = whoReviews(draft);
  const slides = slidesInTask(draft, data);
  const nameOf = (id: string) => data.people.find((person) => person.id === id);
  let lastGroup = "";
  return (
    <div className="mt-1.5 mb-1 ml-6.5 max-h-85 overflow-auto rounded-lg">
      <table className="w-full border-collapse text-body-sm">
        <thead>
          <tr className="text-left text-caption text-fg-dim">
            <th className="px-2 py-1.5 font-semibold">Slide</th>
            {who.map((id) => {
              const person = nameOf(id);
              return (
                <th key={id} className="px-2 py-1.5 font-semibold">
                  {person ? (
                    <Person
                      size={20}
                      short
                      person={{
                        initials: person.initials,
                        name: person.name,
                        color: person.colour,
                      }}
                    />
                  ) : (
                    id.split("@")[0]
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {slides.flatMap((slide, index) => {
            const rows: ReactNode[] = [];
            if (slide.group !== lastGroup) {
              lastGroup = slide.group;
              const n = slides.filter((other) => other.group === slide.group).length;
              rows.push(
                <tr key={`g-${slide.group}`}>
                  <td
                    colSpan={who.length + 1}
                    className="px-2 pt-2.5 pb-1 text-caption font-semibold text-fg-dim"
                  >
                    {slide.group} · {plural(n, "slide")}
                  </td>
                </tr>,
              );
            }
            const none = !who.some((id) => perSlideOn(draft, `${index}|${id}`));
            rows.push(
              <tr key={slide.id} className={cn("border-t border-line", none && "text-warn")}>
                <td className="px-2 py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    {none ? <Icon name="warn" /> : null}
                    {slide.name}
                    {none ? <span className="ml-2 text-warn">no reviewer</span> : null}
                  </span>
                </td>
                {who.map((id) => {
                  const key = `${index}|${id}`;
                  const on = perSlideOn(draft, key);
                  return (
                    <td key={id} className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        className="size-4 accent-(--accent-fill)"
                        checked={on}
                        aria-label={`${nameOf(id)?.name ?? id} reviews ${slide.name}`}
                        onChange={() =>
                          update((current) => ({
                            ...current,
                            per: { ...current.per, [key]: !perSlideOn(current, key) },
                            touched: { ...current.touched, split: true },
                          }))
                        }
                      />
                    </td>
                  );
                })}
              </tr>,
            );
            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}

function NumberField({
  field,
  value,
  step,
  lo,
  hi,
  unit,
  label,
  decimals,
  error,
  onChange,
}: {
  field: string;
  value: number | string;
  step: number;
  lo: number;
  hi: number;
  unit: string;
  label: string;
  decimals: number;
  error?: string | undefined;
  onChange: (value: number | string) => void;
}) {
  const nudge = (direction: 1 | -1) => {
    const current = typeof value === "number" && Number.isFinite(value) ? value : lo;
    const next = Math.min(hi, Math.max(lo, Math.round((current + direction * step) / step) * step));
    onChange(Number(next.toFixed(2)));
  };
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1.5">
        <Button variant="secondary" size="icon-sm" aria-label="Less" onClick={() => nudge(-1)}>
          <Icon name="minus" />
        </Button>
        <Input
          id={fieldId(field)}
          className="w-17.5 text-center"
          inputMode={decimals ? "decimal" : "numeric"}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          value={typeof value === "number" ? value.toFixed(decimals) : value}
          onChange={(event) => {
            const text = event.target.value.trim().replace(",", ".");
            const number = Number(text);
            onChange(text !== "" && Number.isFinite(number) ? number : event.target.value);
          }}
        />
        <Button variant="secondary" size="icon-sm" aria-label="More" onClick={() => nudge(1)}>
          <Icon name="plus" />
        </Button>
        <span className="text-body-sm text-fg-dim">{unit}</span>
      </div>
      <FieldNote error={error} />
    </div>
  );
}

function ScopeControl({
  kind,
  on,
  draft,
  data,
  update,
  errors,
}: { kind: ScopeKind; on: boolean } & Pick<StepProps, "draft" | "data" | "update" | "errors">) {
  const options = draft.scopeOptions;
  const fixed = (text: string) => (
    <span className="block pt-1.5 text-body-sm leading-[1.45] text-fg-dim">{text}</span>
  );
  const setOption = (key: keyof Draft["scopeOptions"], value: unknown) =>
    update((current) => ({
      ...current,
      scopeOptions: { ...current.scopeOptions, [key]: value },
      touched: { ...current.touched, [`scopeOpts.${key}`]: true },
    }));
  if (kind === "regions") return fixed("All regions");
  if (!on) {
    const low = Number(options.low);
    return fixed(
      {
        cells: `${options.cells} per slide`,
        low: `Under ${Number.isFinite(low) ? low.toFixed(2) : options.low}`,
        roi: andJoin(options.roi) || "None picked",
        unsure: andJoin(options.unsure) || "None picked",
      }[kind],
    );
  }
  if (kind === "cells") {
    return (
      <NumberField
        field="scopeOpts.cells"
        value={options.cells}
        step={10}
        lo={10}
        hi={500}
        decimals={0}
        unit="per slide"
        label="Cells per slide"
        error={errors.get("scopeOpts.cells")}
        onChange={(value) => setOption("cells", value)}
      />
    );
  }
  if (kind === "low") {
    return (
      <NumberField
        field="scopeOpts.low"
        value={options.low}
        step={0.05}
        lo={0.1}
        hi={0.95}
        decimals={2}
        unit="or lower"
        label="Score cutoff"
        error={errors.get("scopeOpts.low")}
        onChange={(value) => setOption("low", value)}
      />
    );
  }
  const items: TokenItem[] =
    kind === "roi"
      ? data.rois.map((roi) => ({ id: roi.key, name: roi.key, sub: roi.name, find: roi.name }))
      : data.zones.map((zone) => ({
          id: zone.key,
          name: zone.key,
          sub: `${zone.cells} cells per slide on average`,
        }));
  const picked = kind === "roi" ? options.roi : options.unsure;
  const field = kind === "roi" ? "scopeOpts.roi" : "scopeOpts.unsure";
  return (
    <div className="grid gap-1.5" id={fieldId(field)}>
      <TokenField
        label={kind === "roi" ? "Regions of interest" : "Unsure zones"}
        placeholder={kind === "roi" ? "Add an ROI" : "Add a zone"}
        items={items}
        picked={picked}
        invalid={Boolean(errors.get(field))}
        onPickedChange={(ids) => setOption(kind === "roi" ? "roi" : "unsure", ids)}
      />
      <FieldNote error={errors.get(field)} />
    </div>
  );
}

function ScopeRow({
  row,
  ...props
}: { row: { key: ScopeKind; name: string; detail: string } } & Pick<
  StepProps,
  "draft" | "data" | "update" | "errors"
>) {
  const on = props.draft.scope[row.key];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-4">
      <CheckRow
        label={row.name}
        checked={on}
        onChange={(checked) =>
          props.update((current) => ({
            ...current,
            scope: { ...current.scope, [row.key]: checked },
            touched: { ...current.touched, scope: true },
          }))
        }
      >
        <RowText title={row.name} sub={row.detail} />
      </CheckRow>
      <div className="min-w-0">
        <ScopeControl kind={row.key} on={on} {...props} />
      </div>
    </div>
  );
}

export function CheckStep({ draft, data, update, errors, openModal }: StepProps) {
  const template = data.templates.find((candidate) => candidate.id === draft.templateId);
  const form = data.forms.find((candidate) => candidate.key === draft.form);
  const shared = { draft, data, update, errors };
  return (
    <>
      <Zone
        title="Objects to check"
        end={
          template ? (
            <span className="text-body-sm text-fg-dim">Filled in by {template.name}</span>
          ) : null
        }
      >
        <div className="grid gap-2" id={fieldId("scope")}>
          <GroupTitle>What to check</GroupTitle>
          {scopeRows.map((row) => (
            <ScopeRow key={row.key} row={row} {...shared} />
          ))}
          <FieldNote error={errors.get("scope")} />
        </div>
        <div className="mt-3 grid gap-2">
          <GroupTitle>Only inside</GroupTitle>
          <ScopeRow row={roiRow} {...shared} />
        </div>
        <p className="m-0 mt-1 text-body-sm leading-[1.45] text-fg-dim">
          {estimateText(draft, data)}
        </p>
      </Zone>
      <Zone
        title="Decision question"
        sub="What reviewers answer for each object. Every answer keeps its raw value, so counts can be worked out again later."
      >
        <div className="grid gap-1.5">
          <RadioRows
            label="Decision question"
            value={draft.decision.kind}
            onChange={(value) =>
              update((current) => ({
                ...current,
                decision: { kind: value as DecisionKindKey, agreeFrom: 4, disagreeTo: 2 },
              }))
            }
            options={decisionKinds.map((kind) => ({
              value: kind.key,
              title: kind.name,
              sub: kind.detail,
              under: (
                <CountsAsLine
                  id={fieldId("decision")}
                  data-counts-as-line=""
                  className="mt-0.5 mb-1.5 ml-6.25"
                  decisionStyle={styleOf[kind.key]}
                  agreeFrom={draft.decision.agreeFrom}
                  disagreeTo={draft.decision.disagreeTo}
                  onRangeChange={(range) =>
                    update((current) => ({
                      ...current,
                      decision: { ...current.decision, ...range },
                      touched: { ...current.touched, decision: true },
                    }))
                  }
                />
              ),
            }))}
          />
          <FieldNote error={errors.get("decision")} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => openModal("dpreview")}>
            <Icon name="eye" />
            Preview
          </Button>
        </div>
      </Zone>
      <Zone title="Opinion form" sub="Asked once per slide, after the objects.">
        <Select
          value={draft.form}
          onValueChange={(value) =>
            update((current) => ({
              ...current,
              form: String(value),
              required:
                String(value) === "none"
                  ? []
                  : (data.forms
                      .find((candidate) => candidate.key === value)
                      ?.questions.flatMap((question, index) =>
                        question.required ? [`q${index + 1}`] : [],
                      ) ?? []),
            }))
          }
        >
          <SelectTrigger aria-label="Opinion form" className="h-9.5 w-102">
            <SelectValue>{form ? form.name : "None"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {[...data.forms, { key: "none", name: "None", questions: [] }].map((choice) => (
              <SelectItem key={choice.key} value={choice.key}>
                <span className="grid">
                  <span>{choice.name}</span>
                  <small className="text-caption text-fg-dim">
                    {choice.questions.length
                      ? `${choice.questions.length} questions`
                      : "No questions after the objects"}
                  </small>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {form ? (
          <div className="grid">
            {form.questions.map((question, index) => {
              const key = `q${index + 1}`;
              const on = draft.required.includes(key);
              return (
                <div
                  key={key}
                  className="grid min-h-10 grid-cols-[20px_minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-line text-body-sm"
                >
                  <span className="text-fg-dim">{index + 1}</span>
                  <span className="text-fg">{question.label}</span>
                  <StatusTag>{questionKinds[question.kind] ?? question.kind}</StatusTag>
                  <ToggleRow
                    inline
                    title="Required"
                    checked={on}
                    onChange={() =>
                      update((current) => ({
                        ...current,
                        required: current.required.includes(key)
                          ? current.required.filter((other) => other !== key)
                          : [...current.required, key],
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="m-0 text-body-sm text-fg-dim">
            Reviewers submit each slide without a form, and the report leaves the opinion block out.
          </p>
        )}
      </Zone>
    </>
  );
}

const displayRows = {
  draw: {
    label: "Draw as",
    options: [
      ["outline", "Outline"],
      ["fill", "Fill"],
      ["dots", "Dots"],
    ],
  },
  width: {
    label: "Width",
    options: [
      ["1", "1"],
      ["2", "2"],
      ["3", "3"],
    ],
  },
  colorBy: {
    label: "Color by",
    options: [
      ["class", "Class"],
      ["score", "Score"],
      ["decision", "Decision"],
    ],
  },
  conf: {
    label: "Confidence",
    options: [
      ["number", "Number"],
      ["word", "Word"],
      ["color", "Color"],
      ["hidden", "Hidden"],
    ],
  },
  order: {
    label: "Order",
    options: [
      ["ai", "AI order"],
      ["size", "Largest first"],
      ["leastsure", "Least sure first"],
      ["random", "Random"],
    ],
  },
  zoom: {
    label: "Zoom around the object",
    options: [
      ["fit", "Fit"],
      ["tight", "Tight"],
      ["context", "Context"],
    ],
  },
  buttons: {
    label: "Buttons",
    options: [
      ["right", "In the card"],
      ["bottom", "Under the slide"],
    ],
  },
} as const;

type SegKey = keyof typeof displayRows;

function DisplayZone({ draft, data, update, errors }: StepProps) {
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
    { key: "rev", title: "Your review", sub: "The reviewed layer, as the reviewer edits it" },
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
          <b className="text-body font-semibold">Display defaults for reviewers</b>
          <small className="text-caption text-fg-dim">{displaySummary(draft)}</small>
        </span>
      </button>
      {draft.dispOpen ? (
        <>
          <p className="m-0 -mt-1 ml-6.5 text-body-sm leading-[1.45] text-fg-dim">
            Lock a setting to keep it the same for every reviewer. Confidence, the heatmap, the
            score cutoff, other layers and the order can be locked.
          </p>
          <div className="grid gap-3 border-t border-line pt-4">
            <GroupTitle>How objects draw</GroupTitle>
            {seg("draw")}
            {seg("width")}
            {range("opacity", "Opacity", 20, 100, 10)}
            {seg("colorBy")}
            {row(
              "ids",
              "ID labels",
              <ToggleRow
                inline
                title="Show the ID tags on the slide"
                checked={display.ids}
                onChange={(ids) => setDisplay({ ids })}
              />,
            )}
          </div>
          <div className="grid gap-3 border-t border-line pt-4">
            <GroupTitle>What the AI shows</GroupTitle>
            {seg("conf")}
            {range("heat", "Heatmap", 0, 100, 10)}
            {range("cutoff", "Score cutoff", 0, 1, 0.05)}
            {row(
              "sets",
              "Other layers",
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
            <GroupTitle>How the review moves</GroupTitle>
            {seg("order")}
            {seg("zoom")}
            {row(
              "auto",
              "Move on by itself",
              <ToggleRow
                inline
                title="The next object comes after an answer"
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

export function HowStep(props: StepProps) {
  const { draft, data, update, errors } = props;
  const claimShown =
    draft.hide && (draft.decision.kind === "certainty5" || draft.decision.kind === "agree");
  return (
    <>
      <Zone title="Blinding">
        <div className="grid gap-3.5">
          <ToggleRow
            title="Blind review"
            sub="Reviewers see each other's decisions only after they submit."
            checked={draft.blind}
            onChange={(blind) => update((current) => ({ ...current, blind }))}
          />
          <ToggleRow
            title="Hide the AI for a first read"
            sub="Reviewers mark the slide on their own first, then the AI result is shown."
            checked={draft.hide}
            onChange={(hide) => update((current) => ({ ...current, hide }))}
          />
        </div>
        {claimShown ? (
          <Warn>
            These questions show the AI's claim. With the AI hidden the first read uses Pick the
            class blind, then the claim is revealed.
          </Warn>
        ) : null}
      </Zone>
      <Zone title="Reviewers start in">
        <div className="grid gap-1.5">
          <SegmentedControl
            aria-label="Reviewers start in"
            size="lg"
            className="w-fit"
            value={draft.start}
            onValueChange={(value) =>
              update((current) => ({ ...current, start: value as Draft["start"] }))
            }
            options={[
              { value: "guided", label: "Guided review" },
              { value: "full", label: "Full viewer" },
            ]}
          />
          <FieldNote
            help={
              draft.start === "guided"
                ? "One object at a time with big buttons. They can still zoom and pan."
                : "The whole slide with every tool and the object list."
            }
          />
        </div>
      </Zone>
      <DisplayZone {...props} />
      <Zone title="When">
        <div className="grid grid-cols-2 gap-4">
          <FormField id={fieldId("due")} labelId="due-label" label="Due" error={errors.get("due")}>
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
            <span className="text-body-sm font-semibold text-fg">Reminders</span>
            <Select
              value={draft.reminders}
              onValueChange={(value) =>
                update((current) => ({ ...current, reminders: value as Draft["reminders"] }))
              }
            >
              <SelectTrigger aria-label="Reminders" className="w-full">
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
    </>
  );
}

type ReviewRow = [IconName, string, ReactNode];

export function SendStep({ draft, data, update, goTo }: StepProps) {
  const sum = summary(draft, data);
  const template = data.templates.find((candidate) => candidate.id === draft.templateId);
  const set = data.resultSets.find((candidate) => candidate.id === draft.resultSetId);
  const short = set?.short ?? "";
  const out = sum.all - sum.ns;
  const form = data.forms.find((candidate) => candidate.key === draft.form);
  const required =
    draft.form === "none"
      ? 0
      : draft.required.filter((key) => Number(key.slice(1)) <= (form?.questions.length ?? 0))
          .length;
  const kind = decisionKinds.find((candidate) => candidate.key === draft.decision.kind);
  const nameOf = (id: string) => data.people.find((person) => person.id === id)?.name ?? id;
  const people = sum.n ? (
    <span className="flex flex-wrap gap-x-4 gap-y-1.5">
      {draft.reviewers.map((id) => {
        const person = data.people.find((candidate) => candidate.id === id);
        return person ? (
          <Person
            key={id}
            size={20}
            person={{ initials: person.initials, name: person.name, color: person.colour }}
          />
        ) : null;
      })}
      {draft.invites.map((email) => (
        <span key={email} className="inline-flex items-center gap-1.5">
          <Icon name="mail" />
          {email} <small className="text-fg-dim">invited</small>
        </span>
      ))}
    </span>
  ) : null;
  const groups: [StepKey, ReviewRow[]][] = [
    [
      "slides",
      [
        ["file", "Template", template ? `${template.name} ${template.version}` : ""],
        [
          "slides",
          "Slides",
          sum.ns ? `${sum.ns} of ${sum.all} slides${out ? `, ${out} without ${short}` : ""}` : "",
        ],
        ["layers", "AI result", set?.label ?? ""],
        ["text", "Task name", draft.name.trim()],
      ],
    ],
    [
      "reviewers",
      [
        ["users", "Reviewers", people],
        ["list", "Split", splitText(sum, nameOf)],
      ],
    ],
    [
      "check",
      [
        [
          "target",
          "To check",
          scopeKinds(draft).length
            ? `${scopePhrase(draft)}${sum.ns && sum.n ? `. About ${hoursText(sum.hours)} each.` : ""}`
            : "",
        ],
        [
          "flag",
          "Decision question",
          `${kind?.name ?? ""}${draft.decision.kind === "certainty5" && mappingOk(draft.decision) ? `, ${numberList(mappingOf(draft.decision).agree)} count as agree` : ""}`,
        ],
        [
          "comment",
          "Opinion form",
          draft.form === "none" ? "None" : `${form?.name ?? ""}, ${required} required`,
        ],
      ],
    ],
    [
      "how",
      [
        [
          "eye",
          "Blinding",
          `${draft.blind ? "Blind until they submit" : "Open"}${draft.hide ? ", first read without the AI" : ""}`,
        ],
        ["monitor", "Starts in", draft.start === "guided" ? "Guided review" : "The full viewer"],
        ["sliders", "Display", displaySummary(draft)],
        ["calendar", "Due", draft.due ? dueText(draft.due) : ""],
        [
          "bell",
          "Reminders",
          reminderChoices.find((choice) => choice.key === draft.reminders)?.name ?? "",
        ],
      ],
    ],
  ];
  return (
    <>
      <Zone title="Check before you send">
        <div className="grid gap-6">
          {groups.map(([step, rows]) => (
            <div key={step} className="grid gap-2.5">
              <div className="flex items-center justify-between gap-3">
                <GroupTitle>{stepNames[step]}</GroupTitle>
                <TextLink onClick={() => goTo(step)}>Change</TextLink>
              </div>
              <dl className="m-0 grid grid-cols-[168px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-body-sm leading-[1.45]">
                {rows.map(([icon, label, value]) => (
                  <div key={label} className="contents">
                    <dt className="flex items-start gap-2 text-fg-dim">
                      <Icon name={icon} className="mt-0.5" />
                      <span>{label}</span>
                    </dt>
                    <dd className="m-0 min-w-0 [overflow-wrap:anywhere] text-fg">
                      {value || <span className="text-fg-dim">Not set</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </Zone>
      <Zone
        title="A note from you"
        end={<span className="text-body-sm text-fg-dim">optional</span>}
      >
        <div className="grid gap-1.5">
          <Textarea
            aria-label="A note from you"
            rows={3}
            maxLength={500}
            value={draft.note}
            placeholder="For example, the boundaries in A1 matter most this round."
            onChange={(event) => {
              const note = event.target.value;
              update((current) => ({ ...current, note }));
            }}
          />
          <FieldNote
            help="Added to the email the reviewers get."
            count={`${draft.note.length} of 500`}
          />
        </div>
      </Zone>
    </>
  );
}

export function SentPanel({ draft, data }: Pick<StepProps, "draft" | "data">) {
  const people = draft.reviewers.flatMap((id) => {
    const person = data.people.find((candidate) => candidate.id === id);
    return person ? [person] : [];
  });
  return (
    <section className="grid justify-items-center gap-2.5 rounded-zone border border-surf-edge bg-surf-section px-10 py-15 text-center">
      <Icon name="check" size="xl" className="text-ok" />
      <h2 className="m-0 text-page-title font-semibold">{data.code} is out</h2>
      {people.length ? (
        <>
          <p className="m-0 mb-2 max-w-130 text-body-sm text-fg-dim">
            {andJoin(people.map((person) => person.name))} {people.length > 1 ? "were" : "was"} told
            by email. {people.length > 1 ? "Each sees" : "They see"} it at the top of My work, with
            one button to start.
          </p>
          <div className="mt-2.5 flex justify-center gap-7">
            {people.map((person) => (
              <Person
                key={person.id}
                size={32}
                sub="Told just now"
                person={{ initials: person.initials, name: person.name, color: person.colour }}
              />
            ))}
          </div>
        </>
      ) : null}
      {draft.invites.length ? (
        <p className="m-0 mt-2 flex items-center gap-2 text-body-sm text-fg-dim">
          <Icon name="mail" />
          <span>
            {andJoin(draft.invites)}{" "}
            {draft.invites.length > 1 ? "were invited and get" : "was invited and gets"} the task
            when they join.
          </span>
        </p>
      ) : null}
    </section>
  );
}
