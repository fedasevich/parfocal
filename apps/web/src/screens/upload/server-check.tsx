import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { useEffect, useRef, useState } from "react";
import type { DroppedItem } from "../../upload/drop.ts";
import {
  checkSorting,
  type Duplicate,
  placeInputOf,
  type SortDifference,
} from "../../upload/place.ts";
import { DoneRow, ProblemZone } from "./check-step.tsx";
import type { LiveModel, LiveState } from "./live-model.ts";

export { placeAndUpload, placeInputOf } from "../../upload/place.ts";

export default function ServerCheck({
  projectId,
  model,
  state,
  startError,
  duplicates,
  onDuplicates,
  decide,
}: {
  projectId: string;
  model: LiveModel<DroppedItem>;
  state: LiveState;
  startError: boolean;
  duplicates: readonly Duplicate[];
  onDuplicates: (found: Duplicate[]) => void;
  decide: (path: string, choice: "skip" | "keep" | null) => void;
}) {
  const { t } = useLingui();

  const [differences, setDifferences] = useState<SortDifference[]>([]);
  const latest = useRef(() => placeInputOf(projectId, model, state));
  latest.current = () => placeInputOf(projectId, model, state);
  const report = useRef(onDuplicates);
  report.current = onDuplicates;
  const key = JSON.stringify([
    model.slides.map((slide) => `${slide.path}:${slide.size}`),
    model.results.map((result) => `${result.item.path}:${result.slide}:${result.left}`),
    state.pair,
    state.cases,
    state.duplicate,
  ]);
  useEffect(() => {
    if (key === "") return;
    let live = true;
    checkSorting(latest.current())
      .then((found) => {
        if (!live) return;
        setDifferences(found.differences);
        report.current(found.duplicates);
      })
      .catch(() => {
        if (live) setDifferences([]);
      });
    return () => {
      live = false;
    };
  }, [key]);
  return (
    <>
      {startError ? (
        <ProblemZone
          icon="x-circle"
          tag="Not started"
          tone="bad"
          title={t`The server could not place these files`}
          file="Nothing was uploaded"
          text="Your files stay as they are. Check your connection and press the upload button again."
          actions={null}
        />
      ) : null}
      {duplicates.map((duplicate) => {
        const choice = state.duplicate[duplicate.path];
        return choice === undefined ? (
          <ProblemZone
            key={duplicate.path}
            icon="layers"
            tag="Already here"
            tone="warn"
            title={t`This slide is already in the project`}
            file={duplicate.path}
            text="A slide with the same name and size was uploaded before. Skip it, or keep both copies. Until you choose, it waits and the rest upload."
            actions={
              <>
                <Button onClick={() => decide(duplicate.path, "skip")}>
                  <Trans>Skip it</Trans>
                </Button>
                <Button variant="ghost" onClick={() => decide(duplicate.path, "keep")}>
                  <Trans>Keep both</Trans>
                </Button>
              </>
            }
          />
        ) : (
          <DoneRow
            key={duplicate.path}
            file={duplicate.path}
            what={
              choice === "keep" ? "Kept next to the copy already here" : "Skipped, already here"
            }
            out={choice === "skip"}
            onUndo={() => decide(duplicate.path, null)}
          />
        );
      })}
      {differences.map((difference) => (
        <ProblemZone
          key={difference.path}
          icon="warn"
          tag="Sorted differently"
          tone="warn"
          title={t`The server sorts this file differently`}
          file={difference.path}
          text={`Your browser puts it with: ${difference.browser}. The server puts it with: ${difference.server}. The upload follows your browser's choice. Pick a place for it on Files if that is wrong.`}
          actions={null}
        />
      ))}
    </>
  );
}
