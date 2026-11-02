import {
  type CosignReview,
  useCosignClinicalReport,
  useGetClinicalReport,
  useGetCosignReview,
  useReturnCosignRequest,
} from "@parfocal/api-client";
import { Button, buttonVariants } from "@parfocal/ui/components/button";
import { CoSignColumns, type CoSignRow } from "@parfocal/ui/components/clinical-report";
import { FlowBar, FlowPage } from "@parfocal/ui/components/flow-page";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { Person } from "@parfocal/ui/components/person";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { Textarea } from "@parfocal/ui/components/textarea";
import { Zone } from "@parfocal/ui/components/zone";
import { type ReactNode, useState } from "react";
import { destinations } from "../../shell/destinations.ts";
import { SidebarToggle } from "../../shell/sidebar-toggle.tsx";
import { formatClock, formatDayMonth } from "../format.ts";
import { FieldNote } from "../new-task/parts.tsx";
import { usePeople } from "../people.ts";
import { QueryState } from "../placeholder.tsx";
import { ReasonModal, SignModal } from "./modals.tsx";
import {
  andJoin,
  type Category,
  type CosignScene,
  categoryOptions,
  depositMm,
  depositSource,
  type Extranodal,
  extranodalNames,
  fmtMm,
  formatField,
  parseNumber,
  plural,
  positiveNodes,
  type Report,
  type ReportData,
  signedAt,
  toApiValues,
  toValues,
  type Values,
} from "./model.ts";
import { fieldId, useLinkRenderer, useToast } from "./parts.tsx";
import { workEmail } from "./report-screen.tsx";
import { DonePanel } from "./steps.tsx";

type CosignScreenProps = { projectId: string; slideId: string; scene: CosignScene };

export function CosignScreen(props: CosignScreenProps) {
  const review = useGetCosignReview(props.projectId, props.slideId);
  const report = useGetClinicalReport(props.projectId, props.slideId);
  const data = report.data?.data;
  const request = review.data?.data;
  if (!data || !request) {
    return (
      <main className="p-8">
        <QueryState
          label="the co-sign request"
          isPending={review.isPending || report.isPending}
          error={review.error ?? report.error ?? true}
        >
          {null}
        </QueryState>
      </main>
    );
  }
  return <CosignFlow key={props.scene} data={data} request={request} {...props} />;
}

const readOnly = ["pn", "size", "pos"];

type Row = { field: string; label: string; icon: IconName };

function sections(data: ReportData, from: Values): [string, Row[]][] {
  return [
    ["Findings", [{ field: "specimen", label: "Specimen", icon: "file" }]],
    [
      "Deposits",
      from.deposits.map((deposit) => ({
        field: `deps.${deposit.id}`,
        label: `${deposit.id} · ${depositSource(data, deposit)}`,
        icon: "ruler" as const,
      })),
    ],
    [
      "Staging",
      [
        { field: "size", label: "Largest deposit", icon: "ruler" },
        { field: "cat", label: "Category", icon: "flag" },
        { field: "pos", label: "Nodes positive", icon: "list" },
        { field: "exam", label: "Nodes examined", icon: "list" },
        { field: "ene", label: "Extranodal extension", icon: "target" },
        { field: "pn", label: "Suggested pN", icon: "shield" },
      ],
    ],
    [
      "Report text",
      [
        { field: "diag", label: "Final diagnosis", icon: "text" },
        { field: "micro", label: "Microscopic", icon: "text" },
      ],
    ],
  ];
}

const aiValues = (request: CosignReview, from: Values) => {
  const out: Record<string, string> = {
    size: `${fmtMm(request.ai.largest_mm)} mm`,
    cat: request.ai.largest_mm > 2 ? "Macrometastasis" : "Micrometastasis",
  };
  for (const deposit of from.deposits) {
    const ai = request.ai.deposits.find(
      (candidate) => candidate.slide === deposit.slide && candidate.object_id === deposit.objectId,
    );
    if (ai) out[`deps.${deposit.id}`] = `${fmtMm(ai.size_mm)} mm`;
  }
  return out;
};

function cosignIssues(data: ReportData, values: Values) {
  const out: { field: string; text: string }[] = [];
  if (!values.specimen.trim()) out.push({ field: "specimen", text: "Name the specimen." });
  for (const deposit of values.deposits) {
    if (depositMm(deposit) === null) {
      out.push({ field: `deps.${deposit.id}`, text: "Use a size in mm from 0.1 to 100." });
    }
  }
  const positive = positiveNodes(data, values.deposits);
  const examined = parseNumber(values.examined, true);
  if (examined === null || examined < 1) out.push({ field: "exam", text: "Enter at least 1." });
  else if (positive > examined) {
    out.push({ field: "exam", text: `Fewer than the ${positive} nodes with a deposit.` });
  }
  const diagnosis = values.diagnosis.trim();
  if (!diagnosis) out.push({ field: "diag", text: "Write the final diagnosis." });
  else if (diagnosis.length < 10) out.push({ field: "diag", text: "Use at least 10 characters." });
  return out;
}

