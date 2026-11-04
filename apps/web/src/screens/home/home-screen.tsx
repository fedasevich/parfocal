import {
  ApiError,
  type Checklist,
  type HomeProject,
  type MyTask,
  type Project,
  type ResumeTarget,
  resolveSetting,
  useGetMe,
  useGetMyChecklist,
  useGetMyHome,
  useGetMySettingLayers,
  useGetNotificationCounts,
  useListProjects,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { AvatarStack } from "@parfocal/ui/components/person";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Fragment, type ReactNode, useState } from "react";
import { now } from "../../clock.ts";
import { destinations } from "../../shell/destinations.ts";
import { useOverlay } from "../../shell/overlays.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { formatDue, formatLongDay, formatWeekday, greeting, percent, plural } from "../format.ts";
import { projectColour } from "../palette.ts";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { useSlideProgress } from "../slide-progress.ts";
import { coverTile, lookUrl } from "../thumbnails.ts";
import { Announcements } from "./announcements.tsx";
import { DotRow, SideCard } from "./cards.tsx";
import {
  type HomeBlock,
  homeBlocks,
  homeLayoutFor,
  type SideBlock,
  sideBlocks,
} from "./home-layout.ts";

const Section = ({ children }: { children: ReactNode }) => (
  <span className="text-caption font-semibold text-fg-dim">{children}</span>
);

const shortName = (task: { task_name?: string; name?: string }) =>
  (task.task_name ?? task.name ?? "").split(" · ")[0] ?? "";

export function continueTo(resume: ResumeTarget) {
  const object = resume.object_id ?? undefined;
  if (resume.mode === "viewer")
    return destinations.slide(
      resume.project.id,
      resume.slide_id,
      resume.task_id,
      object,
      resume.camera ?? {},
    );
  return destinations.guided(resume.task_id, resume.slide_id, object, resume.camera ?? null);
}

function ResumeHero({ resume }: { resume: ResumeTarget }) {
  const goTo = useGoTo();
  const progress = useSlideProgress(resume.task_id, resume.slide_id);
  const continueHref = continueTo(resume);
  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)] overflow-hidden rounded-[14px] border border-line bg-chrome">
      <div
        aria-hidden="true"
        className="min-h-[150px] bg-[length:150%] bg-[35%_40%]"
        style={{ backgroundImage: `url(${lookUrl("mid")})` }}
      />
      <div className="grid content-center gap-2 px-5 py-4.5">
        <div className="flex items-center gap-2.5">
          <span className="rounded-[5px] border border-line-strong px-1.75 py-0.5 font-mono text-caption text-fg-dim">
            {resume.task_code}
          </span>
          <b className="text-title-sm font-semibold text-fg">{resume.task_name}</b>
        </div>
        <span className="text-body text-fg">
          {resume.slide_label} · {resume.case_label} · {resume.project.name}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-body-sm text-fg-dim">
          Slide {resume.position + 1} of {resume.slides_assigned}
          {progress ? (
            <>
              <span className="text-fg-faint">·</span>
              {progress.decided} of {progress.total} objects decided
            </>
          ) : null}
          {resume.due_on ? (
            <>
              <span className="text-fg-faint">·</span>
              due {formatDue(resume.due_on)}
            </>
          ) : null}
          {resume.blinded ? <StatusTag tone="accent">Blind</StatusTag> : null}
        </span>
        <div className="mt-1.5 flex gap-2">
          <Button variant="primary" onClick={() => void goTo(continueHref)}>
            Continue <Keycap keys="↵" />
          </Button>
          <Button
            onClick={() =>
              void goTo(
                destinations.slide(
                  resume.project.id,
                  resume.slide_id,
                  resume.task_id,
                  resume.object_id ?? undefined,
                ),
              )
            }
          >
            Open in the full viewer
          </Button>
        </div>
      </div>
    </div>
  );
}

