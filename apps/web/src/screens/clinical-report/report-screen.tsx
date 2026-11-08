import {
  type CaseReport,
  getDownloadCaseReportPdfUrl,
  useAmendCaseReport,
  useListCases,
  useSendCaseReportForCosign,
  useSignCaseReport,
  useWithdrawCaseReport,
} from "@parfocal/api-client";
import { BeforeYouList } from "@parfocal/ui/components/before-you-list";
import { Button, buttonVariants } from "@parfocal/ui/components/button";
import { ReportDocument } from "@parfocal/ui/components/clinical-report";
import { FlowBar, FlowPage, type FlowStep } from "@parfocal/ui/components/flow-page";
import { Icon } from "@parfocal/ui/components/icon";
import { PreviewOverlay } from "@parfocal/ui/components/preview-overlay";
import { Zone } from "@parfocal/ui/components/zone";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { formatMillimetres, useLengthUnits } from "../../measure/length-units.ts";
import { useFlowOwner, useKeptFlow } from "../../session/kept-flow.ts";
import { destinations } from "../../shell/destinations.ts";
import { SidebarToggle } from "../../shell/sidebar-toggle.tsx";
import { usePeople } from "../people.ts";
import { okData, QueryState } from "../placeholder.tsx";
import {
  amendOf,
  changeBetween,
  issuesOfBlockers,
  signedOf,
  stampOf,
  valuesOfCaseReport,
} from "./case-report.ts";
import { DepositModal, ReasonModal, SignModal } from "./modals.tsx";
import {
  andJoin,
  canSign,
  documentOf,
  fieldNames,
  followDiagnosis,
  issuesOf,
  modeOf,
  nextDepositId,
  plural,
  type Report,
  type ReportData,
  type ReportModal,
  type ReportScene,
  type StepKey,
  sceneModal,
  sceneReport,
  sceneStep,
  signedAt,
  signersOf,
  slideOf,
  stepLabel,
  type Values,
} from "./model.ts";
import { fieldId, useLinkRenderer, useToast } from "./parts.tsx";
import { type LoadedReport, useCaseReportData, useReportWriter } from "./report-data.ts";
import { pushValues } from "./report-sync.ts";
import {
  DonePanel,
  FindingsStep,
  SentPanel,
  SignStep,
  StagingStep,
  type StepProps,
  TextStep,
} from "./steps.tsx";

export const workEmail = (name: string) => {
  const [first = "", ...rest] = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(" ");
  return `${first[0] ?? ""}.${rest.join(".")}@fnvltava.cz`;
};

export type ReportNavigation = { step?: StepKey | undefined; modal?: ReportModal | undefined };

type ReportScreenProps = {
  projectId: string;
  caseId: string;
  scene: ReportScene | undefined;
  step: StepKey | undefined;
  modal: ReportModal | undefined;
  onNavigate: (to: ReportNavigation) => void;
  keep?: boolean;
};

export function ReportScreen(props: ReportScreenProps) {
  useLengthUnits();
  const owner = useFlowOwner();
  const cases = useListCases(
    { project_id: props.projectId },
    { query: { enabled: props.scene === "nostaging" } },
  );
  const excision = okData(cases.data)?.[1]?.id;
  const caseId = props.scene === "nostaging" ? (excision ?? "") : props.caseId;
  const { loaded, pending, failed } = useCaseReportData(props.projectId, caseId);
  if (!loaded) {
    return (
      <main className="p-8">
        <QueryState label="the clinical report" isPending={pending} error={failed || !pending}>
          {null}
        </QueryState>
      </main>
    );
  }
  return (
    <ReportFlow
      key={`${props.scene ?? "live"}-${loaded.data.id}-${loaded.data.author_user_id}-${owner}`}
      owner={owner}
      loaded={loaded}
      {...props}
      caseId={caseId}
    />
  );
}

