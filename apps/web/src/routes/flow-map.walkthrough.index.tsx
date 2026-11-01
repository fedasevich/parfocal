import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { originStore, usePeople } from "../flow-map/hooks.ts";
import { personaRoles } from "../flow-map/review-flow.ts";
import { WalkBar } from "../flow-map/walk-bar.tsx";
import { chapters } from "../flow-map/walkthrough.ts";

export const Route = createFileRoute("/flow-map/walkthrough/")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: WalkthroughIndex,
});

function WalkthroughIndex() {
  const people = usePeople();
  useEffect(() => originStore.set(null), []);
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-8">
      <Link to="/flow-map" className="text-accent text-body-sm underline">
        Back to the map
      </Link>
      <h1 className="font-semibold text-2xl text-fg">Walkthrough, nine chapters</h1>
      <p className="text-body-sm text-fg-dim">
        The walkthrough follows the map from upload to the co-signed clinical report. Play all runs
        the chapters in order, and each chapter also starts on its own.
      </p>
      <WalkBar />
      <table className="w-full border-collapse text-body-sm" aria-label="Chapters">
        <thead>
          <tr className="border-line border-b text-left text-fg-dim">
            <th className="py-2 pr-3 font-medium">Chapter</th>
            <th className="py-2 pr-3 font-medium">As</th>
            <th className="py-2 pr-3 font-medium">Steps</th>
            <th className="py-2 font-medium">What it shows</th>
          </tr>
        </thead>
        <tbody>
          {chapters.map((chapter, index) => (
            <tr key={chapter.title} className="border-line border-b align-top text-fg">
              <td className="py-2 pr-3">
                <Link
                  to="/flow-map/walkthrough/$chapter"
                  params={{ chapter: String(index + 1) }}
                  className="text-accent underline"
                >
                  {index + 1} · {chapter.title}
                </Link>
              </td>
              <td className="py-2 pr-3">
                {people(chapter.who).name}, {chapter.role ?? personaRoles[chapter.who]}
              </td>
              <td className="py-2 pr-3">{chapter.steps.length}</td>
              <td className="py-2 text-fg-dim">{chapter.shows}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