function SampleHero({
  sample,
  firstProjectId,
}: {
  sample: NonNullable<Checklist["sample_project"]>;
  firstProjectId: string;
}) {
  const goTo = useGoTo();
  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)] overflow-hidden rounded-[14px] border border-line bg-chrome">
      <div
        aria-hidden="true"
        className="min-h-[150px] bg-[length:150%] bg-[35%_40%]"
        style={{ backgroundImage: `url(${lookUrl("overview")})` }}
      />
      <div className="grid content-center gap-2 px-5 py-4.5">
        <div className="flex items-center gap-2.5">
          <StatusTag tone="accent">Sample</StatusTag>
          <b className="text-title-sm font-semibold text-fg">{sample.name}</b>
        </div>
        <span className="text-body text-fg">
          {sample.slides} slides with AI results, made for trying things out
        </span>
        <span className="text-body-sm text-fg-dim">Nothing here counts in a real evaluation</span>
        <div className="mt-1.5 flex gap-2">
          <Button variant="primary" onClick={() => void goTo(destinations.guided("sample"))}>
            Review the first slide <Keycap keys="↵" />
          </Button>
          <Button onClick={() => void goTo(destinations.project(firstProjectId))}>
            Open the project
          </Button>
        </div>
      </div>
    </div>
  );
}

type QuickAction = { icon: IconName; title: string; text: string; run: () => void };

function QuickActions({
  slidesWithoutResults,
  projectId,
}: {
  slidesWithoutResults: number;
  projectId: string;
}) {
  const goTo = useGoTo();
  const overlay = useOverlay();
  const actions: QuickAction[] = [
    {
      icon: "upload",
      title: "Upload",
      text: "Slides and their AI results",
      run: () => void goTo(destinations.upload(projectId)),
    },
    {
      icon: "smart",
      title: "Run a model",
      text:
        slidesWithoutResults > 0
          ? `${plural(slidesWithoutResults, "slide")} ${slidesWithoutResults === 1 ? "has" : "have"} no results yet`
          : "Every slide has results",
      run: () => void goTo(destinations.runModel(projectId)),
    },
    {
      icon: "users",
      title: "New review task",
      text: "Hand slides out to reviewers",
      run: () => void goTo(destinations.newReviewTask(projectId)),
    },
    {
      icon: "search",
      title: "Find an object",
      text: "A slide, a case or an ID like T2·C145",
      run: () => void overlay.set("palette"),
    },
    {
      icon: "folder",
      title: "New project",
      text: "Privacy, classes and a template",
      run: () => void goTo(destinations.newProject()),
    },
  ];
  return (
    <div className="grid grid-cols-5 gap-2.5">
      {actions.map((action) => (
        <button
          key={action.title}
          type="button"
          onClick={action.run}
          className="grid cursor-pointer content-start gap-1 rounded-xl border border-line bg-chrome p-3.5 text-left hover:border-accent"
        >
          <Icon name={action.icon} size="md" className="mb-2 text-fg" />
          <b className="text-body font-semibold text-fg">{action.title}</b>
          <small className="text-body-sm leading-[1.45] text-fg-dim">{action.text}</small>
        </button>
      ))}
    </div>
  );
}

function ProjectCard({ project, members }: { project: HomeProject; members: Project["members"] }) {
  const goTo = useGoTo();
  const people = usePeople();
  const shown = project.strip.slice(0, 4);
  const more = project.slides - shown.length;
  const reviewed = percent(project.reviewed_slides, project.slides);
  const faces = members.flatMap((member) => {
    const person = people(member.user_id);
    return person ? [person] : [];
  });
  return (
    <button
      type="button"
      onClick={() => void goTo(destinations.project(project.id))}
      className="cursor-pointer overflow-hidden rounded-xl border border-line bg-chrome p-0 text-left hover:border-accent"
    >
      <div aria-hidden="true" className="grid grid-cols-5 gap-1.5 px-2.5 pt-2.5">
        {shown.map((slide, index) => (
          <span
            key={slide.id}
            className="relative aspect-square overflow-hidden rounded-lg bg-[#f4f1ee] bg-no-repeat"
            style={coverTile(project.code, index)}
          >
            <i
              className={`absolute right-1.25 bottom-1.25 size-2.25 rounded-full shadow-[0_0_0_2px_rgba(255,255,255,.9)] ${slide.reviewed ? "bg-v-agree" : "bg-[rgba(120,120,120,.85)]"}`}
            />
          </span>
        ))}
        {more > 0 ? (
          <span className="grid aspect-square place-content-center justify-items-center gap-px rounded-lg bg-surf-section text-fg-dim">
            <b className="font-mono text-lead font-semibold text-fg">+{more}</b>
            <small className="text-caption">slides</small>
          </span>
        ) : null}
      </div>
      <div className="grid gap-1.5 p-3">
        <b className="flex min-w-0 items-center gap-2.25 text-body text-fg">
          <i
            aria-hidden="true"
            className="h-3 w-3.75 shrink-0 rounded-[2px] opacity-85"
            style={{ background: projectColour(project.colour) }}
          />
          <span className="truncate">{project.name}</span>
        </b>
        <small className="font-mono text-caption text-fg-faint">
          {project.code} · {project.slides} slides · {project.result_sets} result sets
        </small>
        <div className="flex items-center justify-between">
          {project.privacy_mode === "clinical" ? (
            <StatusTag tone="warn">Clinical</StatusTag>
          ) : (
            <StatusTag tone="accent">De-identified</StatusTag>
          )}
          {faces.length > 0 ? <AvatarStack people={faces} size={22} max={3} /> : null}
        </div>
        <ProgressBar value={reviewed} label="Reviewed" valueText={`${reviewed}%`} />
      </div>
    </button>
  );
}

