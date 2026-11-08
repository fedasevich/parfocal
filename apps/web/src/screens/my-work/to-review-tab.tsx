import {
  type InboxItem,
  type MyAdjudication,
  type MyTask,
  type ResumeTarget,
  useGetMyHome,
  useListMyCosignRequests,
  useListNotifications,
  useListProjects,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Keycap } from "@parfocal/ui/components/keycap";
import { PersonAvatar } from "@parfocal/ui/components/person";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import { ObjectIdTag, StatusTag } from "@parfocal/ui/components/tag";
import { now } from "../../clock.ts";
import { payloadText } from "../../shell/bell.tsx";
import { destinations } from "../../shell/destinations.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import {
  andJoin,
  formatClock,
  formatDayMonth,
  formatDue,
  percent,
  relativeTime,
} from "../format.ts";
import { projectColour } from "../palette.ts";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { useSlideProgress } from "../slide-progress.ts";
import {
  Callout,
  PreviewPanel,
  SectionLabel,
  scopeWords,
  ThreadsValue,
  useOpenThreads,
} from "./parts.tsx";
import { activeTasks, continuePath, reviewRow } from "./to-review-rows.ts";

export { activeTasks };

export const adjudicationKey = (item: MyAdjudication) => `adj-${item.id}`;

const minutesPerSlide = 16;

const timeLeft = (slides: number) => {
  const minutes = slides * minutesPerSlide;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `about ${rest} min left`;
  return rest === 0 ? `about ${hours} h left` : `about ${hours} h ${rest} min left`;
};

function ContinueHero({ task, resume }: { task: MyTask; resume: ResumeTarget }) {
  const goTo = useGoTo();
  const open = () => void goTo(continuePath(task, resume));
  const left = task.slides_assigned - task.slides_submitted;
  return (
    <div
      data-vt-source=""
      className="grid grid-cols-[180px_1fr_auto] items-center gap-4.5 rounded-[14px] border border-accent bg-accent-soft p-4"
    >
      <i
        aria-hidden="true"
        className="block h-27.5 rounded-[10px] bg-cover bg-center"
        style={{ backgroundImage: "url(/mock-assets/overview.jpg)" }}
      />
      <div className="grid gap-1.5">
        <SectionLabel>Continue where you left off</SectionLabel>
        <h3 className="m-0 text-title font-semibold text-fg">{task.name}</h3>
        <p className="m-0 text-body-sm text-fg-dim">
          Slide {resume.position + 1} of {resume.slides_assigned} · {timeLeft(left)}
          {task.due_on ? ` · due ${formatDue(task.due_on)}` : ""}
        </p>
        <ProgressBar
          value={percent(task.slides_submitted, task.slides_assigned)}
          aria-label={`${task.slides_submitted} of ${task.slides_assigned} slides`}
        />
      </div>
      <Button variant="primary" size="lg" onClick={open}>
        Continue reviewing <Keycap keys="↵" />
      </Button>
    </div>
  );
}

type RowProps = {
  selected: boolean;
  colour: string;
  title: string;
  sub: string;
  progress: { value: number; label: string };
  tags: React.ReactNode;
  action: { label: string; primary: boolean; run: () => void };
  onSelect: () => void;
};

function TaskRow({ selected, colour, title, sub, progress, tags, action, onSelect }: RowProps) {
  return (
    <div
      role="option"
      aria-selected={selected}
      data-vt-source=""
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => (event.key === " " ? onSelect() : undefined)}
      className={`grid cursor-pointer grid-cols-[6px_1fr_auto_auto] items-center gap-3.5 rounded-xl border px-3.5 py-(--density-list-row-y) ${selected ? "border-accent bg-accent-soft" : "border-line bg-chrome hover:border-line-strong"}`}
    >
      <span aria-hidden="true" className="h-10 rounded-[3px]" style={{ background: colour }} />
      <div className="min-w-0">
        <b className="text-body font-semibold text-fg">{title}</b>
        <small className="mt-0.5 mb-1.5 block text-caption text-fg-faint">{sub}</small>
        <ProgressBar
          className="max-w-85"
          value={progress.value}
          label={progress.label}
          valueText={`${progress.value}%`}
        />
      </div>
      <span className="flex items-center gap-2">{tags}</span>
      <Button
        variant={action.primary ? "primary" : "secondary"}
        onClick={(event) => {
          event.stopPropagation();
          action.run();
        }}
      >
        {action.label}
      </Button>
    </div>
  );
}

