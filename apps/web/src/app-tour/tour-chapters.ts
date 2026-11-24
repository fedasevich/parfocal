import { msg } from "@lingui/core/macro";
import type { TourAdvance, TourChapter } from "./tour-steps.ts";

const next: TourAdvance = { kind: "next" };

const scanner = "Scanner format comparison";
const sentinel = "{project:Sentinel node metastasis study}";
const gallery = `{project:${scanner}}`;
const slideOf = (label: string) => `/projects/${gallery}/slides/{slide:${scanner}|${label}}`;
const smallRegion = slideOf("CMU-1-Small-Region.svs");

const reviewName = "Role account review";
const reviewSlide = (query: string) =>
  `/projects/{task_project:${reviewName}}/slides/{task_slide:${reviewName}|1}?task={task:${reviewName}}&${query}`;

const annotationName = "Role account annotation";
const annotateSlide = `/projects/{task_project:${annotationName}}/slides/{task_slide:${annotationName}|1}?task={task:${annotationName}}&mode=annotate`;

const queueName = "Disagreement queue example";
const queue = `/tasks/{task:${queueName}}/disagreements`;
const doneName = "Every outcome review";
const draftReport =
  "/projects/{case_project:Showcase draft report}/cases/{case:Showcase draft report}/report";
const coSign = "/projects/{case_project:Showcase co-sign}/cases/{case:Showcase co-sign}/co-sign";
const flowMain = '[data-slot="flow-main"]';

