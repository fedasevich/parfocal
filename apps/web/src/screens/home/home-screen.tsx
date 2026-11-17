import { Trans, useLingui } from "@lingui/react/macro";
import {
  ApiError,
  type Checklist,
  getGetMySettingLayersQueryKey,
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
  useSetMySettingLayers,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { AvatarStack } from "@parfocal/ui/components/person";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import { SkeletonLine, SkeletonRows } from "@parfocal/ui/components/skeleton";
import { StatusTag } from "@parfocal/ui/components/tag";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, type ReactNode } from "react";
import { now } from "../../clock.ts";
import { setTourOfferSlot } from "../../help/tour-state.ts";
import { destinations } from "../../shell/destinations.ts";
import { useOverlay } from "../../shell/overlays.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { useWorklistLive } from "../../worklist-live/use-worklist-live.ts";
import {
  formatDue,
  formatLongDay,
  formatWeekday,
  greeting,
  greetingName,
  percent,
  plural,
} from "../format.ts";
import { projectColour } from "../palette.ts";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { useSlideProgress } from "../slide-progress.ts";
import { SlideThumb } from "../slide-thumb.tsx";
import { ActivityCard } from "./activity-card.tsx";
import { Announcements } from "./announcements.tsx";
import { DotRow, SideCard } from "./cards.tsx";
import { continueTo, openInFullViewer } from "./continue-to.ts";
import { checklistShows, stepsWithTried, stepTarget, useTried } from "./getting-started.ts";
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

