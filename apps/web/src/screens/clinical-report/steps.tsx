import { Button } from "@parfocal/ui/components/button";
import {
  type Deposit,
  DepositTable,
  ReportDocument,
} from "@parfocal/ui/components/clinical-report";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { Person, type PersonInfo } from "@parfocal/ui/components/person";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Textarea } from "@parfocal/ui/components/textarea";
import { TokenField } from "@parfocal/ui/components/token-field";
import { Zone } from "@parfocal/ui/components/zone";
import type { ReactNode } from "react";
import { CheckRow, FieldNote, RadioRows } from "../new-task/parts.tsx";
import {
  type Category,
  categoryNames,
  categoryOf,
  categoryOptions,
  chipsOf,
  depositMm,
  depositShort,
  documentOf,
  type Extranodal,
  extranodalNames,
  factsOf,
  fieldNames,
  hasStep,
  largestIndex,
  largestMm,
  meOf,
  mmText,
  modeOf,
  parseNumber,
  positiveNodes,
  type Report,
  type ReportData,
  rightNames,
  type StepKey,
  slideOf,
  suggestedPn,
  type Values,
} from "./model.ts";
import { fieldId, KvList, linkButton, NotSet } from "./parts.tsx";

export type StepProps = {
  data: ReportData;
  report: Report;
  errors: Record<string, string>;
  update: (change: (current: Report) => Report) => void;
  setValues: (patch: Partial<Values>) => void;
  touch: (field: string) => void;
  goTo: (step: StepKey, field?: string) => void;
  person: (userId: string | null | undefined) => PersonInfo | undefined;
  onOpenSlide: (objectId: string) => void;
  onAddDeposit: () => void;
  onRemoveDeposit: (id: string) => void;
  onUndoRemove: () => void;
  onMeasure: () => void;
  onInsert: (text: string) => void;
  onFocusText: (field: "diag" | "micro" | "comment") => void;
};

function OpenOnSlide({ objectId, onOpen }: { objectId: string; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      className={`${linkButton} whitespace-nowrap`}
      onClick={() => onOpen(objectId)}
    >
      Open on the slide
    </button>
  );
}

export function FindingsStep({
  data,
  report,
  errors,
  setValues,
  touch,
  onOpenSlide,
  onMeasure,
}: StepProps) {
  const facts = factsOf(data, report.values);
  const pending = report.values.deposits.find(
    (deposit) => deposit.unmeasured && !deposit.size.trim(),
  );
  return (
    <>
      <Zone
        title={`From your decisions on ${data.slide}`}
        sub="Filled in from what you decided on the slide. To change a fact, change the decision there."
      >
        <KvList
          rows={facts.map((fact) => ({
            icon: fact.icon,
            label: fact.label,
            value: (
              <span className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4">
                {fact.warn ? (
                  <span className="inline-flex items-center gap-1.5 text-warn">
                    <Icon name="warn" />
                    <span data-phi="">{fact.text}</span>
                  </span>
                ) : (
                  <span data-phi="">{fact.text}</span>
                )}
                {fact.warn && pending ? (
                  <button type="button" className={linkButton} onClick={onMeasure}>
                    Measure on {slideOf(data, pending.slide).short}
                  </button>
                ) : fact.link ? (
                  <OpenOnSlide objectId={fact.link} onOpen={onOpenSlide} />
                ) : null}
              </span>
            ),
          }))}
        />
      </Zone>
      <Zone title="Specimen">
        <div className="grid gap-1.5">
          <Input
            id={fieldId("specimen")}
            aria-label="Specimen"
            aria-invalid={errors["specimen"] ? true : undefined}
            maxLength={120}
            value={report.values.specimen}
            onChange={(event) => setValues({ specimen: event.target.value })}
            onBlur={() => touch("specimen")}
          />
          <FieldNote
            error={errors["specimen"]}
            help="From the case. It heads the report."
            count={`${report.values.specimen.length} / 120`}
          />
        </div>
      </Zone>
    </>
  );
}