export const moreChapters: TourChapter[] = [
  {
    title: msg`Projects and their settings`,
    role: "researcher",
    steps: [
      {
        route: "/",
        anchor: "top-new-project",
        text: msg`New project asks for a name and who may see it. Nothing is made until you press Create. The sample project is a quick way to try the app.`,
        advance: next,
      },
      {
        route: `/projects/${sentinel}`,
        anchor: "project-tabs",
        text: msg`A project page has three tabs, Slides, Review tasks and Settings. The numbers on the tabs count what is inside.`,
        advance: next,
      },
      {
        route: `/projects/${sentinel}?tab=slides`,
        anchor: "#slides-table",
        text: msg`Slides lists every slide with its stain, its AI results and its review state. Press a slide to open it, or tick two to compare them.`,
        advance: next,
      },
      {
        route: `/projects/${sentinel}?tab=tasks`,
        anchor: "#task-row|main",
        text: msg`Review tasks lists what was handed out, with progress per reviewer. A task opens its queue, its sign off and its dataset.`,
        advance: next,
      },
      {
        route: `/projects/${sentinel}?tab=settings`,
        anchor: "#project-settings",
        text: msg`Settings holds the classes, the people with their roles, the result sets and the danger zone for archiving or deleting the project.`,
        advance: next,
      },
      {
        route: `/projects/${sentinel}?tab=settings`,
        anchor: "#project-settings|main",
        role: "viewer",
        text: msg`A viewer sees the same page without the controls. Changing a project needs an owner, so the buttons are read only here.`,
        advance: next,
      },
    ],
  },
  {
    title: msg`The viewer and its tabs`,
    role: "researcher",
    steps: [
      {
        route: smallRegion,
        anchor: "#live-top-bar",
        text: msg`The top bar names the slide and carries the mode switch, the slide picker, Export and the share and help buttons. Back returns to the project.`,
        advance: next,
      },
      {
        route: smallRegion,
        anchor: "#magnification-bar",
        text: msg`The magnification bar zooms the slide. Whole slide fits it to the window and the numbers jump to a power such as 10x or 40x.`,
        advance: next,
      },
      {
        route: `${smallRegion}?tab=objects`,
        anchor: "#inspector-objects",
        text: msg`The Objects tab lists what the AI found on this slide. Press an object to fly to it. Filters narrow the list by class and confidence.`,
        advance: next,
      },
      {
        route: `${smallRegion}?tab=display`,
        anchor: "#inspector-display",
        text: msg`The Display tab changes how the slide looks, such as the AI layer, the colours of the classes and the outline style. It never changes the data.`,
        advance: next,
      },
      {
        route: `${smallRegion}?tab=comments`,
        anchor: "#stage-comments",
        text: msg`The Comments tab holds the threads pinned to places on the slide. Reply, mention a colleague with @ and resolve a thread when it is answered.`,
        advance: next,
      },
      {
        route: `${smallRegion}?tab=objects`,
        anchor: '[data-slot="tool-rail"]',
        text: msg`The tool rail holds the tools. Measure draws a ruler, Compare opens a second slide, and the drawing tools appear when a task asks for them.`,
        advance: next,
      },
      {
        route: `${smallRegion}?tab=objects`,
        anchor: "#rail-compare",
        text: msg`Compare puts a second slide beside this one with one shared camera, so a slide and its twin are read together.`,
        advance: next,
      },
      {
        route: `${slideOf("CMU-1.tiff")}?layout=compare`,
        anchor: "#slide-stage",
        text: msg`This is the compare layout. Both slides move together, and the minimap shows where you are on the whole slide.`,
        advance: next,
      },
      {
        route: `${smallRegion}?mode=annotate`,
        anchor: "#slide-stage",
        role: "viewer",
        text: msg`A viewer can look and move around but not draw. Drawing tools and decisions stay off for anyone who is not on a task.`,
        advance: next,
      },
    ],
  },
  {
    title: msg`Annotate as an expert`,
    role: "annotator",
    steps: [
      {
        route: annotateSlide,
        anchor: "#annotate-task-panel|#live-top-bar",
        text: msg`An annotate task gives an expert a slide to draw on. The task panel shows what is asked and how many objects are checked.`,
        advance: next,
      },
      {
        route: annotateSlide,
        anchor: "#slide-stage",
        text: msg`Draw an outline or place a cell on the slide, pick its class, and edit any imported or AI object. Every change saves at once.`,
        advance: next,
      },
      {
        route: annotateSlide,
        anchor: "#start-run|#annotate-task-panel|#live-top-bar",
        gpu: true,
        text: msg`Smart select, Auto region and Find nuclei call the GPU. They can wait for an EU GPU to free up. Skip this step if you do not want to wait.`,
        advance: next,
      },
      {
        route: annotateSlide,
        anchor: "#export-menu|#live-top-bar",
        text: msg`Export saves the objects of this slide, or the training dataset of the task, as patches with masks or a COCO file.`,
        advance: next,
      },
      {
        route: annotateSlide,
        anchor: "#mark-slide-checked|#annotate-task-panel|#live-top-bar",
        text: msg`Mark slide checked tells the task you looked at everything. Groups and select all help with many objects at once.`,
        advance: next,
      },
      {
        route: annotateSlide,
        anchor: "#slide-stage",
        role: "viewer",
        text: msg`Someone who is not on the task sees the slide read only, with a notice that says so. Nothing they press changes the layer.`,
        advance: next,
      },
    ],
  },
  {
    title: msg`Create a review task`,
    role: "researcher",
    steps: [
      {
        route: `/projects/${sentinel}/tasks/new?step=kind`,
        anchor: '[data-slot="stepper"]',
        text: msg`The task wizard has six steps, shown here. The first asks for the kind, a review of AI results or an annotate task for experts.`,
        advance: next,
      },
      {
        route: `/projects/${sentinel}/tasks/new?step=slides`,
        anchor: flowMain,
        text: msg`Slides and the AI result. Pick the slides and the result set the reviewers will judge.`,
        advance: next,
      },
      {
        route: `/projects/${sentinel}/tasks/new?step=reviewers`,
        anchor: flowMain,
        text: msg`Reviewers. Choose who reviews, whether they work blind and who adjudicates a disagreement.`,
        advance: next,
      },
      {
        route: `/projects/${sentinel}/tasks/new?step=check`,
        anchor: flowMain,
        text: msg`What to check. Choose the classes and the confidence range, and whether reviewers also fill in an opinion form.`,
        advance: next,
      },
      {
        route: `/projects/${sentinel}/tasks/new?step=how`,
        anchor: flowMain,
        text: msg`How it runs. Set the order of the objects, the due date and what reviewers see first.`,
        advance: next,
      },
      {
        route: `/projects/${sentinel}/tasks/new?step=send`,
        anchor: '[data-slot="flow-bar-dock"]|main',
        text: msg`Send lists what is still missing. The button stays off until every step is complete, so nothing half made reaches a reviewer.`,
        advance: next,
      },
      {
        route: `/projects/${gallery}/tasks/new-annotate?step=kind&preset=hand`,
        anchor: flowMain,
        text: msg`The annotate wizard is shorter. Pick the slides, the experts and the classes, and the AI objects each expert must check.`,
        advance: next,
      },
      {
        route: "/my-work?tab=assigned",
        anchor: "my-work-tabs",
        text: msg`Assigned by me lists everything you handed out, so you can follow each task without opening the project.`,
        advance: next,
      },
    ],
  },
  {
    title: msg`Review as reviewer B and as a viewer`,
    role: "reviewer-b",
    steps: [
      {
        route: reviewSlide("mode=guided"),
        stay: /mode=guided|\/guided/,
        anchor: "decision-buttons|main",
        text: msg`Reviewer B reviews the same objects alone, without seeing reviewer A. Blind review is what makes a disagreement mean something.`,
        advance: next,
      },
      {
        route: "/my-work?tab=all",
        anchor: "my-work-tabs",
        text: msg`Reviewer B finds the task and every slide in My work, with its own progress.`,
        advance: next,
      },
      {
        route: reviewSlide("mode=review&tab=opinion"),
        anchor: "#stage-opinion|#slide-stage",
        role: "reviewer-a",
        text: msg`The opinion form asks the questions the task set, one answer per slide. It sits next to the objects in the full viewer.`,
        advance: next,
      },
      {
        route: reviewSlide("mode=review"),
        anchor: "#top-submit|#live-top-bar",
        role: "reviewer-a",
        text: msg`Submit the slide sends your decisions. Once every reviewer submitted, the disagreements reach the queue.`,
        advance: next,
      },
      {
        route: reviewSlide("mode=review"),
        anchor: "#slide-stage",
        role: "viewer",
        text: msg`A viewer who is not on the task can read the review but not change it. The notice says so.`,
        advance: next,
      },
      {
        route: `/projects/{task_project:Signed-off review}/slides/{task_slide:Signed-off review|1}?task={task:Signed-off review}&mode=review`,
        anchor: "#slide-stage",
        role: "owner",
        text: msg`A signed off task is locked. Its layer shows as it was frozen, and an owner can reopen the task with a reason.`,
        advance: next,
      },
    ],
  },
  {
    title: msg`The queue and adjudication`,
    role: "researcher",
    steps: [
      {
        route: queue,
        anchor: '[data-slot="table-container"]',
        text: msg`The disagreement queue lists every object where reviewers differ, one row each. Tick rows to act on several at once.`,
        advance: next,
      },
      {
        route: queue,
        anchor: '[data-slot="evidence-list"]|[data-slot="table-container"]',
        text: msg`Press a row to see the evidence. It shows both reviewers' answers, their notes and what the AI said.`,
        advance: next,
      },
      {
        route: queue,
        anchor: 'decision-buttons|[data-slot="table-container"]',
        text: msg`Decide the row by agreeing with one reviewer, choosing a class or drawing the outline again. The decision becomes the final answer.`,
        advance: next,
      },
      {
        route: queue,
        anchor: 'queue-send|[data-slot="table-container"]',
        text: msg`Leave a row open, or ask the reviewers to look again. Send to an adjudicator hands the ticked rows to one person.`,
        advance: next,
      },
      {
        route: `/tasks/{task:Role account review}/disagreements`,
        anchor: '[data-slot="table-container"]|main',
        text: msg`Before everyone submitted the queue is empty. It says who is still missing instead of showing half a picture.`,
        advance: next,
      },
      {
        route: "/my-work",
        anchor: "my-work-tabs",
        role: "adjudicator",
        text: msg`The adjudicator finds the rows sent to them in My work, apart from the tasks they review.`,
        advance: next,
      },
      {
        route: "/tasks/{adj_task:adjudicator}/adjudicate",
        anchor: 'main|[data-slot="review-top-bar"]',
        role: "adjudicator",
        text: msg`The adjudicator sees only the rows asked for and decides each. The result flows back into the queue.`,
        advance: next,
      },
      {
        route: `/tasks/{task:${queueName}}/adjudicate`,
        anchor: 'main|[data-slot="review-top-bar"]',
        role: "reviewer-a",
        text: msg`Anyone else who opens the page finds nothing to adjudicate, and the page says so.`,
        advance: next,
      },
    ],
  },
  {
    title: msg`Sign off, evaluation and dataset`,
    role: "researcher",
    steps: [
      {
        route: `/tasks/{task:${queueName}}/sign-off`,
        anchor: "#sign-off-undecided|#sign-off-metrics|main",
        text: msg`Sign off is blocked while a row is undecided. The page lists what blocks it and links to each row.`,
        advance: next,
      },
      {
        route: `/tasks/{task:${doneName}}/sign-off`,
        anchor: "#sign-off-metrics|main",
        role: "owner",
        text: msg`A signed task shows its numbers, who signed and when. Sign off freezes the review and builds the final layer.`,
        advance: next,
      },
      {
        route: `/tasks/{task:${doneName}}/evaluation`,
        anchor: '[data-slot="report-sheet"]|main',
        role: "owner",
        text: msg`The evaluation report compares the AI with the final answers. Share it by link or export a PDF from the bar above it.`,
        advance: next,
      },
      {
        route: `/tasks/{task:${doneName}}/evaluation`,
        anchor: '[data-slot="metric-tiles"]|main',
        role: "owner",
        text: msg`The tiles give the agreement and the error counts. The table beneath shows each class and where the AI and the final answers part.`,
        advance: next,
      },
      {
        route: `/tasks/{task:${doneName}}/dataset`,
        anchor: "#dataset-versions|#dataset-screen|main",
        role: "owner",
        text: msg`The dataset page holds the final layer and the frozen versions. A version never changes after it is frozen.`,
        advance: next,
      },
      {
        route: `/tasks/{task:${doneName}}/dataset`,
        anchor: "#dataset-patch-exports|#dataset-screen|main",
        role: "owner",
        text: msg`Patch exports make the training files, patches with masks and a COCO file, from a frozen version.`,
        advance: next,
      },
      {
        route: `/tasks/{task:Role account review}/dataset`,
        anchor: "#dataset-refusal|#dataset-screen|main",
        text: msg`There is no dataset before sign off. The page says what is missing instead of showing an empty table.`,
        advance: next,
      },
    ],
  },
  {
    title: msg`Cases and reports`,
    role: "owner",
    steps: [
      {
        route: "/projects/{project:Breast surgery sentinel nodes}/cases/new",
        anchor: "main",
        text: msg`A clinical project groups slides into cases. New case takes a label and the slides that belong together.`,
        advance: next,
      },
      {
        route: `${draftReport}?step=findings`,
        anchor: "#clinical-report|main",
        text: msg`The report is a four step form. Findings records what was seen on each slide, with the AI results beside it.`,
        advance: next,
      },
      {
        route: `${draftReport}?step=staging`,
        anchor: "#clinical-report|main",
        text: msg`Staging sums several deposits into one stage, and shows how the number was reached.`,
        advance: next,
      },
      {
        route: `${draftReport}?step=text`,
        anchor: "#clinical-report|main",
        text: msg`The report text is drafted from the findings and stays editable until it is signed.`,
        advance: next,
      },
      {
        route: `${draftReport}?step=sign`,
        anchor: '[data-slot="flow-bar-dock"]|#clinical-report|main',
        text: msg`Sign out the report yourself, or send it to a colleague for co-sign. A signed report cannot be changed.`,
        advance: next,
      },
      {
        route: coSign,
        anchor: "#co-sign|main",
        text: msg`A colleague asked to co-sign sees the report and signs or sends it back.`,
        advance: next,
      },
      {
        route: coSign,
        anchor: "#co-sign|main",
        role: "researcher",
        text: msg`Only the person asked can co-sign. Anyone else gets a short refusal.`,
        advance: next,
      },
    ],
  },
  {
    title: msg`Jobs and model runs`,
    role: "researcher",
    steps: [
      {
        route: "/",
        anchor: '[data-slot="jobs-button"]|top-search',
        text: msg`The jobs button counts what runs in the background, such as uploads and model runs. Press it for each job and its progress.`,
        advance: next,
      },
      {
        route: "/projects/{job_project}/jobs/{job}",
        anchor: "main",
        role: "owner",
        text: msg`A job has its own window with a progress bar, the time left and what it is doing. Closing it never stops the job.`,
        advance: next,
      },
      {
        route: `/projects/${gallery}/run-model`,
        anchor: "main",
        text: msg`Run a model asks for the model, the slides and the area. It shows what the run will cost in time before it starts.`,
        advance: next,
      },
      {
        route: `/projects/${gallery}/run-model`,
        anchor: "main",
        gpu: true,
        text: msg`Starting a run uses the GPU. It can wait for a free EU GPU, and the wait is shown, not an error. Skip this step if you only look.`,
        advance: next,
      },
      {
        route: "/kpi",
        anchor: "main",
        text: msg`Task timing shows how long reviews take, per task and per reviewer, so the next task can be sized.`,
        advance: next,
      },
    ],
  },
  {
    title: msg`Search`,
    role: "researcher",
    steps: [
      {
        route: "/",
        anchor: "top-search",
        text: msg`The search box in the top bar opens from anywhere, also with Command K. It finds slides, cases, IDs such as T2 and people.`,
        advance: next,
      },
      {
        route: "/search?q=CMU",
        anchor: "search-input",
        text: msg`The search page shows the whole result list for what you typed.`,
        advance: next,
      },
      {
        route: "/search?q=CMU",
        anchor: "search-scope",
        text: msg`Scope narrows the list to slides, cases, tasks or people.`,
        advance: next,
      },
      {
        route: "/search?q=C",
        anchor: "search-input",
        text: msg`One letter is too short to search, and the page says so.`,
        advance: next,
      },
      {
        route: "/search?q=zzqqxx",
        anchor: "main",
        text: msg`When nothing matches, the page says so and offers to clear the search.`,
        advance: next,
      },
      {
        route: "/search?q=Case",
        anchor: "search-scope",
        role: "viewer",
        text: msg`A viewer searches only what they may see, so the lists are shorter.`,
        advance: next,
      },
    ],
  },
  {
    title: msg`Notifications and comments`,
    role: "adjudicator",
    steps: [
      {
        route: "/",
        anchor: "bell",
        text: msg`The bell counts what is new, such as mentions, replies, tasks and finished jobs. Press it for the latest.`,
        advance: next,
      },
      {
        route: "/notifications",
        anchor: "notifications-list|main",
        text: msg`The notifications page lists them all, newest first. Press one to open its target.`,
        advance: next,
      },
      {
        route: "/notifications",
        anchor: "notifications-mark-all",
        text: msg`Mark all read clears the bell. You can also mute a kind of notification in the settings.`,
        advance: next,
      },
      {
        route: "/go/00000000-0000-0000-0000-000000000000",
        anchor: "main",
        role: "owner",
        text: msg`A notification whose target is gone shows a plain page with a way home.`,
        advance: next,
      },
      {
        route: reviewSlide("mode=review&tab=comments"),
        anchor: "#stage-comments",
        role: "reviewer-a",
        text: msg`Start a thread on the slide and mention a colleague with @. They are told, and the thread stays where the question arose.`,
        advance: next,
      },
      {
        route: "/team",
        anchor: "team-tabs",
        role: "researcher",
        text: msg`Team shows who has open work. Nudge a reviewer who is late, with one press.`,
        advance: next,
      },
      {
        route: "/settings/notifications",
        anchor: "settings-nav",
        role: "reviewer-b",
        text: msg`Choose what you are told about, and by which way, in the notification settings.`,
        advance: next,
      },
    ],
  },
  {
    title: msg`Team and settings`,
    role: "researcher",
    steps: [
      {
        route: "/team",
        anchor: "team-tabs",
        text: msg`Team lists open tasks and the finished ones, per project and per reviewer.`,
        advance: next,
      },
      {
        route: "/team?tab=done",
        anchor: "team-tabs",
        text: msg`Done keeps the finished tasks, so the workload of last month is still there.`,
        advance: next,
      },
      {
        route: "/settings",
        anchor: "settings-nav",
        role: "reviewer-a",
        text: msg`Settings open on Display. The list on the left holds Review, Layout, AI and confidence, Navigation, Shortcuts, Privacy and Account.`,
        advance: next,
      },
      {
        route: "/settings/review",
        anchor: "settings-nav",
        role: "reviewer-a",
        text: msg`Review and Layout set how the viewer behaves and where the panels sit.`,
        advance: next,
      },
      {
        route: "/settings/ai",
        anchor: "settings-nav",
        role: "reviewer-a",
        text: msg`AI and confidence set what the AI shows and from which confidence on.`,
        advance: next,
      },
      {
        route: "/settings/navigation",
        anchor: "settings-nav",
        role: "reviewer-a",
        text: msg`Navigation, devices and shortcuts fit the viewer to a mouse, a trackpad or a pen, and let you change any key.`,
        advance: next,
      },
      {
        route: "/settings/privacy",
        anchor: "settings-nav",
        role: "reviewer-a",
        text: msg`Privacy, the session and the account hold your sign in methods, the passkeys and what is kept about you.`,
        advance: next,
      },
      {
        route: "/",
        anchor: "account-menu",
        role: "reviewer-a",
        text: msg`The avatar menu has the theme, Settings, this tour and Log out.`,
        advance: next,
      },
    ],
  },
  {
    title: msg`Admin`,
    role: "owner",
    steps: [
      {
        route: "/admin",
        anchor: "admin-sections",
        text: msg`Admin is for workspace owners. The overview shows people, storage, models and what needs attention.`,
        advance: next,
      },
      {
        route: "/admin?section=people",
        anchor: "main",
        text: msg`People and roles. Invite people, change a role, and see what each role may do.`,
        advance: next,
      },
      {
        route: "/admin?section=projects",
        anchor: "main",
        text: msg`Projects in admin lists every project, also private ones, and the deleted ones that can still be restored.`,
        advance: next,
      },
      {
        route: "/admin?section=models",
        anchor: "main",
        text: msg`AI models and their use. Register a model, see who may run it and how often it ran.`,
        advance: next,
      },
      {
        route: "/admin?section=templates",
        anchor: "main",
        text: msg`Report templates are the layouts reports and evaluations are printed on.`,
        advance: next,
      },
      {
        route: "/admin?section=storage",
        anchor: "main",
        text: msg`Storage and sources show how much room slides take and which sources are connected.`,
        advance: next,
      },
      {
        route: "/admin?section=api",
        anchor: "main",
        text: msg`API and webhooks issue tokens for scripts and send events to other systems.`,
        advance: next,
      },
      {
        route: "/admin?section=audit",
        anchor: "main",
        text: msg`The audit log records who did what, and it cannot be edited.`,
        advance: next,
      },
      {
        route: "/admin?section=security",
        anchor: "main",
        text: msg`Security and workspace settings hold sign in rules, session length and retention.`,
        advance: next,
      },
      {
        route: "/admin",
        anchor: "main",
        role: "researcher",
        text: msg`Without admin rights the page refuses, and the sidebar has no Admin entry at all.`,
        advance: next,
      },
      {
        route: "/admin",
        anchor: "main",
        role: "reviewer-b",
        text: msg`A reviewer is refused too, with a message that names the missing right.`,
        advance: next,
      },
    ],
  },
  {
    title: msg`The participant study`,
    role: "owner",
    steps: [
      {
        route: "/study/console",
        anchor: "main|#study-screen",
        text: msg`The moderator console prepares a round. Edit the tasks, the goal of each and start the next round.`,
        advance: next,
      },
      {
        route: "/study",
        anchor: "#study-screen|main",
        text: msg`A participant starts with the consent and gets an anonymous code. No name is asked.`,
        advance: next,
      },
      {
        route: "/study",
        anchor: "#study-task-card|#study-screen|main",
        text: msg`Each task is a card with a pinned goal and a timer. The participant can give up, and that counts as a result.`,
        advance: next,
      },
      {
        route: "/study/console",
        anchor: "main|#study-screen",
        text: msg`Download the results and replay a session. The replay shows where the participant pointed and clicked.`,
        advance: next,
      },
    ],
  },
];
