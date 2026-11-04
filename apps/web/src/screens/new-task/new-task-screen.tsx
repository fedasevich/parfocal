import { type TaskDraft, useCreateReviewTask, useInviteTaskReviewer } from "@parfocal/api-client";
import type { LinkRenderer } from "@parfocal/ui/components/app-shell";
import { BeforeYouList } from "@parfocal/ui/components/before-you-list";
import { Button, buttonVariants } from "@parfocal/ui/components/button";
import { FlowBar, FlowPage, type FlowStep } from "@parfocal/ui/components/flow-page";
import { Icon } from "@parfocal/ui/components/icon";
import { Toast } from "@parfocal/ui/components/undo-toast";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { useFlowOwner, useKeptFlow } from "../../session/kept-flow.ts";
import { SidebarToggle } from "../../shell/sidebar-toggle.tsx";
import { QueryState } from "../placeholder.tsx";
import { decisionSettings } from "../review/decision-style.ts";
import { AddSlidesModal, PreviewQuestionModal } from "./modals.tsx";
import {
  applyTemplate,
  blockersFor,
  type Draft,
  fieldErrors,
  issues,
  type PageKey,
  perSlideOn,
  plural,
  reminderChoices,
  type StepKey,
  sceneDraft,
  sceneStep,
  scopeKinds,
  sendLabel,
  slidesInTask,
  stepKeys,
  stepNames,
  stepState,
  type TaskData,
  type TaskScene,
  touchStep,
  whoReviews,
} from "./model.ts";
import { fieldId } from "./parts.tsx";
import {
  CheckStep,
  HowStep,
  ReviewersStep,
  SendStep,
  SentPanel,
  SlidesStep,
  styleOf,
} from "./steps.tsx";
import { useTaskData } from "./use-task-data.ts";

export type TaskModal = "addslides" | "dpreview";

export type NewTaskNavigation = { step?: PageKey | undefined; modal?: TaskModal | undefined };

type NewTaskScreenProps = {
  projectId: string;
  scene: TaskScene;
  step: PageKey | undefined;
  modal: TaskModal | undefined;
  onNavigate: (to: NewTaskNavigation) => void;
  keep?: boolean;
};

const reveal: Partial<Record<TaskScene, string>> = {
  decision: "decision",
  locks: "locks.conf",
  noresult: "rset",
  pastdue: "due",
};

function useLinkRenderer(): LinkRenderer {
  const router = useRouter();
  return ({ href, children, ...props }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        void router.navigate({ href });
      }}
    >
      {children}
    </a>
  );
}

export function NewTaskScreen(props: NewTaskScreenProps) {
  const owner = useFlowOwner();
  const { data, pending, failed } = useTaskData(props.projectId);
  if (!data) {
    return (
      <main className="p-8">
        <QueryState label="the new review task" isPending={pending} error={failed || !pending}>
          {null}
        </QueryState>
      </main>
    );
  }
  return <NewTaskFlow key={`${props.scene}|${owner}`} owner={owner} data={data} {...props} />;
}

const scopeOf = (draft: Draft): TaskDraft["scope"] => {
  const kind = scopeKinds(draft)[0];
  if (kind === "cells") return { kind: "random-cells", count: Number(draft.scopeOptions.cells) };
  if (kind === "low") return { kind: "cells-below-score", score: Number(draft.scopeOptions.low) };
  if (kind === "unsure") return { kind: "unsure-zones" };
  if (draft.scope.roi) return { kind: "inside-rois" };
  return { kind: "all-regions" };
};

function toTaskDraft(draft: Draft, data: TaskData): TaskDraft {
  const slides = slidesInTask(draft, data);
  const template = data.templates.find((candidate) => candidate.id === draft.templateId);
  return {
    name: draft.name.trim(),
    reviewer_ids: draft.reviewers,
    split: draft.split === "all" ? "everyone" : draft.split === "even" ? "even" : "chosen",
    ...(draft.split === "per"
      ? {
          pairs: slides.flatMap((slide, index) =>
            whoReviews(draft)
              .filter((id) => draft.reviewers.includes(id) && perSlideOn(draft, `${index}|${id}`))
              .map((user_id) => ({ slide_id: slide.id, user_id })),
          ),
        }
      : {}),
    result_sets: slides.map((slide) => ({ slide_id: slide.id, result_set_id: draft.resultSetId })),
    scope: scopeOf(draft),
    blinded: draft.blind,
    ai_hidden_first_read: draft.hide,
    start_mode: draft.start === "guided" ? "guided" : "viewer",
    due_on: draft.due,
    reminder_days: reminderChoices.find((choice) => choice.key === draft.reminders)?.days ?? [],
    study_template_id: draft.templateId,
    study_template_version: template ? Number(template.version.slice(1)) : null,
    decision: decisionSettings(styleOf[draft.decision.kind], draft.decision),
  };
}