function MentionRow({ item }: { item: InboxItem }) {
  const people = usePeople();
  const goTo = useGoTo();
  const actor = people(payloadText(item, "actor_user_id"));
  const objectId = payloadText(item, "object_id") ?? "";
  const quote = payloadText(item, "quote") ?? "";
  const said = quote ? `${quote[0]?.toLowerCase() ?? ""}${quote.slice(1)}` : "";
  return (
    <button
      type="button"
      onClick={() => void goTo(item.link)}
      className="grid cursor-pointer grid-cols-[26px_1fr] gap-2.5 rounded-[10px] border border-line bg-chrome px-3 py-(--density-item-y) text-left text-body-sm text-fg-dim"
    >
      <PersonAvatar person={actor} size={26} />
      <div>
        <b className="text-fg">{actor?.name}</b>{" "}
        {item.kind === "mention" ? (
          <>
            asked about <ObjectIdTag>{objectId}</ObjectIdTag> on{" "}
            <span data-phi="">{payloadText(item, "slide_label")}</span>: {said}
          </>
        ) : (
          <>
            replied on <ObjectIdTag>{objectId}</ObjectIdTag>: {said}
          </>
        )}
        <small className="mt-0.75 block text-caption text-fg-faint">
          {relativeTime(new Date(item.created_at), now())}
        </small>
      </div>
    </button>
  );
}

function AsksForYou() {
  const asks = okData(useListMyCosignRequests().data) ?? [];
  const people = usePeople();
  const goTo = useGoTo();
  if (asks.length === 0) return null;
  return (
    <>
      <SectionLabel>Asks for you</SectionLabel>
      {asks.map((ask) => {
        const from = people(ask.from_user_id);
        const sent = new Date(ask.sent_at);
        const open = () => void goTo(destinations.coSign(ask.project.id, ask.case_id));
        return (
          <div
            key={ask.id}
            className="grid grid-cols-[26px_1fr_auto] items-center gap-2.5 rounded-[10px] border border-line bg-chrome px-3 py-(--density-item-y) text-body-sm text-fg-dim"
          >
            <PersonAvatar person={from} size={26} />
            <div>
              <b className="text-fg">{from?.name}</b> asks you to co-sign{" "}
              <span className="font-mono text-fg" data-phi="">
                {ask.case_label}
              </span>
              <small className="mt-0.75 block text-caption text-fg-faint">
                {ask.project.name} · {formatDayMonth(sent)} {formatClock(sent)}
              </small>
            </div>
            <Button size="sm" onClick={open}>
              Open
            </Button>
          </div>
        );
      })}
    </>
  );
}

function SideColumn({ hasAdjudications }: { hasAdjudications: boolean }) {
  const mentions =
    okData(useListNotifications({ kind: ["mention", "reply"] }).data)?.notifications ?? [];
  return (
    <div className="flex flex-col gap-3">
      <AsksForYou />
      <SectionLabel>Mentions and replies</SectionLabel>
      {mentions.length > 0 ? (
        mentions.map((item) => <MentionRow key={item.id} item={item} />)
      ) : (
        <span className="text-body-sm text-fg-dim">Nothing new for you.</span>
      )}
      <Callout>
        {hasAdjudications
          ? "Reviewers stay anonymous to you in the adjudicator view, so each decision is about the tissue."
          : "Each slide saves as you go. Nothing is lost if you close the tab or get called away."}
      </Callout>
    </div>
  );
}

function TaskPreview({
  task,
  resume,
  onClose,
}: {
  task: MyTask;
  resume: ResumeTarget | null;
  onClose: () => void;
}) {
  const goTo = useGoTo();
  const here = resume?.task_id === task.id ? resume : null;
  const slideId = here?.slide_id ?? task.next_slide_id ?? undefined;
  const progress = useSlideProgress(task.id, slideId);
  const threads = useOpenThreads(here ? slideId : undefined);
  const guided = () =>
    void goTo(here ? continuePath(task, here) : destinations.guided(task.id, slideId));
  return (
    <PreviewPanel
      title={here ? `${here.slide_label}` : task.code}
      subtitle={task.project.name}
      progress={progress}
      facts={[
        { icon: "users", label: "Task", value: `${task.code} · ${task.name}` },
        ...(task.due_on
          ? [{ icon: "calendar" as const, label: "Due", value: formatDue(task.due_on) }]
          : []),
        { icon: "target", label: "To check", value: scopeWords[task.scope] },
        {
          icon: "slides",
          label: "Where",
          value: here
            ? `Slide ${here.position + 1} of ${here.slides_assigned}, case ${here.case_label}`
            : `Slide 1 of ${task.slides_assigned}, not started`,
        },
        {
          icon: "comment",
          label: "Open comments",
          value: <ThreadsValue anchors={threads.map((thread) => thread.anchor)} />,
        },
      ]}
      main={{
        label: task.slides_submitted > 0 ? "Continue in guided review" : "Start in guided review",
        run: guided,
      }}
      full={
        slideId ? () => void goTo(destinations.slide(task.project.id, slideId, task.id)) : undefined
      }
      onClose={onClose}
    />
  );
}