function CategoryField({ data, report, errors, setValues, update }: StepProps) {
  const values = report.values;
  const size = largestMm(values.deposits);
  const suggested = size === null ? null : categoryOf(size);
  const big = values.deposits[largestIndex(values.deposits)];
  const from = big && size !== null ? `${big.id}, the largest deposit at ${mmText(size)}` : "";
  const help = suggested
    ? values.category
      ? `Suggested from ${from}: ${categoryNames[suggested].toLowerCase()}.`
      : `Suggested from ${from}. Pick a category to confirm it.`
    : "Enter a deposit size to get a suggestion.";
  const against = suggested !== null && values.category !== null && values.category !== suggested;
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5" id={fieldId("cat")}>
        <RadioRows
          label="Category"
          value={values.category ?? ""}
          onChange={(next) => setValues({ category: next as Category, ack: false })}
          options={categoryOptions.map((option) => ({
            ...option,
            end:
              option.value === suggested && values.category !== option.value ? (
                <StatusTag tone="accent">suggested</StatusTag>
              ) : undefined,
          }))}
        />
        {against && suggested !== null && size !== null ? (
          <p className="m-0 flex items-start gap-1.5 text-body-sm leading-[1.45] text-warn">
            <Icon name="warn" className="mt-0.5" />
            <span>
              A deposit of {mmText(size)} is a {categoryNames[suggested].toLowerCase()}. Confirm the
              size or pick {categoryNames[suggested]}.
            </span>
          </p>
        ) : (
          <FieldNote error={errors["cat"]} help={help} />
        )}
      </div>
      {against ? (
        <div className="ml-6.25 grid gap-1.5" id={fieldId("ack")}>
          <CheckRow
            checked={values.ack}
            label="I confirm this category"
            onChange={(checked) =>
              update((current) => ({
                ...current,
                values: { ...current.values, ack: checked },
                touched: { ...current.touched, ack: true },
              }))
            }
          >
            <span className="grid">
              <b className="font-semibold text-fg">I confirm this category</b>
              <small className="text-caption text-fg-dim">
                For example when the deposit is measured on another level
              </small>
            </span>
          </CheckRow>
          <FieldNote error={errors["ack"]} />
        </div>
      ) : null}
    </div>
  );
}

export function StagingStep(props: StepProps) {
  const {
    data,
    report,
    errors,
    setValues,
    touch,
    onAddDeposit,
    onRemoveDeposit,
    onUndoRemove,
    onMeasure,
  } = props;
  const values = report.values;
  const rows: Deposit[] = values.deposits.map((deposit) => {
    const slide = slideOf(data, deposit.slide);
    const mm = depositMm(deposit);
    return {
      id: deposit.id,
      slide: slide.label,
      node: slide.node,
      objectId: deposit.objectId ?? undefined,
      hand: deposit.objectId === null,
      size: deposit.size,
      sizeMm: mm ?? undefined,
      note: deposit.note,
    };
  });
  const removed = report.removed;
  if (removed) {
    rows.splice(Math.min(removed.index, rows.length), 0, {
      id: removed.deposit.id,
      slide: slideOf(data, removed.deposit.slide).label,
      node: slideOf(data, removed.deposit.slide).node,
      objectId: removed.deposit.objectId ?? undefined,
      hand: removed.deposit.objectId === null,
      size: removed.deposit.size,
      sizeMm: undefined,
      note: removed.deposit.note,
      removed: true,
      removedText: depositShort(data, removed.deposit),
    });
  }
  const depositErrors = Object.fromEntries(
    values.deposits.flatMap((deposit) => {
      const error = errors[`deps.${deposit.id}`];
      return error ? [[deposit.id, error]] : [];
    }),
  );
  const sizeHelp = Object.fromEntries(
    values.deposits
      .filter((deposit) => deposit.unmeasured && !deposit.size.trim())
      .map((deposit) => [
        deposit.id,
        <button key={deposit.id} type="button" className={linkButton} onClick={onMeasure}>
          Measure on {slideOf(data, deposit.slide).short}
        </button>,
      ]),
  );
  const changeDeposit = (id: string, patch: { size?: string; note?: string }) =>
    setValues({
      deposits: values.deposits.map((deposit) =>
        deposit.id === id ? { ...deposit, ...patch } : deposit,
      ),
      ...(patch.size === undefined ? {} : { ack: false }),
    });
  const positive = positiveNodes(data, values.deposits);
  const pn = suggestedPn(data, values);
  return (
    <>
      <Zone
        title="Deposits"
        sub="Every deposit on the case's slides. Sizes come from your measurements and can be changed here."
        end={
          <Button size="sm" id={fieldId("deps")} onClick={onAddDeposit}>
            <Icon name="plus" />
            Add a deposit
          </Button>
        }
      >
        <DepositTable
          deposits={rows}
          showSuggestion={false}
          inputId={(id) => fieldId(`deps.${id}`)}
          errors={depositErrors}
          sizeHelp={sizeHelp}
          onSizeChange={(id, size) => changeDeposit(id, { size })}
          onSizeBlur={(id) => touch(`deps.${id}`)}
          onNoteChange={(id, note) => changeDeposit(id, { note })}
          onRemove={onRemoveDeposit}
          onUndo={onUndoRemove}
        />
        <FieldNote error={errors["deps"]} />
      </Zone>
      <Zone
        title="Category"
        sub="The largest deposit sets the suggested category. A category against it needs your confirmation."
      >
        <CategoryField {...props} />
      </Zone>
      <Zone
        title="Nodes"
        sub="Positive counts the nodes with at least one deposit. Examined comes from the gross description."
      >
        <div className="grid grid-cols-2 items-start gap-4">
          <div className="grid gap-1.5">
            <span className="text-body-sm font-semibold">Positive</span>
            <span className="grid text-body-sm">
              <b className="font-mono">{positive}</b>
              <span className="text-fg-dim">
                {positive === 1 ? "node has" : "nodes have"} a deposit
              </span>
            </span>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={fieldId("exam")} className="text-body-sm font-semibold">
              Examined
            </label>
            <Input
              id={fieldId("exam")}
              inputMode="numeric"
              className="w-24 font-mono"
              aria-invalid={errors["exam"] ? true : undefined}
              value={values.examined}
              onChange={(event) => setValues({ examined: event.target.value })}
              onBlur={() => touch("exam")}
            />
            <FieldNote error={errors["exam"]} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <span id={fieldId("ene-label")} className="text-body-sm font-semibold">
            Extranodal extension
          </span>
          <SegmentedControl
            id={fieldId("ene")}
            aria-labelledby={fieldId("ene-label")}
            value={values.extranodal ?? ""}
            onValueChange={(next) => setValues({ extranodal: next as Extranodal })}
            options={(["present", "absent", "na"] as const).map((key) => ({
              value: key,
              label: extranodalNames[key],
            }))}
          />
          <FieldNote error={errors["ene"]} />
        </div>
      </Zone>
      <Zone title="Stage">
        <div className="grid gap-1.5">
          <span className="text-body-sm font-semibold">Suggested pN</span>
          {pn ? (
            <span className="grid text-body-sm">
              <b className="font-mono">{pn}</b>
              <span className="text-fg-dim">
                From the category and the positive nodes, UICC and AJCC TNM 8
              </span>
            </span>
          ) : (
            <NotSet>Follows from the category</NotSet>
          )}
        </div>
      </Zone>
    </>
  );
}