function ResumeHero({ resume }: { resume: ResumeTarget }) {
  const goTo = useGoTo();
  const progress = useSlideProgress(resume.task_id, resume.slide_id);
  const continueHref = continueTo(resume);
  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)] overflow-hidden rounded-[14px] border border-line bg-chrome">
      <SlideThumb
        slideId={resume.slide_id}
        file={resume.slide_label}
        className="min-h-[150px] size-full"
      />
      <div className="grid content-center gap-2 px-5 py-4.5">
        <div className="flex items-center gap-2.5">
          <span className="rounded-[5px] border border-line-strong px-1.75 py-0.5 font-mono text-caption text-fg-dim">
            {resume.task_code}
          </span>
          <b className="text-title-sm font-semibold text-fg">{resume.task_name}</b>
        </div>
        <span className="text-body text-fg" data-phi="">
          {resume.slide_label} · {resume.case_label} · {resume.project.name}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-body-sm text-fg-dim">
          <Trans>
            Slide {resume.position + 1} of {resume.slides_assigned}
          </Trans>
          {progress ? (
            <>
              <Trans>
                <span className="text-fg-faint">·</span>
                {progress.decided} of {progress.total} objects decided
              </Trans>
            </>
          ) : null}
          {resume.due_on ? (
            <>
              <Trans>
                <span className="text-fg-faint">·</span>
                due {formatDue(resume.due_on)}
              </Trans>
            </>
          ) : null}
          {resume.blinded ? (
            <StatusTag tone="accent">
              <Trans>Blind</Trans>
            </StatusTag>
          ) : null}
        </span>
        <div className="mt-1.5 flex gap-2">
          <Button variant="primary" onClick={() => void goTo(continueHref)}>
            <Trans>
              Continue <Keycap keys="↵" />
            </Trans>
          </Button>
          <Button onClick={() => void goTo(openInFullViewer(resume))}>
            <Trans>Open in the full viewer</Trans>
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
    <div className="grid overflow-hidden rounded-[14px] border border-line bg-chrome">
      <div className="grid content-center gap-2 px-5 py-4.5">
        <div className="flex items-center gap-2.5">
          <StatusTag tone="accent">
            <Trans>Sample</Trans>
          </StatusTag>
          <b className="text-title-sm font-semibold text-fg">{sample.name}</b>
        </div>
        <span className="text-body text-fg">
          <Trans>{sample.slides} slides with AI results, made for trying things out</Trans>
        </span>
        <span className="text-body-sm text-fg-dim">
          <Trans>Nothing here counts in a real evaluation</Trans>
        </span>
        <div className="mt-1.5 flex gap-2">
          <Button variant="primary" onClick={() => void goTo(destinations.guided("sample"))}>
            <Trans>
              Review the first slide <Keycap keys="↵" />
            </Trans>
          </Button>
          <Button onClick={() => void goTo(destinations.project(firstProjectId))}>
            <Trans>Open the project</Trans>
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
  const { t } = useLingui();

  const goTo = useGoTo();
  const overlay = useOverlay();
  const actions: QuickAction[] = [
    {
      icon: "upload",
      title: t`Upload`,
      text: t`Slides and their AI results`,
      run: () => void goTo(destinations.upload(projectId)),
    },
    {
      icon: "smart",
      title: t`Run a model`,
      text:
        slidesWithoutResults > 0
          ? t`${plural(slidesWithoutResults, "slide")} ${slidesWithoutResults === 1 ? "has" : "have"} no results yet`
          : t`Every slide has results`,
      run: () => void goTo(destinations.runModel(projectId)),
    },
    {
      icon: "users",
      title: t`New review task`,
      text: t`Hand slides out to reviewers`,
      run: () => void goTo(destinations.newReviewTask(projectId)),
    },
    {
      icon: "search",
      title: t`Find an object`,
      text: t`A slide, a case or an ID like T2·C145`,
      run: () => void overlay.set("palette"),
    },
    {
      icon: "folder",
      title: t`New project`,
      text: t`Privacy, classes and a template`,
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
  const { t } = useLingui();

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
        {shown.map((slide) => (
          <span
            key={slide.id}
            className="relative aspect-square overflow-hidden rounded-lg bg-surf-section"
          >
            <SlideThumb
              slideId={slide.id}
              file={slide.label}
              className="absolute inset-0 size-full"
            />
            <i
              className={`absolute right-1.25 bottom-1.25 size-2.25 rounded-full shadow-[0_0_0_2px_rgba(255,255,255,.9)] ${slide.reviewed ? "bg-decision-agree" : "bg-[rgba(120,120,120,.85)]"}`}
            />
          </span>
        ))}
        {more > 0 ? (
          <span className="grid aspect-square place-content-center justify-items-center gap-px rounded-lg bg-surf-section text-fg-dim">
            <b className="font-mono text-lead font-semibold text-fg">+{more}</b>
            <small className="text-caption">
              <Trans>slides</Trans>
            </small>
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
          <Trans>
            {project.code} · {project.slides} slides · {project.result_sets} result sets
          </Trans>
        </small>
        <div className="flex items-center justify-between">
          {project.privacy_mode === "clinical" ? (
            <StatusTag tone="warn">
              <Trans>Clinical</Trans>
            </StatusTag>
          ) : (
            <StatusTag tone="accent">
              <Trans>De-identified</Trans>
            </StatusTag>
          )}
          {faces.length > 0 ? <AvatarStack people={faces} size={22} max={3} /> : null}
        </div>
        <ProgressBar value={reviewed} label={t`Reviewed`} valueText={`${reviewed}%`} />
      </div>
    </button>
  );
}

function ChecklistCard({ steps, onHide }: { steps: Checklist["steps"]; onHide: () => void }) {
  const { t } = useLingui();

  const goTo = useGoTo();
  const done = steps.filter((step) => step.done).length;
  return (
    <section
      aria-label={t`Getting started`}
      className="grid gap-2 rounded-xl border border-accent bg-accent-soft p-3.5"
    >
      <div className="flex items-center justify-between">
        <b className="text-body font-semibold text-fg">
          <Trans>Getting started</Trans>
        </b>
        <span className="font-mono text-caption text-fg-dim">
          <Trans>
            {done} of {steps.length}
          </Trans>
        </span>
      </div>
      <ProgressBar value={percent(done, steps.length)} aria-label={t`Getting started`} />
      {steps.map((step) =>
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
              const target = stepTarget(step.key);
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
      <Button variant="link" className="justify-self-start" onClick={onHide}>
        <Trans>Hide the checklist</Trans>
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
  const { t } = useLingui();

  const goTo = useGoTo();
  return (
    <SideCard
      title={t`This week in your projects`}
      end={
        taskId ? (
          <Button variant="link" onClick={() => void goTo(destinations.evaluation(taskId))}>
            <Trans>Evaluation</Trans>
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
            <Trans>objects you checked</Trans>
          </small>
        </div>
        <div>
          <b className="block font-mono text-page-title leading-[1.1] font-semibold text-decision-agree">
            {Math.round((week.agree_share ?? 0) * 100)}%
          </b>
          <small className="mt-1 block text-caption leading-[1.3] text-fg-dim">
            <Trans>agree with the AI</Trans>
          </small>
        </div>
        <div>
          <button
            type="button"
            onClick={() => (taskId ? void goTo(destinations.disagreements(taskId)) : undefined)}
            className="block cursor-pointer border-0 bg-transparent p-0 font-mono text-page-title leading-[1.1] font-semibold text-decision-disagree"
          >
            {week.open_disagreements ?? 0}
          </button>
          <small className="mt-1 block text-caption leading-[1.3] text-fg-dim">
            <Trans>disagreements open</Trans>
          </small>
        </div>
      </div>
    </SideCard>
  );
}

function ComingUp({ tasks, projects }: { tasks: MyTask[]; projects: HomeProject[] }) {
  const { t } = useLingui();

  const goTo = useGoTo();
  const people = usePeople();
  const active = tasks.filter(
    (task) => task.status === "in-review" || task.status === "not-started",
  );
  const colourOf = (id: string) =>
    projectColour(projects.find((project) => project.id === id)?.colour ?? 0);
  return (
    <SideCard
      title={t`Coming up`}
      end={
        <Button variant="link" onClick={() => void goTo(destinations.myWork())}>
          <Trans>My work</Trans>
        </Button>
      }
    >
      {active.map((task) => {
        const progress =
          task.slides_submitted > 0
            ? t`${task.slides_submitted} of ${task.slides_assigned} done`
            : t`New from ${people(task.created_by_user_id)?.name ?? "a researcher"}`;
        return (
          <DotRow
            key={task.id}
            colour={colourOf(task.project.id)}
            title={task.name}
            sub={`${progress}${task.due_on ? t` · due ${formatDue(task.due_on)}` : ""}`}
            onClick={() => void goTo(destinations.guided(task.id, task.next_slide_id))}
          />
        );
      })}
      {active.length === 0 ? (
        <span className="text-body-sm text-fg-dim">
          <Trans>Nothing due. New tasks show here.</Trans>
        </span>
      ) : null}
    </SideCard>
  );
}

function HomeSkeletonBody({ label }: { label: string }) {
  return (
    <div
      data-testid="home-skeleton"
      className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6"
    >
      <div className="rounded-xl border border-line bg-chrome">
        <SkeletonRows label={label} rows={4} columns={2} />
      </div>
      <div aria-hidden="true" className="rounded-xl border border-line bg-chrome">
        <SkeletonRows label={label} rows={3} columns={1} />
      </div>
    </div>
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
  const { t } = useLingui();

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
        <HomeSkeletonBody label={t`Loading your home`} />
      ) : kind === "forbidden" ? (
        <section
          aria-label={t`No workspace yet`}
          className="grid max-w-xl gap-3 rounded-xl border border-line bg-chrome p-4"
        >
          <b className="text-body font-semibold text-fg">
            <Trans>You are not in a workspace yet</Trans>
          </b>
          <span className="text-body-sm text-fg-dim">
            <Trans>
              Your projects, tasks and slides show here once you join one. Open the invitation from
              your email, or set up a workspace of your own.
            </Trans>
          </span>
          <Button className="justify-self-start" onClick={() => void goTo("/setup")}>
            <Trans>Set up a workspace</Trans>
          </Button>
        </section>
      ) : (
        <section
          aria-label={t`Home did not load`}
          role="alert"
          className="grid max-w-xl gap-3 rounded-xl border border-line bg-chrome p-4"
        >
          <b className="text-body font-semibold text-fg">
            <Trans>Your home could not load</Trans>
          </b>
          <span className="text-body-sm text-fg-dim">
            <Trans>Nothing is lost. Try again, or open My work from the sidebar.</Trans>
          </span>
          <Button className="justify-self-start" onClick={retry}>
            <Trans>Try again</Trans>
          </Button>
        </section>
      )}
    </main>
  );
}

export function HomeScreen() {
  const { t } = useLingui();

  const me = okData(useGetMe().data);
  useWorklistLive(me?.user_id);
  const homeQuery = useGetMyHome();
  const home = okData(homeQuery.data);
  const checklist = okData(useGetMyChecklist().data);
  const counts = okData(useGetNotificationCounts().data);
  const projects = okData(useListProjects().data) ?? [];
  const goTo = useGoTo();
  const queryClient = useQueryClient();
  const tried = useTried();
  const layersQuery = useGetMySettingLayers();
  const layers = okData(layersQuery.data);
  const saveLayers = useSetMySettingLayers({
    mutation: {
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() }),
    },
  });
  if (me === undefined || layersQuery.isPending) {
    return (
      <main className="grid content-start gap-(--density-page-gap) px-8 pt-5.5 pb-4.5 pl-7">
        <div className="grid gap-2">
          <SkeletonLine width="18rem" className="text-page-title" />
          <SkeletonLine width="12rem" className="text-body-sm" />
        </div>
        <HomeSkeletonBody label={t`Loading your home`} />
      </main>
    );
  }
  const firstName = greetingName(me);
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
  const checklistSteps = stepsWithTried(checklist?.steps ?? [], tried);
  const firstWeek =
    checklist !== undefined &&
    checklistShows({
      serverHidden: checklist.hidden,
      personalHidden: layers?.personal.getting_started_hidden === true,
      steps: checklistSteps,
    });
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
    ? t`your sample project is ready`
    : [
        t`${plural(inProgress, "task")} in progress`,
        mentions > 0 ? plural(mentions, "mention") : null,
        home.resume?.due_on
          ? t`${shortName(home.resume)} due ${formatWeekday(home.resume.due_on)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
  const membersOf = (id: string) => projects.find((project) => project.id === id)?.members ?? [];
  const firstProjectId = projects[0]?.id ?? "";
  const main: Record<HomeBlock, ReactNode> = {
    continue: (
      <>
        <Section>{firstWeek ? t`Start here` : t`Continue where you left off`}</Section>
        {home.resume ? (
          <ResumeHero resume={home.resume} />
        ) : firstWeek && checklist?.sample_project ? (
          <SampleHero sample={checklist.sample_project} firstProjectId={firstProjectId} />
        ) : (
          <p className="text-body-sm text-fg-dim">
            <Trans>Nothing in progress. Start something</Trans>{" "}
            {homeBlocks[layout].indexOf("start") > homeBlocks[layout].indexOf("continue")
              ? t`below`
              : t`above`}
            .
          </p>
        )}
      </>
    ),
    start: (
      <>
        <Section>
          <Trans>Start something</Trans>
        </Section>
        <QuickActions
          slidesWithoutResults={home.slides_without_results}
          projectId={firstProjectId}
        />
      </>
    ),
    projects: (
      <>
        <div className="flex items-center justify-between">
          <Section>
            <Trans>Projects</Trans>
          </Section>
          <Button variant="link" onClick={() => void goTo(destinations.newProject())}>
            <Trans>New project</Trans>
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
          {firstWeek ? t`Welcome to Parfocal, ${firstName}` : `${greeting(today)}, ${firstName}`}
        </h1>
        <p className="mt-1 mb-0 text-body-sm leading-[1.45] text-fg-dim">
          {formatLongDay(today)} · {summary}
        </p>
      </header>
      <div ref={setTourOfferSlot} className="empty:hidden" />
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
            <ChecklistCard
              steps={checklistSteps}
              onHide={() =>
                saveLayers.mutate({ data: { values: { getting_started_hidden: true } } })
              }
            />
          ) : (
            sideBlocks[layout].map((block) => <Fragment key={block}>{side[block]}</Fragment>)
          )}
          <ActivityCard />
          <Announcements items={home.announcements} firstWeek={firstWeek} canPost={canPost} />
        </aside>
      </div>
    </main>
  );
}
