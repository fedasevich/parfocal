import { useLingui } from "@lingui/react/macro";
import { type ReviewEditVersion, useListReviewEditHistory } from "@parfocal/api-client";
import type { ProjectClass } from "@parfocal/ui/components/decision-buttons";
import { okData } from "../placeholder.tsx";
import { formatStamp } from "./object-comments.tsx";

export function useObjectEditHistory(
  taskId: string,
  slideId: string,
  object: string,
): ReviewEditVersion[] {
  const query = useListReviewEditHistory(taskId, slideId, object, undefined, {
    query: { enabled: Boolean(taskId && slideId && object) },
  });
  return okData(query.data) ?? [];
}

export function reshaped(versions: ReviewEditVersion[], index: number): boolean {
  const version = versions[index];
  if (!version?.geometry || version.change === "ai-original") return false;
  const before = versions[index - 1]?.geometry;
  return JSON.stringify(before ?? null) !== JSON.stringify(version.geometry);
}

export function ObjectEditHistory({
  versions,
  classes,
}: {
  versions: ReviewEditVersion[];
  classes: ProjectClass[];
}) {
  const { t } = useLingui();
  if (!versions.some((version) => version.change !== "ai-original")) return null;
  const changeWord = (version: ReviewEditVersion): string => {
    const related = version.related.join(", ");
    switch (version.change) {
      case "ai-original":
        return t`AI original`;
      case "edited":
        return version.deleted ? t`Deleted` : t`Changed`;
      case "cleared":
        return t`Back to the AI original`;
      case "restored":
        return t`Brought back`;
      case "split":
        return t`Split into ${related}`;
      case "part":
        return t`Made by splitting ${related}`;
      case "merged":
        return t`Merged with ${related}`;
      case "merged-into":
        return t`Merged into ${related}`;
    }
  };
  const className = (version: ReviewEditVersion): string | null =>
    version.class_name ?? classes.find((item) => item.id === version.class_id)?.name ?? null;
  return (
    <section aria-label={t`Edit history`} className="grid gap-1.5">
      <small className="text-body-sm font-semibold text-fg-dim">{t`Edit history`}</small>
      <ol data-testid="object-edit-history" className="m-0 grid list-none gap-1 p-0">
        {versions.map((version, index) => (
          <li
            key={`${version.object}-${version.change}-${version.changed_at ?? "ai"}`}
            data-change={version.change}
            className="flex flex-wrap items-baseline gap-x-2 text-body-sm text-fg"
          >
            <span className="font-mono text-caption text-fg-dim">{version.object}</span>
            <span>{changeWord(version)}</span>
            {className(version) ? <span className="text-fg-dim">{className(version)}</span> : null}
            {reshaped(versions, index) ? (
              <span className="text-fg-dim">{t`new outline`}</span>
            ) : null}
            {version.changed_at ? (
              <time dateTime={version.changed_at} className="ml-auto text-caption text-fg-dim">
                {formatStamp(version.changed_at)}
              </time>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