function TextField({
  field,
  rows,
  max,
  placeholder,
  value,
  error,
  help,
  onChange,
  onBlur,
  onFocus,
}: {
  field: "diag" | "micro" | "comment";
  rows: number;
  max: number;
  placeholder?: string;
  value: string;
  error?: string | undefined;
  help?: ReactNode;
  onChange: (value: string) => void;
  onBlur: () => void;
  onFocus: () => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Textarea
        id={fieldId(field)}
        aria-label={fieldNames[field]}
        aria-invalid={error ? true : undefined}
        rows={rows}
        maxLength={max}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onFocus={onFocus}
      />
      <FieldNote error={error} help={help} count={`${value.length} / ${max}`} />
    </div>
  );
}

export function TextStep({
  data,
  report,
  errors,
  setValues,
  touch,
  onInsert,
  onFocusText,
  update,
}: StepProps) {
  const values = report.values;
  const staging = hasStep(data, "staging");
  const optional = <span className="text-caption text-fg-dim">optional</span>;
  return (
    <>
      <Zone title="Final diagnosis">
        <TextField
          field="diag"
          rows={3}
          max={600}
          value={values.diagnosis}
          error={errors["diag"]}
          help="It opens the report. Capitals as the lab writes them."
          onChange={(diagnosis) => setValues({ diagnosis })}
          onBlur={() => touch("diag")}
          onFocus={() => onFocusText("diag")}
        />
      </Zone>
      <Zone title="Microscopic" end={optional}>
        <TextField
          field="micro"
          rows={4}
          max={2000}
          placeholder="What the sections show"
          value={values.microscopic}
          onChange={(microscopic) => setValues({ microscopic })}
          onBlur={() => touch("micro")}
          onFocus={() => onFocusText("micro")}
        />
      </Zone>
      <Zone title="Comment" end={optional}>
        <TextField
          field="comment"
          rows={3}
          max={1000}
          placeholder={
            staging
              ? "For example, the pN is final once the breast resection is reported."
              : "Anything the clinician should know"
          }
          value={values.comment}
          onChange={(comment) => setValues({ comment })}
          onBlur={() => touch("comment")}
          onFocus={() => onFocusText("comment")}
        />
      </Zone>
      <Zone
        title="From the slide"
        sub="Inserts the value with its source where you were last typing."
      >
        <div className="flex flex-wrap gap-2">
          {chipsOf(data, values).map((chip) => (
            <button
              key={chip.label}
              type="button"
              title="Insert into the field you were last in"
              onClick={() => onInsert(chip.text)}
              className="inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-full border border-line-strong bg-surf-field px-3 text-body-sm text-fg hover:border-accent"
            >
              <Icon name={chip.icon} />
              <span>{chip.label}</span>
              <span className="text-fg-dim">{chip.source}</span>
            </button>
          ))}
        </div>
      </Zone>
      <Zone
        title="Report template"
        end={
          <Button size="sm" onClick={() => update((current) => ({ ...current, preview: true }))}>
            <Icon name="eye" />
            Preview the page
          </Button>
        }
      >
        <p className="m-0 text-body-sm">
          <b>
            {data.template.name} {data.template.version}
          </b>
          , set by the project
        </p>
        {staging ? (
          <KvList
            rows={data.template.standards.map(([name, text]) => ({
              icon: "file",
              label: name,
              value: text,
            }))}
          />
        ) : (
          <p className="m-0 flex items-center gap-2 text-body-sm text-fg-dim">
            <Icon name="file" />
            Free text. This specimen has no synoptic protocol and no staging step.
          </p>
        )}
      </Zone>
    </>
  );
}

