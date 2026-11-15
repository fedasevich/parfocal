import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { Person } from "@parfocal/ui/components/person";
import { TokenField, type TokenItem } from "@parfocal/ui/components/token-field";
import { Zone } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import type { ReactNode } from "react";
import {
  andJoin,
  type Draft,
  isAnnotate,
  perSlideOn,
  type ScopeKind,
  slidesInTask,
  summary,
  type TaskData,
  whoReviews,
} from "./model.ts";
import { CheckRow, FieldNote, fieldId, RadioRows, RowText, Warn } from "./parts.tsx";
import { rsShort, type StepProps, TextLink } from "./steps.tsx";

function personItems(draft: Draft, data: TaskData): TokenItem[] {
  return [
    ...data.people.map((person) => ({
      id: person.id,
      name: person.name,
      sub: person.title,
      person: { initials: person.initials, name: person.name, color: person.colour },
      end: person.awayUntil
        ? t`Away until ${person.awayUntil}`
        : person.openTasks
          ? t`${person.openTasks} open task${person.openTasks > 1 ? "s" : ""}`
          : t`No open tasks`,
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
  const { t } = useLingui();

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
        title={isAnnotate(draft) ? t`Who annotates` : t`Who reviews`}
        end={
          <span className="text-body-sm text-fg-dim">
            <Trans>{sum.n} picked</Trans>
          </span>
        }
      >
        <div className="grid gap-1.5" id={fieldId("revs")}>
          <TokenField
            label={isAnnotate(draft) ? t`Who annotates` : t`Who reviews`}
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
              <Trans>
                {awayPerson.name} is away until {awayPerson.awayUntil}. The task waits for them
                unless you reassign.{" "}
              </Trans>
              <TextLink onClick={() => unpick(awayPerson.id)}>
                <Trans>Pick someone else</Trans>
              </TextLink>
            </Warn>
          ) : (
            <FieldNote help={t`Type a name, or an email to invite someone new.`} />
          )}
        </div>
      </Zone>
      <Zone
        title={t`How the work is split`}
        sub={
          isAnnotate(draft)
            ? t`${plural(sum.ns, "slide")} in this task.`
            : t`${plural(sum.ns, "slide")} with ${short} in this task.`
        }
      >
        <div className="grid gap-1.5" id={fieldId("split")}>
          <RadioRows
            label={t`How the work is split`}
            value={draft.split}
            onChange={(value) =>
              update((current) => ({ ...current, split: value as Draft["split"] }))
            }
            options={[
              {
                value: "all",
                title: t`Everyone reviews all`,
                sub: t`Each reviewer gets every slide, which gives agreement between them.`,
                end: sum.n ? `${sum.ns} each` : "",
              },
              {
                value: "even",
                title: t`Split evenly`,
                sub: t`Faster, with no agreement numbers.`,
                end: t`about ${ceil} each`,
                ...(sum.n < 2 ? { disabled: t`Needs two or more reviewers` } : {}),
              },
              {
                value: "per",
                title: t`Choose per slide`,
                sub: t`For example an expert for the hard ones.`,
                end:
                  sum.n && draft.split === "per" && counts.length
                    ? Math.min(...counts) === Math.max(...counts)
                      ? `${counts[0]} each`
                      : t`${Math.min(...counts)} to ${Math.max(...counts)} each`
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
  const { t } = useLingui();

  const who = whoReviews(draft);
  const slides = slidesInTask(draft, data);
  const nameOf = (id: string) => data.people.find((person) => person.id === id);
  let lastGroup = "";
  return (
    <div className="mt-1.5 mb-1 ml-6.5 max-h-85 overflow-auto rounded-lg">
      <table className="w-full border-collapse text-body-sm">
        <thead>
          <tr className="text-left text-caption text-fg-dim">
            <th className="px-2 py-1.5 font-semibold">
              <Trans>Slide</Trans>
            </th>
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
                    {none ? (
                      <span className="ml-2 text-warn">
                        <Trans>no reviewer</Trans>
                      </span>
                    ) : null}
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
                        aria-label={t`${nameOf(id)?.name ?? id} reviews ${slide.name}`}
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
  const { t } = useLingui();

  const nudge = (direction: 1 | -1) => {
    const current = typeof value === "number" && Number.isFinite(value) ? value : lo;
    const next = Math.min(hi, Math.max(lo, Math.round((current + direction * step) / step) * step));
    onChange(Number(next.toFixed(2)));
  };
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1.5">
        <Button variant="secondary" size="icon-sm" aria-label={t`Less`} onClick={() => nudge(-1)}>
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
        <Button variant="secondary" size="icon-sm" aria-label={t`More`} onClick={() => nudge(1)}>
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
  const { t } = useLingui();

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
  if (kind === "regions") return fixed(t`All regions`);
  if (!on) {
    const low = Number(options.low);
    return fixed(
      {
        cells: t`${options.cells} per slide`,
        low: `Under ${Number.isFinite(low) ? low.toFixed(2) : options.low}`,
        roi: andJoin(options.roi) || t`None picked`,
        unsure: andJoin(options.unsure) || t`None picked`,
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
        label={t`Cells per slide`}
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
        label={t`Score cutoff`}
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
          sub: t`${zone.cells} cells per slide on average`,
        }));
  const picked = kind === "roi" ? options.roi : options.unsure;
  const field = kind === "roi" ? "scopeOpts.roi" : "scopeOpts.unsure";
  return (
    <div className="grid gap-1.5" id={fieldId(field)}>
      <TokenField
        label={kind === "roi" ? t`Regions of interest` : t`Unsure zones`}
        placeholder={kind === "roi" ? t`Add an ROI` : t`Add a zone`}
        items={items}
        picked={picked}
        invalid={Boolean(errors.get(field))}
        onPickedChange={(ids) => setOption(kind === "roi" ? "roi" : "unsure", ids)}
      />
      <FieldNote error={errors.get(field)} />
    </div>
  );
}

export function ScopeRow({
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