function ReportFlow({
  owner,
  loaded,
  projectId,
  caseId,
  scene,
  step,
  modal,
  onNavigate,
  keep = false,
}: ReportScreenProps & { loaded: LoadedReport; owner: string | undefined }) {
  const data: ReportData = loaded.data;
  const live = scene === undefined;
  const mock: ReportScene = scene ?? "findings";
  const flow = useKeptFlow({
    owner,
    id: `clinical-report:${data.id}`,
    count: data.template.steps.length,
    draft: live ? loaded.report : sceneReport(data, mock, loaded.values),
    at: step === undefined ? undefined : data.template.steps.findIndex((s) => s.key === step),
    keep,
  });
  const { draft: report, setDraft: setReport, forget } = flow;
  const [sceneModalOpen, setSceneModalOpen] = useState(
    () => !live && sceneModal[mock] !== undefined,
  );
  const [focus, setFocus] = useState<string | null>(null);
  const [lastText, setLastText] = useState<"diag" | "micro" | "comment">("micro");
  const toast = useToast();
  const renderLink = useLinkRenderer();
  const router = useRouter();
  const person = usePeople();
  const signOut = useSignCaseReport();
  const send = useSendCaseReportForCosign();
  const withdraw = useWithdrawCaseReport();
  const amend = useAmendCaseReport();
  const { writer, keep: remember } = useReportWriter(projectId, caseId);
  const savedRef = useRef<Values>(valuesOfCaseReport(loaded.server, flow.draft.values));
  const latest = useRef<Values>(report.values);
  const serverRef = useRef<CaseReport>(loaded.server);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const flush = useCallback((): Promise<CaseReport> => {
    const run = chain.current.then(async () => {
      const result = await pushValues(writer, savedRef.current, latest.current);
      savedRef.current = result.saved;
      if (result.server) {
        serverRef.current = result.server;
        const synced = result.saved.deposits;
        setReport((current) => ({
          ...current,
          values: {
            ...current.values,
            deposits: current.values.deposits.map((deposit) => {
              const match = synced.find((candidate) => candidate.id === deposit.id);
              return match?.serverId && match.serverId !== deposit.serverId
                ? { ...deposit, serverId: match.serverId }
                : deposit;
            }),
          },
        }));
      }
      return serverRef.current;
    });
    chain.current = run.catch(() => undefined);
    return run;
  }, [writer, setReport]);
  const steps = data.template.steps;
  const keptStep = keep ? steps[flow.kept?.current ?? -1]?.key : undefined;
  const wanted = step ?? keptStep ?? sceneStep[mock];
  const page: StepKey = steps.some((candidate) => candidate.key === wanted) ? wanted : "findings";
  const done = report.signed !== null;
  const sent = !done && report.sent !== null;
  const openModal = modal ?? (sceneModalOpen ? sceneModal[mock] : undefined);
  const all = issuesOf(data, report);
  const errorFor = (list: typeof all) =>
    Object.fromEntries(
      list
        .filter((issue) => report.touched[issue.field])
        .reverse()
        .map((issue) => [issue.field, issue.text]),
    );
  const projectHref = destinations.project(data.project.id);

  useEffect(() => {
    if (done || sent) forget();
  }, [done, sent, forget]);

  useEffect(() => {
    latest.current = report.values;
    if (!live || done || sent) return;
    const timer = window.setTimeout(() => {
      flush().catch(() => toast.show({ text: "The draft could not be saved. Try again." }));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [live, done, sent, report.values, flush, toast.show]);

  useEffect(
    () => () => {
      if (live) void flush().catch(() => undefined);
    },
    [live, flush],
  );

  useEffect(() => {
    if (done || sent) return;
    setReport((current) =>
      current.seen.includes(page) ? current : { ...current, seen: [...current.seen, page] },
    );
  }, [page, done, sent, setReport]);

  useEffect(() => {
    if (!focus) return;
    const element = document.getElementById(fieldId(focus));
    if (!element) return;
    element.scrollIntoView({ block: "center" });
    const control = element.matches("input, textarea, button, [tabindex]")
      ? element
      : element.querySelector<HTMLElement>(
          "input, textarea, button, [role='combobox'], [role='radio']",
        );
    control?.focus({ preventScroll: true });
    setFocus(null);
  }, [focus]);

  const update = (change: (current: Report) => Report) => setReport(change);
  const setValues = (patch: Partial<Values>) =>
    setReport((current) => ({
      ...current,
      values: followDiagnosis(data, { ...current.values, ...patch }),
    }));
  const touch = (field: string) =>
    setReport((current) => ({ ...current, touched: { ...current.touched, [field]: true } }));
  const touchAll = (fields: string[]) =>
    setReport((current) => ({
      ...current,
      touched: { ...current.touched, ...Object.fromEntries(fields.map((field) => [field, true])) },
    }));
  const goTo = (to: StepKey, field?: string, mark = false) => {
    if (field && mark) touch(field);
    if (to !== page) setReport((current) => ({ ...current, removed: null }));
    onNavigate({ step: to });
    if (field) setFocus(field);
  };
  const closeModal = () => {
    setSceneModalOpen(false);
    onNavigate({ step: page, modal: undefined });
  };

  const stepProps: StepProps = {
    data,
    report,
    errors: errorFor(issuesOf(data, report, true)),
    update,
    setValues,
    touch,
    goTo: (to, field) => goTo(to, field),
    person,
    onOpenSlide: (objectId) =>
      void router.navigate({
        href: destinations.slide(
          data.project.id,
          data.objects.find((candidate) => candidate.object_id === objectId)?.slide ??
            data.slides[0]?.id ??
            "",
          undefined,
          objectId,
        ),
      }),
    onAddDeposit: () => onNavigate({ step: page, modal: "deposit" }),
    onRemoveDeposit: (id) => {
      setReport((current) => {
        const index = current.values.deposits.findIndex((deposit) => deposit.id === id);
        const deposit = current.values.deposits[index];
        if (!deposit) return current;
        return {
          ...current,
          removed: { index, deposit },
          touched: Object.fromEntries(
            Object.entries(current.touched).filter(([field]) => !field.startsWith("deps.")),
          ),
          values: followDiagnosis(data, {
            ...current.values,
            ack: false,
            deposits: current.values.deposits.filter((candidate) => candidate.id !== id),
          }),
        };
      });
      window.setTimeout(
        () => document.querySelector<HTMLElement>("[data-removed] button")?.focus(),
        0,
      );
    },
    onUndoRemove: () => {
      const removed = report.removed;
      if (!removed) return;
      setReport((current) => {
        const deposits = [...current.values.deposits];
        deposits.splice(Math.min(removed.index, deposits.length), 0, removed.deposit);
        return {
          ...current,
          removed: null,
          values: followDiagnosis(data, { ...current.values, ack: false, deposits }),
        };
      });
      toast.show({ text: `${removed.deposit.id} is back in the list` });
    },
    onMeasure: () => {
      const pending = report.values.deposits.find(
        (deposit) => deposit.unmeasured && !deposit.size.trim(),
      );
      if (!pending) return;
      const object = data.objects.find(
        (candidate) =>
          candidate.slide === pending.slide && candidate.object_id === pending.objectId,
      );
      if (!object) return;
      setValues({
        ack: false,
        deposits: report.values.deposits.map((deposit) =>
          deposit.id === pending.id
            ? { ...deposit, size: object.size_mm.toFixed(1), unmeasured: false }
            : deposit,
        ),
      });
      toast.show({
        text: `${pending.objectId} on ${slideOf(data, pending.slide).short} measured ${formatMillimetres(object.size_mm)} with the ruler`,
      });
    },
    onInsert: (text) => {
      const key =
        lastText === "diag" ? "diagnosis" : lastText === "micro" ? "microscopic" : "comment";
      const current = report.values[key].trim();
      setValues({ [key]: current ? `${current} ${text}` : text });
      touch(lastText);
      setFocus(lastText);
      toast.show({ text: `Inserted into ${fieldNames[lastText]}` });
    },
    onFocusText: setLastText,
  };

  const next = () => {
    const own = all.filter((issue) => issue.step === page);
    if (own.length) {
      touchAll(own.map((issue) => issue.field));
      setFocus(own[0]?.field ?? null);
      return;
    }
    const index = steps.findIndex((candidate) => candidate.key === page);
    const after = steps[index + 1];
    if (after) goTo(after.key);
  };

  const mode = modeOf(data, report);
  const signNow = () => {
    const blockers = issuesOf(data, report, true);
    if (blockers.length) {
      touchAll(blockers.map((issue) => issue.field));
      return;
    }
    onNavigate({ step: page, modal: "sign" });
  };
  const complain = (error: unknown, fallback: string) =>
    toast.show({ text: error instanceof Error && error.message ? error.message : fallback });
  const blockedBy = (server: CaseReport) => {
    const issues = issuesOfBlockers(server.blockers);
    if (!issues.length) return false;
    touchAll(issues.map((issue) => issue.field));
    const first = issues[0];
    if (first) goTo(first.step, first.field);
    toast.show({ text: "Some things need finishing first." });
    return true;
  };
  const sendNow = () => {
    const blockers = issuesOf(data, report, true);
    if (blockers.length) {
      touchAll(blockers.map((issue) => issue.field));
      if (blockers.some((issue) => issue.field === "cosigner")) setFocus("cosigner");
      return;
    }
    const to = report.cosigner;
    if (!to) return;
    const sentTo = () =>
      toast.show({ text: `Sent to ${person(to)?.name ?? "the co-signer"} for co-sign` });
    if (!live) {
      setReport((current) => ({ ...current, sent: { to, at: "15 Oct 11:20", id: "" } }));
      sentTo();
      return;
    }
    flush()
      .then((server) => {
        if (blockedBy(server)) return;
        send.mutate(
          { projectId, caseId, data: { cosigner_user_id: to } },
          {
            onSuccess: (response) => {
              if (response.status !== 200) return;
              const at = remember(response).sent_at;
              setReport((current) => ({
                ...current,
                sent: { to, at: at ? stampOf(at) : "", id: "" },
              }));
              sentTo();
            },
            onError: (error) => complain(error, "The report could not be sent. Try again."),
          },
        );
      })
      .catch((error: unknown) => complain(error, "The draft could not be saved. Try again."));
  };

  let bar: ReactNode;
  const back = (label: string) =>
    renderLink({
      href: `${projectHref}?tab=slides`,
      className: buttonVariants({}),
      children: label,
    });
  if (done) {
    bar = (
      <FlowBar
        back={back("Back to the project")}
        hint={
          report.amend
            ? "Both versions stay in the case. The clinician has version 2."
            : "A change from now on is an amendment with a reason."
        }
        next={
          <span className="flex gap-3">
            <Button onClick={() => onNavigate({ step: page, modal: "amend" })}>Amend</Button>
            <Button
              variant="primary"
              onClick={() => {
                const number = live ? serverRef.current.version : report.amend ? 2 : 1;
                if (live) {
                  const link = document.createElement("a");
                  link.href = getDownloadCaseReportPdfUrl(projectId, caseId, number);
                  link.click();
                }
                toast.show({ text: `${data.case.label}_report_v${number}.pdf saved to Downloads` });
              }}
            >
              <Icon name="download" />
              Download PDF
            </Button>
          </span>
        }
      />
    );
  } else if (sent) {
    bar = (
      <FlowBar
        back={
          <Button
            aria-disabled={withdraw.isPending}
            onClick={() => {
              const was = report.sent;
              if (!was) return;
              const withdrawn = () => {
                setReport((current) => ({ ...current, sent: null }));
                toast.show({
                  text: "The request is withdrawn. The report is a draft again.",
                  ...(live
                    ? {}
                    : { undo: () => setReport((current) => ({ ...current, sent: was })) }),
                });
              };
              if (!live) {
                withdrawn();
                return;
              }
              withdraw.mutate(
                { projectId, caseId },
                {
                  onSuccess: (response) => {
                    if (response.status !== 200) return;
                    remember(response);
                    withdrawn();
                  },
                  onError: (error) =>
                    complain(error, "The request could not be withdrawn. Try again."),
                },
              );
            }}
          >
            Withdraw the request
          </Button>
        }
        hint="You are told when it is signed or returned."
        next={renderLink({
          href: live ? destinations.myWork() : `${projectHref}?tab=slides`,
          className: buttonVariants({ variant: "primary" }),
          children: live ? "Open my work" : "Back to the project",
        })}
      />
    );
  } else {
    const index = steps.findIndex((candidate) => candidate.key === page);
    const before = steps[index - 1];
    const backButton = before ? (
      <Button onClick={() => goTo(before.key)}>Back</Button>
    ) : (
      back("Cancel")
    );
    if (page !== "sign") {
      bar = (
        <FlowBar
          back={backButton}
          hint="The draft is saved as you go."
          next={
            <Button variant="primary" onClick={next}>
              Next
            </Button>
          }
        />
      );
    } else {
      const blockers = issuesOf(data, report, true);
      const signers = signersOf(data);
      const can = canSign(data);
      const me = person(data.author_user_id);
      const hint = !can
        ? `You cannot sign out in this project. ${signers.length ? `${andJoin(signers.map((member) => person(member.user_id)?.name ?? ""))} can.` : "Nobody can yet."}`
        : blockers.length
          ? `${plural(blockers.length, "thing")} to finish first.`
          : mode === "sign"
            ? `Signed by ${me?.name ?? "you"}, MUDr. The report leaves for the clinician.`
            : `${person(report.cosigner)?.name ?? "The co-signer"} gets it in My work.`;
      bar = (
        <FlowBar
          blockers={
            blockers.length ? (
              <BeforeYouList
                showSingle
                title={`Before you can ${mode === "sign" ? "sign out" : "send"}`}
                className="rounded-none border-0 bg-transparent p-0"
                blockers={blockers.map((issue) => ({
                  id: issue.field,
                  text: issue.blockText,
                  goTo:
                    issue.step !== page
                      ? `Go to ${stepLabel(data, issue.step)}`
                      : issue.field === "cosigner"
                        ? "Pick who co-signs"
                        : "Show me",
                  onGoTo: () => goTo(issue.step, issue.field, true),
                }))}
              />
            ) : null
          }
          back={backButton}
          hint={<span className={blockers.length ? "text-fg" : undefined}>{hint}</span>}
          next={
            mode === "sign" ? (
              <span className="flex gap-3">
                <Button onClick={() => update((current) => ({ ...current, mode: "cosign" }))}>
                  Send for co-sign instead
                </Button>
                <Button variant="primary" aria-disabled={blockers.length > 0} onClick={signNow}>
                  Sign out
                </Button>
              </span>
            ) : (
              <span className="flex gap-3">
                {can ? (
                  <Button onClick={() => update((current) => ({ ...current, mode: "sign" }))}>
                    Sign out myself
                  </Button>
                ) : null}
                <Button
                  variant="primary"
                  aria-disabled={blockers.length > 0 || send.isPending}
                  onClick={sendNow}
                >
                  <Icon name="mail" />
                  Send for co-sign
                </Button>
              </span>
            )
          }
        />
      );
    }
  }

  const stepStates: FlowStep[] = steps.map((candidate) => {
    const count = all.filter((issue) => issue.step === candidate.key).length;
    const seen = report.seen.includes(candidate.key);
    const state = candidate.key === page ? "current" : !seen ? "todo" : count ? "warn" : "done";
    return {
      label: candidate.label,
      state,
      why:
        state === "todo"
          ? `Not reached yet. Finish ${stepLabel(data, page)} first, then use Next.`
          : `Go to ${candidate.label}${count ? `. ${plural(count, "thing")} to fix` : ""}`,
    };
  });

  const status = done ? (
    <p className="m-0 mt-1.5 flex items-center gap-2 text-body-sm text-fg">
      <Icon name="lock" className="text-fg-dim" />
      <span>Locked as version {report.amend ? 2 : 1}. A change is an amendment with a reason.</span>
    </p>
  ) : sent ? (
    <p className="m-0 mt-1.5 flex items-center gap-2 text-body-sm text-fg">
      <Icon name="clock" className="text-fg-dim" />
      <span>
        Sent to {person(report.sent?.to)?.name}
        {report.sent?.at ? `, ${report.sent.at}` : ""} · waiting
      </span>
    </p>
  ) : undefined;

  const assigned = andJoin(data.case.assigned_user_ids.map((id) => person(id)?.name ?? ""));
  const nameOf = (userId: string) => person(userId)?.name ?? "";

  return (
    <>
      <FlowPage
        data-testid="clinical-report"
        data-step={done ? "signed" : sent ? "sent" : page}
        className="h-full"
        renderLink={renderLink}
        crumbStart={<SidebarToggle />}
        crumbs={[
          { label: data.project.name, href: `${projectHref}?tab=slides` },
          { label: `Case ${data.case.label}`, href: `${projectHref}?tab=slides` },
          { label: "Clinical report" },
        ]}
        title="Clinical report"
        subtitle={
          <>
            <span className="font-mono">{data.case.label}</span> · {data.template.name}{" "}
            {data.template.version}
            {assigned ? ` · assigned to ${assigned}` : ""}
          </>
        }
        steps={stepStates}
        current={Math.max(
          0,
          steps.findIndex((candidate) => candidate.key === page),
        )}
        reached={flow.reached}
        onStepSelect={(chosen) => {
          const key = steps[chosen]?.key;
          if (key && report.seen.includes(key)) goTo(key);
        }}
        status={status}
        bar={bar}
      >
        {done ? <DonePanel {...stepProps} /> : null}
        {sent ? <SentPanel {...stepProps} /> : null}
        {!done && !sent && live && loaded.server.state === "returned" ? (
          <ReturnedNote server={loaded.server} name={nameOf} />
        ) : null}
        {!done && !sent && page === "findings" ? <FindingsStep {...stepProps} /> : null}
        {!done && !sent && page === "staging" ? <StagingStep {...stepProps} /> : null}
        {!done && !sent && page === "text" ? <TextStep {...stepProps} /> : null}
        {!done && !sent && page === "sign" ? <SignStep {...stepProps} /> : null}
      </FlowPage>
      {report.preview && !done ? (
        <PreviewOverlay
          label="Preview of the report"
          title={`${data.case.label}_draft.pdf`}
          meta="A4 · draft, from what you typed"
          closeLabel="Close the preview"
          onClose={() => update((current) => ({ ...current, preview: false }))}
        >
          <ReportDocument model={documentOf(data, report, "draft", nameOf)} />
        </PreviewOverlay>
      ) : null}
      {openModal === "deposit" && !done && !sent ? (
        <DepositModal
          data={data}
          caseLabel={data.case.label}
          deposits={report.values.deposits}
          hand={mock === "dephand" && sceneModalOpen}
          onClose={closeModal}
          onAdd={(deposit) => {
            const id = nextDepositId(report);
            const before = report.values.deposits;
            const added = [...before, { ...deposit, id }];
            setReport((current) => ({
              ...current,
              removed: null,
              values: followDiagnosis(data, { ...current.values, ack: false, deposits: added }),
            }));
            closeModal();
            const sizes = (list: typeof added) =>
              list.reduce<{ id: string; mm: number } | null>((best, item) => {
                const mm = Number(item.size);
                return best === null || mm > best.mm ? { id: item.id, mm } : best;
              }, null);
            const was = sizes(before);
            const now = sizes(added);
            toast.show({
              text:
                now?.id === id && was?.id !== id
                  ? `${id} added. It is the largest now and sets the category.`
                  : `${id} added. ${now ? `${now.id} is still the largest.` : ""}`,
            });
          }}
        />
      ) : null}
      {openModal === "sign" && !done && !sent ? (
        <SignModal
          title={`Sign out ${data.case.label}`}
          subtitle={`${data.template.name} ${data.template.version} · version 1`}
          rows={[
            {
              icon: "user",
              label: "Signed by",
              value: `${person(data.author_user_id)?.name ?? ""}, MUDr.`,
            },
            {
              icon: "mail",
              label: "Goes to",
              value: data.case.requested_by
                ? `${data.case.requested_by}, who requested it`
                : "The clinician who requested it",
            },
            { icon: "file", label: "What you sign", value: "The report as it reads now" },
          ]}
          email={workEmail(person(data.author_user_id)?.name ?? "")}
          failed={mock === "ssofail" && sceneModalOpen}
          pending={signOut.isPending}
          onClose={closeModal}
          onSign={(method, doneWith) => {
            const finish = (server: CaseReport | null) => {
              setReport((current) => ({
                ...current,
                signed: server
                  ? signedOf(server, data.author_user_id)
                  : { by: data.author_user_id, co: null, at: signedAt },
                v1: current.values,
                preview: false,
              }));
              closeModal();
              toast.show({
                text: `${data.case.label} is signed out. It goes to the clinician.`,
              });
            };
            if (!live) {
              finish(null);
              return;
            }
            flush()
              .then((server) => {
                if (blockedBy(server)) {
                  closeModal();
                  return;
                }
                signOut.mutate(
                  { projectId, caseId, data: { confirmed_with: method } },
                  {
                    onSuccess: (response) => {
                      if (response.status !== 200) return doneWith(false);
                      finish(remember(response));
                    },
                    onError: () => doneWith(false),
                  },
                );
              })
              .catch(() => doneWith(false));
          }}
        />
      ) : null}
      {openModal === "amend" && done ? (
        <ReasonModal
          title="Amend the report"
          subtitle={`${data.case.label} · signed out ${(report.signed?.at ?? "").replace(/^(\d+ \w+) /, "$1 2026, ")}`}
          whatLabel="What changes"
          what="Version 2 of the report, with your reason on top"
          told={
            report.signed?.co
              ? `The clinician and ${nameOf(report.signed.co)}, the co-signer`
              : "The clinician"
          }
          label="Reason"
          placeholder="For example, measured again on deeper levels of A1"
          help="The reason goes into the report."
          hint="v1 stays readable."
          primary="Amend and sign again"
          tooShort="Give a reason of at least 10 characters."
          tried={mock === "amend" && sceneModalOpen}
          onClose={closeModal}
          onSubmit={(why) => {
            const was = report.amend;
            const finish = (server: CaseReport | null) => {
              setReport((current) => ({
                ...current,
                amend: (server ? amendOf(server) : null) ?? { why, at: "16 Oct" },
                showV1: false,
              }));
              closeModal();
              toast.show({
                text: "Amended and signed again. Version 1 stays readable.",
                ...(live
                  ? {}
                  : { undo: () => setReport((current) => ({ ...current, amend: was })) }),
              });
            };
            if (!live) {
              finish(null);
              return;
            }
            amend.mutate(
              {
                projectId,
                caseId,
                data: { reason: why, change: changeBetween(savedRef.current, report.values) },
              },
              {
                onSuccess: (response) => {
                  if (response.status === 200) finish(remember(response));
                },
                onError: (error) => complain(error, "The amendment could not be saved."),
              },
            );
          }}
        />
      ) : null}
      {toast.view}
    </>
  );
}

const changeNames: Record<string, string> = {
  specimen: "specimen",
  category: "category",
  nodes_examined: "nodes examined",
  extranodal: "extranodal extension",
  diagnosis: "final diagnosis",
  microscopic: "microscopic",
  comment: "comment",
  deposits: "deposits",
};

function ReturnedNote({ server, name }: { server: CaseReport; name: (id: string) => string }) {
  const from = server.cosigner_user_id ? name(server.cosigner_user_id) : "The co-signer";
  const changes = server.changes.map((key) => changeNames[key] ?? key);
  return (
    <Zone
      title={`Returned by ${from}`}
      sub={
        changes.length
          ? `Changed by ${from.split(" ")[0]}: ${andJoin(changes)}. Fix it and send it again.`
          : "No values changed. Fix it and send it again."
      }
    >
      <blockquote className="m-0 border-l-2 border-line-strong pl-3 text-body-sm text-fg">
        {server.return_note}
      </blockquote>
    </Zone>
  );
}