function summaryRows(data: ReportData, values: Values, key: StepKey) {
  const text = (value: string, none: ReactNode = <NotSet />) =>
    value.trim() ? value.trim() : none;
  if (key === "findings")
    return [{ icon: "file" as const, label: "Specimen", value: text(values.specimen) }];
  if (key === "staging") {
    const big = largestIndex(values.deposits);
    const size = largestMm(values.deposits);
    const examined = parseNumber(values.examined, true);
    const pn = suggestedPn(data, values);
    return [
      {
        icon: "ruler" as const,
        label: "Deposits",
        value: values.deposits.length ? (
          <span className="grid">
            {values.deposits.map((deposit, index) => (
              <span key={deposit.id}>
                <b className="font-mono">{deposit.id}</b> {depositShort(data, deposit)}
                {index === big ? (
                  <span className="ml-1.5 text-fg-dim">largest, sets the category</span>
                ) : null}
              </span>
            ))}
          </span>
        ) : (
          <NotSet />
        ),
      },
      {
        icon: "flag" as const,
        label: "Category",
        value: values.category ? (
          `${categoryNames[values.category]}${size !== null && values.category !== categoryOf(size) ? ", kept against the size" : ""}`
        ) : (
          <NotSet />
        ),
      },
      {
        icon: "list" as const,
        label: "Nodes",
        value:
          examined !== null ? (
            `${positiveNodes(data, values.deposits)} positive of ${examined} examined`
          ) : (
            <NotSet />
          ),
      },
      {
        icon: "target" as const,
        label: "Extranodal extension",
        value: values.extranodal ? extranodalNames[values.extranodal] : <NotSet />,
      },
      {
        icon: "shield" as const,
        label: "Suggested pN",
        value: pn ? <span className="font-mono">{pn}</span> : <NotSet />,
      },
    ];
  }
  return [
    { icon: "text" as const, label: "Final diagnosis", value: text(values.diagnosis) },
    {
      icon: "text" as const,
      label: "Microscopic",
      value: text(values.microscopic, <NotSet>None</NotSet>),
    },
    {
      icon: "comment" as const,
      label: "Comment",
      value: text(values.comment, <NotSet>None</NotSet>),
    },
  ];
}

export function ReviewList({
  data,
  values,
  onChange,
}: {
  data: ReportData;
  values: Values;
  onChange?: (step: StepKey) => void;
}) {
  return (
    <div className="grid gap-5">
      {data.template.steps
        .filter((step) => step.key !== "sign")
        .map((step) => (
          <div key={step.key} className="grid gap-2.5">
            <div className="flex items-center justify-between">
              <h4 className="m-0 text-caption font-semibold text-fg-dim">{step.label}</h4>
              {onChange ? (
                <button
                  type="button"
                  aria-label={`Change ${step.label}`}
                  className={linkButton}
                  onClick={() => onChange(step.key)}
                >
                  Change
                </button>
              ) : null}
            </div>
            <KvList rows={summaryRows(data, values, step.key)} />
          </div>
        ))}
    </div>
  );
}