const returnedNote =
  "Measure the widest extent across the capsule, not inside the node. D1 is 8.0 mm, the largest deposit.";

function CosignFlow({
  data,
  request,
  scene,
}: CosignScreenProps & { data: ReportData; request: CosignReview }) {
  const from = toValues(data, request.values);
  const [values, setValues] = useState<Values>(() => ({
    ...from,
    deposits: from.deposits.map((deposit, index) =>
      index === 0 ? { ...deposit, size: "8.0" } : deposit,
    ),
    category: "macro",
    diagnosis:
      "Lymph nodes, sentinel, left axilla, excision: METASTATIC CARCINOMA, macrometastasis, 3 deposits, largest 8.0 mm (1/2).",
  }));
  const [returned, setReturned] = useState<{ note: string; at: string } | null>(
    scene === "returned" ? { note: returnedNote, at: "15 Oct 11:35" } : null,
  );
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<"return" | "sign" | null>(null);
  const [signed, setSigned] = useState<Report | null>(null);
  const toast = useToast();
  const renderLink = useLinkRenderer();
  const person = usePeople();
  const returnRequest = useReturnCosignRequest();
  const cosign = useCosignClinicalReport();
  const target = { projectId: data.project.id, slideId: data.slides[0]?.id ?? "" };
  const sender = person(request.from_user_id);
  const me = person(request.to_user_id);
  const senderFirst = sender?.name.split(" ")[0] ?? "The sender";
  const ai = aiValues(request, from);
  const all = sections(data, from);
  const changed = all
    .flatMap(([, rows]) => rows)
    .filter((row) => formatField(data, row.field, values) !== formatField(data, row.field, from));
  const issues = cosignIssues(data, values);
  const errors = Object.fromEntries(
    issues.filter((issue) => touched[issue.field]).map((issue) => [issue.field, issue.text]),
  );
  const can = request.co_signer_covers_case;
  const set = (patch: Partial<Values>) => setValues((current) => ({ ...current, ...patch }));
  const touch = (field: string) => setTouched((current) => ({ ...current, [field]: true }));
  const projectHref = destinations.project(data.project.id);

  const control = (field: string): ReactNode => {
    const text = formatField(data, field, values);
    if (returned || readOnly.includes(field)) {
      return (
        <span className="block pt-1">{text || <span className="text-fg-faint">None</span>}</span>
      );
    }
    const error = errors[field];
    const note = error ? <FieldNote error={error} /> : null;
    if (field.startsWith("deps.")) {
      const id = field.slice(5);
      const deposit = values.deposits.find((candidate) => candidate.id === id);
      return (
        <div className="grid gap-1">
          <span className="flex items-center gap-1.5">
            <Input
              id={fieldId(field)}
              inputMode="decimal"
              aria-label={`Size of ${id} in mm`}
              aria-invalid={error ? true : undefined}
              className="w-22 text-center font-mono"
              value={deposit?.size ?? ""}
              onChange={(event) =>
                set({
                  deposits: values.deposits.map((candidate) =>
                    candidate.id === id ? { ...candidate, size: event.target.value } : candidate,
                  ),
                })
              }
              onBlur={() => touch(field)}
            />
            <span className="text-body-sm text-fg-dim">mm</span>
          </span>
          {note}
        </div>
      );
    }
    if (field === "cat") {
      return (
        <Select value={values.category} onValueChange={(next) => set({ category: next })}>
          <SelectTrigger aria-label="Category" className="w-56">
            <SelectValue>{text || "Pick a category"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {categoryOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (field === "ene") {
      return (
        <SegmentedControl
          aria-label="Extranodal extension"
          value={values.extranodal ?? ""}
          onValueChange={(next) => set({ extranodal: next as Extranodal })}
          options={(["present", "absent", "na"] as const).map((key) => ({
            value: key,
            label: extranodalNames[key],
          }))}
        />
      );
    }
    if (field === "diag" || field === "micro") {
      const key = field === "diag" ? "diagnosis" : "microscopic";
      return (
        <div className="grid gap-1">
          <Textarea
            id={fieldId(field)}
            aria-label={field === "diag" ? "Final diagnosis" : "Microscopic"}
            aria-invalid={error ? true : undefined}
            rows={field === "diag" ? 3 : 2}
            maxLength={field === "diag" ? 600 : 2000}
            value={values[key]}
            onChange={(event) => set({ [key]: event.target.value })}
            onBlur={() => touch(field)}
          />
          {note}
        </div>
      );
    }
    const key = field === "exam" ? "examined" : "specimen";
    return (
      <div className="grid gap-1">
        <Input
          id={fieldId(field)}
          aria-label={field === "exam" ? "Nodes examined" : "Specimen"}
          aria-invalid={error ? true : undefined}
          inputMode={field === "exam" ? "numeric" : undefined}
          className={field === "exam" ? "w-18 font-mono" : undefined}
          maxLength={120}
          value={values[key]}
          onChange={(event) => set({ [key]: event.target.value })}
          onBlur={() => touch(field)}
        />
        {note}
      </div>
    );
  };

  const header = {
    authorName: <Person person={sender ?? { name: "Sender", initials: "", color: "" }} size={20} />,
    coSignerName: <Person person={me ?? { name: "You", initials: "", color: "" }} size={20} you />,
  };

  const coSignNow = () => {
    if (!can) return;
    if (issues.length) {
      setTouched((current) => ({
        ...current,
        ...Object.fromEntries(issues.map((issue) => [issue.field, true])),
      }));
      document.getElementById(fieldId(issues[0]?.field ?? ""))?.focus();
      return;
    }
    setModal("sign");
  };

  if (signed) {
    const name = (id: string | null | undefined) => person(id) ?? undefined;
    return (
      <>
        <FlowPage
          data-testid="co-sign"
          data-step="signed"
          className="h-full"
          renderLink={renderLink}
          crumbStart={<SidebarToggle />}
          crumbs={[
            { label: data.project.name, href: `${projectHref}?tab=slides` },
            { label: `Case ${request.case_label}`, href: `${projectHref}?tab=slides` },
            { label: "Clinical report" },
          ]}
          title="Clinical report"
          subtitle={
            <>
              <span className="font-mono">{request.case_label}</span> · {request.template.name}{" "}
              {request.template.version}
            </>
          }
          steps={[]}
          current={0}
          status={
            <p className="m-0 mt-1.5 flex items-center gap-2 text-body-sm text-fg">
              <Icon name="lock" className="text-fg-dim" />
              <span>Locked as version 1. A change is an amendment with a reason.</span>
            </p>
          }
          bar={
            <FlowBar
              back={renderLink({
                href: `${projectHref}?tab=slides`,
                className: buttonVariants({}),
                children: "Back to the project",
              })}
              hint="A change from now on is an amendment with a reason."
              next={
                <Button
                  variant="primary"
                  onClick={() =>
                    toast.show({ text: `${request.case_label}_report_v1.pdf saved to Downloads` })
                  }
                >
                  <Icon name="download" />
                  Download PDF
                </Button>
              }
            />
          }
        >
          <DonePanel
            data={data}
            report={signed}
            errors={{}}
            update={(change) => setSigned((current) => (current ? change(current) : current))}
            setValues={() => undefined}
            touch={() => undefined}
            goTo={() => undefined}
            person={name}
            onOpenSlide={() => undefined}
            onAddDeposit={() => undefined}
            onRemoveDeposit={() => undefined}
            onUndoRemove={() => undefined}
            onMeasure={() => undefined}
            onInsert={() => undefined}
            onFocusText={() => undefined}
          />
        </FlowPage>
        {toast.view}
      </>
    );
  }

  const hint = returned
    ? `${senderFirst} sees your changes and the note. He sends it again when it is fixed.`
    : !can
      ? "You cannot sign out in this project. Ask the owner for the right."
      : issues.length
        ? `${plural(issues.length, "value")} to fix first.`
        : changed.length
          ? `${plural(changed.length, "change")}, highlighted. ${senderFirst} sees each one.`
          : `No changes yet. Co-signing keeps ${senderFirst}'s values.`;

  const sent = new Date(request.sent_at);
  const sentText = `${formatDayMonth(sent)} ${formatClock(sent)}`;

  return (
    <>
      <FlowPage
        data-testid="co-sign"
        data-step={returned ? "returned" : "review"}
        className="h-full"
        renderLink={renderLink}
        crumbStart={<SidebarToggle />}
        crumbs={[
          { label: data.project.name, href: `${projectHref}?tab=slides` },
          { label: `Case ${request.case_label}`, href: `${projectHref}?tab=slides` },
          { label: "Co-sign" },
        ]}
        title="Co-sign the report"
        subtitle={
          <>
            <span className="font-mono">{request.case_label}</span> · {request.template.name}{" "}
            {request.template.version} · drafted by {sender?.name}
          </>
        }
        steps={[]}
        current={0}
        status={
          <p className="m-0 mt-1.5 flex items-center gap-2 text-body-sm text-fg">
            <Icon name={returned ? "back" : "users"} className="text-fg-dim" />
            <span>
              {returned
                ? `Returned to ${sender?.name}, ${returned.at}`
                : `${sender?.name} asks you to co-sign · sent ${sentText}`}
            </span>
          </p>
        }
        bar={
          <FlowBar
            back={
              returned ? undefined : (
                <Button onClick={() => setModal("return")}>Return with a note</Button>
              )
            }
            hint={<span className={!can || issues.length ? "text-fg" : undefined}>{hint}</span>}
            next={
              returned ? (
                renderLink({
                  href: destinations.myWork(),
                  className: buttonVariants({ variant: "primary" }),
                  children: "Back to My work",
                })
              ) : (
                <Button
                  variant="primary"
                  aria-disabled={!can || issues.length > 0}
                  onClick={coSignNow}
                >
                  Co-sign and sign out
                </Button>
              )
            }
          />
        }
      >
        {returned ? (
          <Zone>
            <div className="flex items-start gap-3">
              <Icon name="back" size="md" className="mt-0.5 text-fg-dim" />
              <div className="grid">
                <b className="text-body font-semibold">
                  Returned to {sender?.name}, {returned.at}
                </b>
                <small className="text-body-sm text-fg-dim">
                  With {plural(changed.length, "change")} and your note
                </small>
              </div>
            </div>
            <blockquote className="m-0 border-l-2 border-line-strong pl-3 text-body-sm text-fg">
              {returned.note}
            </blockquote>
          </Zone>
        ) : null}
        {all.map(([title, rows]) => (
          <Zone key={title} title={title}>
            <CoSignColumns
              {...header}
              rows={rows.map(
                (row): CoSignRow => ({
                  label: row.label,
                  icon: row.icon,
                  author: formatField(data, row.field, from),
                  ai: ai[row.field],
                  coSigner: control(row.field),
                  changed:
                    formatField(data, row.field, values) !== formatField(data, row.field, from),
                }),
              )}
            />
          </Zone>
        ))}
      </FlowPage>
      {modal === "return" ? (
        <ReasonModal
          title={`Return to ${sender?.name}`}
          subtitle={`${request.case_label} · ${changed.length ? `${plural(changed.length, "change")} highlighted` : "no changes"}`}
          whatLabel="What he gets back"
          what={
            changed.length
              ? `${andJoin(changed.map((row, index) => (index ? row.label.charAt(0).toLowerCase() + row.label.slice(1) : row.label)))}, changed by you`
              : "The report as he sent it"
          }
          label={`Note to ${senderFirst}`}
          placeholder="For example, measure the widest extent across the capsule."
          help={`${senderFirst} sees your changes and the note.`}
          hint="He can fix it and send it again."
          primary="Return with the note"
          empty={`Write a note. ${senderFirst} sees it with your changes.`}
          tooShort="Use at least 10 characters."
          onClose={() => setModal(null)}
          onSubmit={(note) => {
            setModal(null);
            returnRequest.mutate({ ...target, data: { note, values: toApiValues(values) } });
            setReturned({ note, at: "15 Oct 11:35" });
            toast.show({
              text: `Returned to ${sender?.name} with your note`,
              undo: () => setReturned(null),
            });
          }}
        />
      ) : null}
      {modal === "sign" ? (
        <SignModal
          title={`Co-sign and sign out ${request.case_label}`}
          subtitle={`Reported by ${sender?.name}, verified by you`}
          rows={[
            {
              icon: "user",
              label: "Signed by",
              value: `${me?.name}, MUDr. ${sender?.name} is named as the reporter`,
            },
            {
              icon: "mail",
              label: "Goes to",
              value: `${data.case.requested_by}, who requested it`,
            },
            { icon: "file", label: "What you sign", value: "The report with your changes" },
          ]}
          email={workEmail(me?.name ?? "")}
          failed={false}
          pending={cosign.isPending}
          onClose={() => setModal(null)}
          onSign={(method, done) =>
            cosign.mutate(
              { ...target, data: { method, values: toApiValues(values) } },
              {
                onSuccess: () => {
                  setModal(null);
                  setSigned({
                    values: { ...values, ack: true },
                    mode: "sign",
                    cosigner: null,
                    removed: null,
                    seen: [],
                    touched: {},
                    sent: null,
                    signed: { by: request.to_user_id, co: request.from_user_id, at: signedAt },
                    v1: values,
                    amend: null,
                    showV1: false,
                    preview: false,
                  });
                  toast.show({ text: "Co-signed and signed out. The report names you both." });
                },
                onError: () => done(false),
              },
            )
          }
        />
      ) : null}
      {toast.view}
    </>
  );
}
