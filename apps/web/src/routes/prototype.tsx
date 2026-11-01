import { useGetMyHome } from "@parfocal/api-client";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { newTaskPrototypeScenes } from "../screens/new-task/prototype-scenes.ts";
import { okData } from "../screens/placeholder.tsx";
import { teamPrototypeScenes } from "../screens/team/prototype-scenes.ts";

export const Route = createFileRoute("/prototype")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: PrototypeIndex,
});

function Entry({ children, note }: { children: ReactNode; note: string }) {
  return (
    <li className="flex flex-col">
      <span className="text-accent underline">{children}</span>
      <small className="text-fg-faint">{note}</small>
    </li>
  );
}

function PrototypeIndex() {
  const home = useGetMyHome();
  const body = okData(home.data);
  const resume = body?.resume ?? null;
  const project = body?.projects[0];
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <h1 className="font-semibold text-2xl text-fg">Prototype index</h1>
      <p className="text-fg-dim text-sm">
        Every screen of the app, opened with the scenario's data. Only the dev build has this page.
      </p>
      <ul className="flex flex-col gap-2" aria-label="Screens">
        <Entry note="The four lanes, each box opens its screen in its scene">
          <Link to="/flow-map">How a review works</Link>
        </Entry>
        <Entry note="The nine chapters from upload to the co-signed clinical report">
          <Link to="/flow-map/walkthrough">Walkthrough</Link>
        </Entry>
        <Entry note="Launchpad">
          <Link to="/">Home</Link>
        </Entry>
        <Entry note="Lenka's first week, with the sample project and the checklist">
          <Link to="/" search={{ scene: "new" }}>
            Home · first week
          </Link>
        </Entry>
        <Entry note="Continue reviewing, your tasks, asks and mentions">
          <Link to="/my-work" search={{ tab: "review" }}>
            My work · To review
          </Link>
        </Entry>
        <Entry note="RT-14 opened in the preview on the right">
          <Link to="/my-work" search={{ scene: "preview" }}>
            My work · a task previewed
          </Link>
        </Entry>
        <Entry note="Anna Kopecká with three objects to adjudicate on RT-14">
          <Link to="/my-work" search={{ scene: "anna" }}>
            My work · Anna as adjudicator
          </Link>
        </Entry>
        <Entry note="Daniel Hruška's tasks with their reviewers">
          <Link to="/my-work" search={{ tab: "assigned" }}>
            My work · Assigned by me
          </Link>
        </Entry>
        <Entry note="Every slide across projects">
          <Link to="/my-work" search={{ tab: "all" }}>
            My work · All slides
          </Link>
        </Entry>
        <Entry note="A1 opened in the preview on the right">
          <Link to="/my-work" search={{ scene: "allpreview" }}>
            My work · a slide previewed
          </Link>
        </Entry>
        <Entry note="The bell open over My work">
          <Link to="/my-work" search={{ tab: "all", open: "notifications" }}>
            Notifications
          </Link>
        </Entry>
        <Entry note="⌘K with a search typed">
          <Link to="/my-work" search={{ open: "palette", find: "meas" }}>
            Command palette
          </Link>
        </Entry>
        {teamPrototypeScenes.map(({ scene, label, note }) => (
          <Entry key={scene} note={note}>
            <Link to="/team" search={{ scene }}>
              {label}
            </Link>
          </Entry>
        ))}
        {project &&
          newTaskPrototypeScenes.map(({ scene, modal, label, note }) => (
            <Entry key={`${scene}-${modal ?? ""}`} note={note}>
              <Link
                to="/projects/$projectId/tasks/new"
                params={{ projectId: project.id }}
                search={modal ? { scene, modal } : { scene }}
              >
                {label}
              </Link>
            </Entry>
          ))}
        {project && (
          <Entry note={`${project.code} with its slides tab`}>
            <Link to="/projects/$projectId" params={{ projectId: project.id }}>
              Project · {project.code}
            </Link>
          </Entry>
        )}
        {resume && (
          <>
            <Entry note={`${resume.task_code} at ${resume.object_id ?? "the first object"}`}>
              <Link
                to="/projects/$projectId/slides/$slideId"
                params={{ projectId: resume.project.id, slideId: resume.slide_id }}
                search={{ task: resume.task_id, object: resume.object_id ?? undefined }}
              >
                Slide · {resume.case_label} {resume.slide_label}
              </Link>
            </Entry>
            <Entry note={resume.task_name}>
              <Link
                to="/tasks/$taskId/guided"
                params={{ taskId: resume.task_id }}
                search={{ slide: resume.slide_id }}
              >
                Guided review · {resume.task_code}
              </Link>
            </Entry>
            <Entry note="Metrics for the task">
              <Link to="/tasks/$taskId/evaluation" params={{ taskId: resume.task_id }}>
                Evaluation report · {resume.task_code}
              </Link>
            </Entry>
          </>
        )}
        <Entry note="First-run setup">
          <Link to="/setup">Setup</Link>
        </Entry>
        <Entry note="Deep link to a settings section">
          <Link to="/settings/$section" params={{ section: "profile" }}>
            Settings · profile
          </Link>
        </Entry>
        <Entry note="Admin as its own page">
          <Link to="/admin">Admin</Link>
        </Entry>
      </ul>
    </main>
  );
}
