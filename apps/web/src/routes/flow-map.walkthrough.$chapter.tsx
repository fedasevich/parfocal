import { PersonAvatar } from "@parfocal/ui/components/person";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { originStore, usePeople, useScenarioIds } from "../flow-map/hooks.ts";
import { stepLink } from "../flow-map/prototype-bar.tsx";
import { personaRoles } from "../flow-map/review-flow.ts";
import { WalkBar } from "../flow-map/walk-bar.tsx";
import { chapters, stepRole, stepWho } from "../flow-map/walkthrough.ts";

export const Route = createFileRoute("/flow-map/walkthrough/$chapter")({
  beforeLoad: ({ params }) => {
    if (!import.meta.env.DEV) throw notFound();
    const index = Number(params.chapter) - 1;
    if (!Number.isInteger(index) || chapters[index] === undefined) throw notFound();
  },
  component: ChapterPage,
});

function ChapterPage() {
  const params = Route.useParams();
  const index = Number(params.chapter) - 1;
  const chapter = chapters[index];
  const ids = useScenarioIds();
  const people = usePeople();
  useEffect(() => originStore.set(null), []);
  if (chapter === undefined) return null;
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-8">
      <Link to="/flow-map" className="text-accent text-body-sm underline">
        Back to the map
      </Link>
      <WalkBar current={index} />
      <h1 className="font-semibold text-2xl text-fg">
        {index + 1} · {chapter.title}
      </h1>
      <p className="text-body-sm text-fg-dim">{chapter.shows}</p>
      <ol className="flex flex-col gap-2" aria-label="Steps">
        {chapter.steps.map((step, stepIndex) => {
          const ref = { chapter: index, step: stepIndex };
          const who = stepWho(ref) ?? chapter.who;
          const link = ids ? stepLink(ref, ids) : null;
          return (
            <li
              key={step.text}
              className="flex items-start gap-3 rounded-zone border border-line bg-chrome p-3"
            >
              <span className="w-6 shrink-0 font-semibold text-body-sm text-fg-dim">
                {stepIndex + 1}
              </span>
              <PersonAvatar person={people(who)} size={20} />
              <div className="flex flex-1 flex-col gap-1">
                <p className="m-0 text-body-sm text-fg">{step.text}</p>
                <small className="text-caption text-fg-faint">
                  As {people(who).name}, {stepRole(ref, personaRoles)} · {step.screen}
                  {step.scene ? `, ${step.scene}` : ""}
                </small>
              </div>
              {link ? (
                <Link
                  {...link}
                  className="shrink-0 rounded-md border border-line px-2.5 py-1 text-body-sm text-fg no-underline hover:border-accent"
                  onClick={() => {
                    if (ids) originStore.set({ kind: "walk", ...ref, ids });
                  }}
                >
                  Open step {stepIndex + 1}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>
    </main>
  );
}