export function SignStep({ data, report, errors, update, goTo, person }: StepProps) {
  const me = meOf(data);
  const mode = modeOf(data, report);
  const items = data.members
    .filter((member) => member.user_id !== data.author_user_id && member.sign_out !== "never")
    .map((member) => {
      const info = person(member.user_id);
      return {
        id: member.user_id,
        name: info?.name ?? member.user_id,
        ...(info ? { person: info } : {}),
        sub: member.covers_case ? "Can sign out" : "Can sign out own cases",
        ...(member.covers_case ? {} : { dim: "Not on this case" }),
      };
    });
  return (
    <>
      <Zone title="Check before you sign">
        <ReviewList data={data} values={report.values} onChange={(step) => goTo(step)} />
      </Zone>
      {mode === "sign" ? (
        <Zone
          title="Sign out"
          sub="Signing locks this version. A change after it is an amendment with a reason, and the signed version stays readable."
        >
          <Person
            person={person(data.author_user_id) ?? { name: "You", initials: "", color: "" }}
            size={32}
            sub={`${rightNames[me?.sign_out ?? "never"]} · assigned to this case`}
          />
        </Zone>
      ) : (
        <Zone
          title="Send for co-sign"
          sub={`${me?.covers_case ? "You send the report to a colleague instead of signing it yourself. " : ""}The co-signer can sign it as it is, change values first or return it with a note.`}
        >
          <div className="grid gap-1.5">
            <span id={fieldId("cosigner-label")} className="text-body-sm font-semibold">
              Who co-signs
            </span>
            <TokenField
              id={fieldId("cosigner")}
              aria-labelledby={fieldId("cosigner-label")}
              label="Who co-signs"
              single
              placeholder="Type a name"
              items={items}
              picked={report.cosigner ? [report.cosigner] : []}
              invalid={Boolean(errors["cosigner"])}
              onPickedChange={(ids) =>
                update((current) => ({
                  ...current,
                  cosigner: ids[0] ?? null,
                  touched: { ...current.touched, cosigner: true },
                }))
              }
            />
            <FieldNote
              error={errors["cosigner"]}
              help="Only members who can sign out this case can be picked."
            />
          </div>
        </Zone>
      )}
    </>
  );
}

export function SentPanel({ data, report, person }: StepProps) {
  const to = report.sent?.to ?? null;
  const info = person(to);
  const member = data.members.find((candidate) => candidate.user_id === to);
  return (
    <>
      <Zone
        title="Sent for co-sign"
        sub={`The report stays as you wrote it while it waits. ${info?.name.split(" ")[0] ?? "The co-signer"} can co-sign it as it is, change values and co-sign, or return it with a note.`}
      >
        <div className="flex items-center gap-3">
          <Person
            person={info ?? { name: "Co-signer", initials: "", color: "" }}
            size={32}
            sub={`${rightNames[member?.sign_out ?? "own"]} · sent ${report.sent?.at ?? ""}`}
          />
          <StatusTag tone="warn">Waiting</StatusTag>
        </div>
      </Zone>
      <Zone title="What you sent">
        <ReviewList data={data} values={report.values} />
      </Zone>
    </>
  );
}

export function DonePanel({ data, report, person, update }: StepProps) {
  const signature = report.signed;
  if (!signature) return null;
  const showV1 = report.showV1 && Boolean(report.amend);
  const name = (userId: string) => person(userId)?.name ?? "";
  const who = signature.co
    ? `Reported by ${name(signature.co)}, verified and signed by ${name(signature.by)}`
    : `Signed out ${signature.at} by ${name(signature.by)}`;
  const why = report.amend ? report.amend.why.replace(/\.$/, "") : "";
  return (
    <>
      <Zone>
        <div className="flex items-start gap-3">
          <Icon name="check" size="md" className="mt-0.5 text-ok" />
          <div className="grid">
            <b className="text-body font-semibold">{who}</b>
            <small className="text-body-sm text-fg-dim">
              {signature.co ? `${signature.at} · ` : ""}
              {data.template.name} {data.template.version} ·{" "}
              {showV1 ? "version 1, as first signed" : report.amend ? "version 2" : "version 1"}
            </small>
          </div>
        </div>
        {report.amend ? (
          <div className="flex items-start gap-2 text-body-sm leading-[1.45]">
            <Icon name="info" className="mt-0.5 text-fg-dim" />
            <span className="flex-1">
              Amended {report.amend.at}, reason: {why.charAt(0).toLowerCase() + why.slice(1)}. v1
              stays readable.
            </span>
            <button
              type="button"
              className={linkButton}
              onClick={() => update((current) => ({ ...current, showV1: !current.showV1 }))}
            >
              {showV1 ? "Back to v2" : "Open v1"}
            </button>
          </div>
        ) : null}
      </Zone>
      <ReportDocument
        data-version={showV1 ? "v1" : "current"}
        model={documentOf(data, report, showV1 ? "v1" : "current", name)}
      />
    </>
  );
}