function AdjudicationPreview({ item, onClose }: { item: MyAdjudication; onClose: () => void }) {
  const goTo = useGoTo();
  return (
    <PreviewPanel
      title={item.slide_label}
      subtitle={item.project.name}
      facts={[
        { icon: "users", label: "Task", value: `${item.task_code} · ${item.task_name}` },
        {
          icon: "slides",
          label: "Where",
          value: `${andJoin(item.objects)} queued for you`,
        },
      ]}
      main={{
        label: item.decided > 0 ? "Continue deciding" : "Start deciding",
        run: () => void goTo(destinations.disagreements(item.task_id, "adjudicate")),
      }}
      onClose={onClose}
    />
  );
}

export function ToReviewTab({
  tasks,
  adjudications,
  selected,
  onSelect,
}: {
  tasks: MyTask[];
  adjudications: MyAdjudication[];
  selected: string | undefined;
  onSelect: (key: string | undefined) => void;
}) {
  const goTo = useGoTo();
  const people = usePeople();
  const resume = okData(useGetMyHome().data)?.resume ?? null;
  const projects = okData(useListProjects().data) ?? [];
  const colourOf = (id: string) =>
    projectColour(projects.find((project) => project.id === id)?.colour ?? 0);
  const active = activeTasks(tasks);
  const heroTask = resume ? active.find((task) => task.id === resume.task_id) : undefined;
  const previewTask = active.find((task) => task.id === selected);
  const previewAdjudication = adjudications.find((item) => adjudicationKey(item) === selected);
  const close = () => onSelect(undefined);
  const preview = previewTask ? (
    <TaskPreview task={previewTask} resume={resume} onClose={close} />
  ) : previewAdjudication ? (
    <AdjudicationPreview item={previewAdjudication} onClose={close} />
  ) : null;
  return (
    <div className={`grid gap-6 ${preview ? "grid-cols-[1fr_360px]" : "grid-cols-[1fr_340px]"}`}>
      <div role="listbox" aria-label="Your tasks" className="flex flex-col gap-3">
        {heroTask && resume ? <ContinueHero task={heroTask} resume={resume} /> : null}
        <SectionLabel>Your tasks</SectionLabel>
        {adjudications.map((item) => {
          const asker = people(item.asked_by_user_id)?.name ?? "the researcher";
          const total = item.objects.length;
          const allDone = item.decided >= total;
          return (
            <TaskRow
              key={item.id}
              selected={selected === adjudicationKey(item)}
              colour={colourOf(item.project.id)}
              title={`Decide ${total} objects on ${item.task_code}`}
              sub={`${item.project.name} · asked by ${asker} · ${andJoin(item.objects)} on ${item.slide_label}`}
              progress={{
                value: percent(item.decided, total),
                label: `${item.decided} of ${total} objects decided`,
              }}
              tags={
                <StatusTag tone={allDone ? "ok" : "accent"}>
                  {allDone ? "All decided" : "Adjudication"}
                </StatusTag>
              }
              action={{
                label: allDone ? "Open" : item.decided > 0 ? "Continue" : "Start",
                primary: !allDone,
                run: () => void goTo(destinations.disagreements(item.task_id, "adjudicate")),
              }}
              onSelect={() => onSelect(adjudicationKey(item))}
            />
          );
        })}
        {active.map((task) => {
          const row = reviewRow(task, people(task.created_by_user_id)?.name, resume);
          if (!row) return null;
          return (
            <TaskRow
              key={task.id}
              selected={selected === task.id}
              colour={colourOf(task.project.id)}
              title={row.title}
              sub={row.sub}
              progress={row.progress}
              tags={row.tags.map((tag) => (
                <StatusTag key={tag.label} tone={tag.tone}>
                  {tag.label}
                </StatusTag>
              ))}
              action={{
                label: row.action.label,
                primary: row.action.primary,
                run: () => void goTo(row.action.path),
              }}
              onSelect={() => onSelect(task.id)}
            />
          );
        })}
        {active.length === 0 && adjudications.length === 0 ? (
          <span className="text-body-sm text-fg-dim">Nothing to review. New tasks show here.</span>
        ) : null}
      </div>
      {preview ?? <SideColumn hasAdjudications={adjudications.length > 0} />}
    </div>
  );
}