function ChecklistCard({ checklist }: { checklist: Checklist }) {
  const [hidden, setHidden] = useState(false);
  const goTo = useGoTo();
  if (hidden) return null;
  const done = checklist.steps.filter((step) => step.done).length;
  const targets: Record<string, string | undefined> = {
    "guided-review": destinations.guided("sample"),
    comment: destinations.guided("sample"),
    opinion: destinations.guided("sample"),
  };
  return (
    <section
      aria-label="Getting started"
      className="grid gap-2 rounded-xl border border-accent bg-accent-soft p-3.5"
    >
      <div className="flex items-center justify-between">
        <b className="text-body font-semibold text-fg">Getting started</b>
        <span className="font-mono text-caption text-fg-dim">
          {done} of {checklist.steps.length}
        </span>
      </div>
      <ProgressBar value={percent(done, checklist.steps.length)} aria-label="Getting started" />
      {checklist.steps.map((step) =>
        step.done ? (
          <div
            key={step.key}
            className="grid grid-cols-[18px_1fr_14px] items-center gap-2.5 px-0.5 py-1.5 text-body-sm text-fg-faint line-through"
          >
            <Icon name="check" className="text-ok" />
            <span>{step.label}</span>
          </div>
        ) : (
          <button
            key={step.key}
            type="button"
            onClick={() => {
              const target = targets[step.key];
              if (target) void goTo(target);
            }}
            className="grid cursor-pointer grid-cols-[18px_1fr_14px] items-center gap-2.5 border-0 bg-transparent px-0.5 py-1.5 text-left text-body-sm text-fg"
          >
            <i
              aria-hidden="true"
              className="size-4 rounded-full border-[1.5px] border-line-strong"
            />
            <span>{step.label}</span>
            <Icon name="next" className="text-fg-dim" />
          </button>
        ),
      )}
      <Button variant="link" className="justify-self-start" onClick={() => setHidden(true)}>
        Hide the checklist
      </Button>
    </section>
  );
}

function ThisWeek({
  week,
  taskId,
}: {
  week: { objects_checked: number; agree_share: number | null; open_disagreements: number | null };
  taskId: string | undefined;
}) {
  const goTo = useGoTo();
  return (
    <SideCard
      title="This week in your projects"
      end={
        taskId ? (
          <Button variant="link" onClick={() => void goTo(destinations.evaluation(taskId))}>
            Evaluation
          </Button>
        ) : null
      }
    >
      <div className="grid grid-cols-3 gap-2">
        <div>
          <b className="block font-mono text-page-title leading-[1.1] font-semibold text-fg">
            {week.objects_checked}
          </b>
          <small className="mt-1 block text-caption leading-[1.3] text-fg-dim">
            objects you checked
          </small>
        </div>
        <div>
          <b className="block font-mono text-page-title leading-[1.1] font-semibold text-v-agree">
            {Math.round((week.agree_share ?? 0) * 100)}%
          </b>
          <small className="mt-1 block text-caption leading-[1.3] text-fg-dim">
            agree with the AI
          </small>
        </div>
        <div>
          <button
            type="button"
            onClick={() => (taskId ? void goTo(destinations.disagreements(taskId)) : undefined)}
            className="block cursor-pointer border-0 bg-transparent p-0 font-mono text-page-title leading-[1.1] font-semibold text-v-disagree"
          >
            {week.open_disagreements ?? 0}
          </button>
          <small className="mt-1 block text-caption leading-[1.3] text-fg-dim">
            disagreements open
          </small>
        </div>
      </div>
    </SideCard>
  );
}