function NewTaskFlow({
  owner,
  data,
  scene,
  step,
  modal,
  onNavigate,
  keep = false,
}: NewTaskScreenProps & { data: TaskData; owner: string | undefined }) {
  const flow = useKeptFlow({
    owner,
    id: `new-task:${data.projectId}`,
    count: stepKeys.length,
    draft: sceneDraft(data, scene),
    at: step === undefined || step === "sent" ? undefined : stepKeys.indexOf(step),
    keep,
  });
  const { draft, setDraft, forget } = flow;
  const [focus, setFocus] = useState<{ field: string; move: boolean } | null>(() => {
    const field = reveal[scene];
    return field ? { field, move: false } : null;
  });
  const [toast, setToast] = useState<string | null>(null);
  const [sentTaskId, setSentTaskId] = useState<string | null>(null);
  const create = useCreateReviewTask();
  const invite = useInviteTaskReviewer();
  const renderLink = useLinkRenderer();
  const kept = keep ? stepKeys[flow.kept?.current ?? -1] : undefined;
  const page: PageKey = step ?? kept ?? sceneStep[scene];
  const all = issues(draft, data);
  const errors = fieldErrors(draft, data);

  useEffect(() => {
    if (page === "sent") forget();
  }, [page, forget]);

  useEffect(() => {
    if (page === "sent") return;
    setDraft((current) =>
      current.seen.includes(page) ? current : { ...current, seen: [...current.seen, page] },
    );
  }, [page, setDraft]);

  useEffect(() => {
    if (!focus) return;
    const element = document.getElementById(fieldId(focus.field));
    if (!element) return;
    element.scrollIntoView({ block: "center" });
    if (focus.move) {
      const target = element.matches("input, textarea, button, [tabindex]")
        ? element
        : element.querySelector<HTMLElement>("input, textarea, button, [role='combobox']");
      target?.focus({ preventScroll: true });
    }
    setFocus(null);
  }, [focus]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const go = (to: PageKey, field?: string) => {
    if (field) {
      setDraft((current) => ({ ...current, touched: { ...current.touched, [field]: true } }));
      setFocus({ field, move: true });
    }
    onNavigate({ step: to });
  };

  const update = (change: (current: Draft) => Draft) => setDraft(change);
  const projectHref = `/projects/${data.projectId}`;
  const sent = page === "sent";
  const index = sent ? stepKeys.length : stepKeys.indexOf(page);

  const steps: FlowStep[] = stepKeys.map((key) => {
    const state = stepState(draft, all, key, page);
    const count = all.filter((issue) => issue.step === key).length;
    return {
      label: stepNames[key],
      state: state === "current" ? "current" : state,
      why:
        state === "todo"
          ? `Not reached yet. Finish ${stepNames[page === "sent" ? "send" : page]} first, then use Next.`
          : `Go to ${stepNames[key]}${count && draft.seen.includes(key) ? `. ${plural(count, "thing")} to fix` : ""}`,
    };
  });

  const stepProps = {
    draft,
    data,
    update,
    errors,
    goTo: (to: StepKey) => go(to),
    openModal: (next: TaskModal) => onNavigate({ step: page, modal: next }),
    onTemplate: (template: (typeof data.templates)[number]) => {
      setDraft((current) => applyTemplate(current, template, data));
      setToast(`${template.name} filled in what to check, how it runs and the display defaults`);
    },
  };

  const next = () => {
    if (page === "sent") return;
    const own = all.filter((issue) => issue.step === page);
    if (own.length) {
      setDraft((current) => ({
        ...touchStep(current, all, page),
        dispOpen: current.dispOpen || own.some((issue) => issue.field.startsWith("locks.")),
      }));
      setFocus({ field: own[0]?.field ?? "", move: true });
      return;
    }
    const after = stepKeys[stepKeys.indexOf(page) + 1];
    if (after) go(after);
  };

  const send = () => {
    if (all.length) {
      setDraft((current) => stepKeys.reduce((acc, key) => touchStep(acc, all, key), current));
      return;
    }
    create.mutate(
      { projectId: data.projectId, data: toTaskDraft(draft, data) },
      {
        onSuccess: (response) => {
          if (response.status === 201) {
            const taskId = response.data.id;
            setSentTaskId(taskId);
            for (const email of draft.invites) {
              invite.mutate(
                { taskId, data: { email } },
                { onError: () => setToast(`The invite to ${email} could not be sent. Try again.`) },
              );
            }
          }
          setDraft((current) => ({ ...current, sentAt: "15 Oct" }));
          onNavigate({ step: "sent" });
        },
        onError: () => setToast("The task could not be created. Try again."),
      },
    );
  };

  let bar: ReactNode;
  if (sent) {
    bar = (
      <FlowBar
        hint="Settings can change until the first review starts."
        next={
          <span className="flex gap-3">
            {renderLink({
              href: `${projectHref}?tab=tasks`,
              className: buttonVariants({}),
              children: "Back to the project",
            })}
            {renderLink({
              href: `/team?task=${encodeURIComponent(sentTaskId ?? data.taskId)}`,
              className: buttonVariants({ variant: "primary" }),
              children: "Track it in Team",
            })}
          </span>
        }
      />
    );
  } else {
    const last = page === "send";
    const blockers = blockersFor(all, page);
    const listed = blockers.length > 1 || (last && blockers.length > 0);
    const hint = listed
      ? `${plural(blockers.length, "thing")} to finish first.`
      : blockers[0]
        ? (blockers[0].blockText ?? blockers[0].text)
        : last
          ? "Each reviewer gets one email, and the task shows at the top of their My work."
          : "The draft is saved as you go.";
    const before = stepKeys[index - 1];
    bar = (
      <FlowBar
        blockers={
          listed ? (
            <BeforeYouList
              showSingle
              title={`Before you can ${last ? "send" : "go on"}`}
              className="rounded-none border-0 bg-transparent p-0"
              blockers={blockers.map((issue) => ({
                id: issue.field,
                text: issue.text,
                goTo: "Go to",
                onGoTo: () => go(issue.step, issue.field),
              }))}
            />
          ) : null
        }
        back={
          before ? (
            <Button onClick={() => go(before)}>Back</Button>
          ) : (
            renderLink({
              href: `${projectHref}?tab=tasks`,
              className: buttonVariants({}),
              children: "Cancel",
            })
          )
        }
        hint={<span className={blockers.length ? "text-fg" : undefined}>{hint}</span>}
        next={
          <Button
            variant="primary"
            aria-disabled={blockers.length > 0 || create.isPending}
            onClick={last ? send : next}
          >
            {last ? <Icon name="mail" /> : null}
            {last ? sendLabel(draft) : "Next"}
          </Button>
        }
      />
    );
  }

  const sentLine = (
    <p className="m-0 mt-1.5 flex items-center gap-2 text-body-sm text-fg">
      <Icon name="check" className="text-ok" />
      <span>
        Sent to {plural(draft.reviewers.length, "reviewer")}
        {draft.invites.length ? ` and ${draft.invites.length} invited` : ""} on{" "}
        {draft.sentAt ?? "15 Oct"}
      </span>
    </p>
  );

  return (
    <>
      <FlowPage
        data-testid="new-task"
        data-step={page}
        className="h-full"
        renderLink={renderLink}
        crumbStart={<SidebarToggle />}
        crumbs={[
          { label: data.projectName, href: `${projectHref}?tab=slides` },
          { label: "Review tasks", href: `${projectHref}?tab=tasks` },
          { label: sent ? data.code : "New review task" },
        ]}
        title={
          sent ? (
            <>
              <span className="font-mono">{data.code}</span> · {draft.name.trim()}
            </>
          ) : (
            "New review task"
          )
        }
        subtitle={sent ? undefined : <span className="font-mono">{data.code}</span>}
        steps={steps}
        current={Math.min(index, stepKeys.length - 1)}
        reached={Math.max(flow.reached, Math.min(index, stepKeys.length - 1))}
        onStepSelect={(chosen) => {
          const key = stepKeys[chosen];
          if (key && draft.seen.includes(key)) go(key);
        }}
        status={sent ? sentLine : undefined}
        bar={bar}
      >
        {page === "slides" ? <SlidesStep {...stepProps} /> : null}
        {page === "reviewers" ? <ReviewersStep {...stepProps} /> : null}
        {page === "check" ? <CheckStep {...stepProps} /> : null}
        {page === "how" ? <HowStep {...stepProps} /> : null}
        {page === "send" ? <SendStep {...stepProps} /> : null}
        {sent ? <SentPanel draft={draft} data={data} /> : null}
      </FlowPage>
      {modal === "addslides" ? (
        <AddSlidesModal
          draft={draft}
          data={data}
          onClose={() => onNavigate({ step: page, modal: undefined })}
          onAdd={(ids) => {
            setDraft((current) => ({
              ...current,
              extraSlides: [...current.extraSlides, ...ids],
              touched: { ...current.touched, groups: true },
            }));
            onNavigate({ step: page, modal: undefined });
            setToast(`${plural(ids.length, "slide")} added to the task`);
          }}
        />
      ) : null}
      {modal === "dpreview" ? (
        <PreviewQuestionModal
          draft={draft}
          data={data}
          onClose={() => onNavigate({ step: page, modal: undefined })}
        />
      ) : null}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center">
          <Toast>{toast}</Toast>
        </div>
      ) : null}
    </>
  );
}
