import { Trans, useLingui } from "@lingui/react/macro";
import { useGetMyHome, useListMySlides } from "@parfocal/api-client";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { annotateTaskPrototypeLinks } from "../screens/annotate-task/prototype-scenes.ts";
import { disagreementPrototypeLinks } from "../screens/disagreements/prototype-scenes.ts";
import { useJobsPrototypeLinks } from "../screens/jobs/prototype-scenes.ts";
import { newTaskPrototypeScenes } from "../screens/new-task/prototype-scenes.ts";
import { onboardingPrototypeLinks } from "../screens/onboarding/prototype-scenes.ts";
import { okData } from "../screens/placeholder.tsx";
import { projectPrototypeLinks } from "../screens/project/prototype-scenes.ts";
import { reviewPrototypeLinks } from "../screens/review/prototype-scenes.ts";
import {
  developerPrototypeScenes,
  settingsPrototypeScenes,
} from "../screens/settings/prototype-scenes.ts";
import { sectionOfScene } from "../screens/settings/sections.ts";
import { teamPrototypeScenes } from "../screens/team/prototype-scenes.ts";
import { viewerPrototypeLinks } from "../screens/viewer/prototype-scenes.ts";
import { toolPrototypeLinks } from "../screens/viewer-tools/prototype-scenes.ts";

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
  const { t } = useLingui();

  const home = useGetMyHome();
  const body = okData(home.data);
  const resume = body?.resume ?? null;
  const project = body?.projects[0];
  const slides = okData(useListMySlides().data)?.slides ?? [];
  const jobLinks = useJobsPrototypeLinks(project?.id);
  const clinicalProject = body?.projects.find((item) => item.privacy_mode === "clinical");
  const clinicalSlide = clinicalProject?.strip[0];
  const clinicalCase =
    clinicalProject && clinicalSlide
      ? { projectId: clinicalProject.id, slideId: clinicalSlide.id }
      : undefined;
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <h1 className="font-semibold text-page-title text-fg">
        <Trans>Prototype index</Trans>
      </h1>
      <p className="text-fg-dim text-body">
        <Trans>
          Every screen of the app, opened with the scenario's data. Only the dev build has this
          page.
        </Trans>
      </p>
      <ul className="flex flex-col gap-2" aria-label={t`Screens`}>
        <Entry note="The four lanes, each box opens its screen in its scene">
          <Link to="/flow-map">
            <Trans>How a review works</Trans>
          </Link>
        </Entry>
        <Entry note="The nine chapters from upload to the co-signed clinical report">
          <Link to="/flow-map/walkthrough">
            <Trans>Walkthrough</Trans>
          </Link>
        </Entry>
        <Entry note="Every error and empty state grouped by flow, each opens its own screen">
          <Link to="/issue-states">
            <Trans>Issue states</Trans>
          </Link>
        </Entry>
        <Entry note="Launchpad">
          <Link to="/">
            <Trans>Home</Trans>
          </Link>
        </Entry>
        <Entry note="Lenka's first week, with the sample project and the checklist">
          <Link to="/" search={{ scene: "new" }}>
            <Trans>Home · first week</Trans>
          </Link>
        </Entry>
        <Entry note="Continue reviewing, your tasks, asks and mentions">
          <Link to="/my-work" search={{ tab: "review" }}>
            <Trans>My work · To review</Trans>
          </Link>
        </Entry>
        <Entry note="RT-14 opened in the preview on the right">
          <Link to="/my-work" search={{ scene: "preview" }}>
            <Trans>My work · a task previewed</Trans>
          </Link>
        </Entry>
        <Entry note="Anna Kopecká with three objects to adjudicate on RT-14">
          <Link to="/my-work" search={{ scene: "anna" }}>
            <Trans>My work · Anna as adjudicator</Trans>
          </Link>
        </Entry>
        <Entry note="Daniel Hruška's tasks with their reviewers">
          <Link to="/my-work" search={{ tab: "assigned" }}>
            <Trans>My work · Assigned by me</Trans>
          </Link>
        </Entry>
        <Entry note="Every slide across projects">
          <Link to="/my-work" search={{ tab: "all" }}>
            <Trans>My work · All slides</Trans>
          </Link>
        </Entry>
        <Entry note="A1 opened in the preview on the right">
          <Link to="/my-work" search={{ scene: "allpreview" }}>
            <Trans>My work · a slide previewed</Trans>
          </Link>
        </Entry>
        <Entry note="The bell open over My work">
          <Link to="/my-work" search={{ tab: "all", open: "notifications" }}>
            <Trans>Notifications</Trans>
          </Link>
        </Entry>
        <Entry note="⌘K with a search typed">
          <Link to="/my-work" search={{ open: "palette", find: "meas" }}>
            <Trans>Command palette</Trans>
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
        {project &&
          projectPrototypeLinks(
            project.id,
            body?.projects.find((item) => item.privacy_mode === "clinical")?.id,
          ).map(({ key, label, note, link }) => (
            <Entry key={key} note={note}>
              <Link {...link}>{label}</Link>
            </Entry>
          ))}
        {jobLinks.map(({ key, label, note, link }) => (
          <Entry key={key} note={note}>
            <Link {...link}>{label}</Link>
          </Entry>
        ))}
        {project && (
          <Entry note={`${project.code} with its slides tab`}>
            <Link to="/projects/$projectId" params={{ projectId: project.id }}>
              <Trans>Project · {project.code}</Trans>
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
                <Trans>
                  Slide · {resume.case_label} {resume.slide_label}
                </Trans>
              </Link>
            </Entry>
            {viewerPrototypeLinks(
              resume.project.id,
              resume.task_id,
              resume.slide_id,
              slides.find((slide) => slide.label === "tumor_052")?.id,
              clinicalCase,
            ).map(({ key, label, note, link }) => (
              <Entry key={key} note={note}>
                <Link {...link}>{label}</Link>
              </Entry>
            ))}
            {toolPrototypeLinks(resume.project.id, resume.task_id, resume.slide_id).map(
              ({ key, label, note, link }) => (
                <Entry key={key} note={note}>
                  <Link {...link}>{label}</Link>
                </Entry>
              ),
            )}
            {annotateTaskPrototypeLinks(resume.project.id, resume.task_id, resume.slide_id).map(
              ({ key, label, note, link }) => (
                <Entry key={key} note={note}>
                  <Link {...link}>{label}</Link>
                </Entry>
              ),
            )}
            {reviewPrototypeLinks(
              resume.task_id,
              resume.slide_id,
              slides.find((slide) => slide.label === "tumor_052")?.id,
            ).map(({ key, label, note, link }) => (
              <Entry key={key} note={note}>
                <Link {...link}>{label}</Link>
              </Entry>
            ))}
            {disagreementPrototypeLinks(resume.task_id).map(({ key, label, note, link }) => (
              <Entry key={key} note={note}>
                <Link {...link}>{label}</Link>
              </Entry>
            ))}
          </>
        )}
        {onboardingPrototypeLinks.map(({ key, label, note, link }) => (
          <Entry key={key} note={note}>
            <Link {...link}>{label}</Link>
          </Entry>
        ))}
        {settingsPrototypeScenes.map(({ scene, label, note }) => (
          <Entry key={`settings-${scene}`} note={note}>
            <Link
              to="/settings/$section"
              params={{ section: sectionOfScene(scene) }}
              search={{ scene }}
            >
              {label}
            </Link>
          </Entry>
        ))}
        {developerPrototypeScenes.map(({ scene, label, note }) => (
          <Entry key={`developer-${scene}`} note={note}>
            <Link to="/developer" search={{ scene }}>
              {label}
            </Link>
          </Entry>
        ))}
      </ul>
    </main>
  );
}