function ComingUp({ tasks, projects }: { tasks: MyTask[]; projects: HomeProject[] }) {
  const goTo = useGoTo();
  const people = usePeople();
  const active = tasks.filter(
    (task) => task.status === "in-review" || task.status === "not-started",
  );
  const colourOf = (id: string) =>
    projectColour(projects.find((project) => project.id === id)?.colour ?? 0);
  return (
    <SideCard
      title="Coming up"
      end={
        <Button variant="link" onClick={() => void goTo(destinations.myWork())}>
          My work
        </Button>
      }
    >
      {active.map((task) => {
        const progress =
          task.slides_submitted > 0
            ? `${task.slides_submitted} of ${task.slides_assigned} done`
            : `New from ${people(task.created_by_user_id)?.name ?? "a researcher"}`;
        return (
          <DotRow
            key={task.id}
            colour={colourOf(task.project.id)}
            title={task.name}
            sub={`${progress}${task.due_on ? ` · due ${formatDue(task.due_on)}` : ""}`}
            onClick={() => void goTo(destinations.guided(task.id, task.next_slide_id))}
          />
        );
      })}
      {active.length === 0 ? (
        <span className="text-body-sm text-fg-dim">Nothing due. New tasks show here.</span>
      ) : null}
    </SideCard>
  );
}

function HomeWithoutData({
  firstName,
  error,
  retry,
}: {
  firstName: string;
  error: unknown;
  retry: () => void;
}) {
  const goTo = useGoTo();
  const kind = error instanceof ApiError ? error.kind : undefined;
  return (
    <main className="grid content-start gap-(--density-page-gap) px-8 pt-5.5 pb-4.5 pl-7">
      <header>
        <h1 className="m-0 text-page-title font-semibold text-fg">
          {greeting(now())}, {firstName}
        </h1>
        <p className="mt-1 mb-0 text-body-sm leading-[1.45] text-fg-dim">{formatLongDay(now())}</p>
      </header>
      {error === null ? (
        <p className="text-body-sm text-fg-dim">Loading your home…</p>
      ) : kind === "forbidden" ? (
        <section
          aria-label="No workspace yet"
          className="grid max-w-xl gap-3 rounded-xl border border-line bg-chrome p-4"
        >
          <b className="text-body font-semibold text-fg">You are not in a workspace yet</b>
          <span className="text-body-sm text-fg-dim">
            Your projects, tasks and slides show here once you join one. Open the invitation from
            your email, or set up a workspace of your own.
          </span>
          <Button className="justify-self-start" onClick={() => void goTo("/setup")}>
            Set up a workspace
          </Button>
        </section>
      ) : (
        <section
          aria-label="Home did not load"
          role="alert"
          className="grid max-w-xl gap-3 rounded-xl border border-line bg-chrome p-4"
        >
          <b className="text-body font-semibold text-fg">Your home could not load</b>
          <span className="text-body-sm text-fg-dim">
            Nothing is lost. Try again, or open My work from the sidebar.
          </span>
          <Button className="justify-self-start" onClick={retry}>
            Try again
          </Button>
        </section>
      )}
    </main>
  );
}

