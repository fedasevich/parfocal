import { useGetMyHome } from "@parfocal/api-client";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { okData } from "../screens/placeholder.tsx";

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
        <Entry note="Launchpad">
          <Link to="/">Home</Link>
        </Entry>
        {(["review", "assigned", "all"] as const).map((tab) => (
          <Entry key={tab} note={`My work, ${tab} tab`}>
            <Link to="/my-work" search={{ tab }}>
              My work · {tab}
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
