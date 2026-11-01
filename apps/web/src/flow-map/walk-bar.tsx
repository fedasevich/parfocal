import { cn } from "@parfocal/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { originStore, useScenarioIds } from "./hooks.ts";
import { stepLink } from "./prototype-bar.tsx";
import { chapters, stepCount } from "./walkthrough.ts";

const chapterClass =
  "rounded-full border border-line bg-chrome px-2.5 py-1 text-caption text-fg-dim no-underline hover:border-line-strong hover:text-fg";

export function WalkBar({ current }: { current?: number }) {
  const ids = useScenarioIds();
  const first = ids ? stepLink({ chapter: 0, step: 0 }, ids) : null;
  return (
    <nav aria-label="Walkthrough" className="flex flex-wrap items-center gap-1">
      {first ? (
        <Link
          {...first}
          className="mr-1 rounded-lg border border-accent bg-accent-soft px-3 py-1 text-body-sm text-fg no-underline"
          onClick={() => {
            if (ids) originStore.set({ kind: "walk", chapter: 0, step: 0, ids });
          }}
        >
          Play all, from upload to the signed report
        </Link>
      ) : null}
      {chapters.map((chapter, index) => (
        <Link
          key={chapter.title}
          to="/flow-map/walkthrough/$chapter"
          params={{ chapter: String(index + 1) }}
          className={cn(chapterClass, current === index && "border-accent bg-accent-soft text-fg")}
        >
          {index + 1} · {chapter.title}
        </Link>
      ))}
      <Link
        to="/flow-map/walkthrough"
        className="ml-2 text-caption text-fg-faint underline"
        title={`${stepCount} steps in ${chapters.length} chapters`}
      >
        All chapters
      </Link>
    </nav>
  );
}