export function HomeScreen() {
  const me = okData(useGetMe().data);
  const homeQuery = useGetMyHome();
  const home = okData(homeQuery.data);
  const checklist = useGetMyChecklist().data?.data;
  const counts = okData(useGetNotificationCounts().data);
  const projects = okData(useListProjects().data) ?? [];
  const goTo = useGoTo();
  const layersQuery = useGetMySettingLayers();
  const layers = okData(layersQuery.data);
  if (me === undefined || layersQuery.isPending) {
    return <p className="p-8 text-body-sm text-fg-dim">Loading your home…</p>;
  }
  const firstName = me.display_name.split(" ")[0] ?? me.display_name;
  if (home === undefined) {
    return (
      <HomeWithoutData
        firstName={firstName}
        error={homeQuery.error}
        retry={() => void homeQuery.refetch()}
      />
    );
  }
  const canPost =
    me.workspaces.find((workspace) => workspace.tenant_id === me.active_tenant_id)?.admin_rights ??
    false;
  const firstWeek = checklist !== undefined && !checklist.hidden;
  const layout = homeLayoutFor(
    resolveSetting("home_layout", {
      lab: layers?.lab ?? { values: {}, locked: [] },
      personal: layers?.personal ?? {},
      device: {},
    }).value,
    me.workspaces.find((workspace) => workspace.tenant_id === me.active_tenant_id)?.role,
  );
  const inProgress = home.tasks.filter((task) => task.status === "in-review").length;
  const mentions = (counts?.kinds ?? [])
    .filter((kind) => kind.kind === "mention" || kind.kind === "reply")
    .reduce((sum, kind) => sum + kind.unread, 0);
  const today = now();
  const summary = firstWeek
    ? "your sample project is ready"
    : [
        `${plural(inProgress, "task")} in progress`,
        mentions > 0 ? plural(mentions, "mention") : null,
        home.resume?.due_on
          ? `${shortName(home.resume)} due ${formatWeekday(home.resume.due_on)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
  const membersOf = (id: string) => projects.find((project) => project.id === id)?.members ?? [];
  const firstProjectId = projects[0]?.id ?? "";
  const main: Record<HomeBlock, ReactNode> = {
    continue: (
      <>
        <Section>{firstWeek ? "Start here" : "Continue where you left off"}</Section>
        {home.resume ? (
          <ResumeHero resume={home.resume} />
        ) : firstWeek && checklist?.sample_project ? (
          <SampleHero sample={checklist.sample_project} firstProjectId={firstProjectId} />
        ) : (
          <p className="text-body-sm text-fg-dim">
            Nothing in progress. Start something{" "}
            {homeBlocks[layout].indexOf("start") > homeBlocks[layout].indexOf("continue")
              ? "below"
              : "above"}
            .
          </p>
        )}
      </>
    ),
    start: (
      <>
        <Section>Start something</Section>
        <QuickActions
          slidesWithoutResults={home.slides_without_results}
          projectId={firstProjectId}
        />
      </>
    ),
    projects: (
      <>
        <div className="flex items-center justify-between">
          <Section>Projects</Section>
          <Button variant="link" onClick={() => void goTo(destinations.newProject())}>
            New project
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {home.projects.map((project) => (
            <ProjectCard key={project.id} project={project} members={membersOf(project.id)} />
          ))}
        </div>
      </>
    ),
  };
  const side: Record<SideBlock, ReactNode> = {
    week: <ThisWeek week={home.week} taskId={home.resume?.task_id} />,
    tasks: <ComingUp tasks={home.tasks} projects={home.projects} />,
  };
  return (
    <main className="grid content-start gap-(--density-page-gap) px-8 pt-5.5 pb-4.5 pl-7">
      <header>
        <h1 className="m-0 text-page-title font-semibold text-fg">
          {firstWeek ? `Welcome to Parfocal, ${firstName}` : `${greeting(today)}, ${firstName}`}
        </h1>
        <p className="mt-1 mb-0 text-body-sm leading-[1.45] text-fg-dim">
          {formatLongDay(today)} · {summary}
        </p>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6">
        <div className="grid gap-3">
          {homeBlocks[layout].map((block, index) => (
            <div key={block} className={`grid gap-3 ${index > 0 ? "mt-3" : ""}`}>
              {main[block]}
            </div>
          ))}
        </div>
        <aside className="grid gap-3">
          {firstWeek && checklist ? (
            <ChecklistCard checklist={checklist} />
          ) : (
            sideBlocks[layout].map((block) => <Fragment key={block}>{side[block]}</Fragment>)
          )}
          <Announcements items={home.announcements} firstWeek={firstWeek} canPost={canPost} />
        </aside>
      </div>
    </main>
  );
}
