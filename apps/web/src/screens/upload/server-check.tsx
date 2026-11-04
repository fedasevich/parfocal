import { useEffect, useRef, useState } from "react";
import type { DroppedItem } from "../../upload/drop.ts";
import { checkSorting, placeInputOf, type SortDifference } from "../../upload/place.ts";
import { ProblemZone } from "./check-step.tsx";
import type { LiveModel, LiveState } from "./live-model.ts";

export { placeAndUpload, placeInputOf } from "../../upload/place.ts";

export default function ServerCheck({
  projectId,
  model,
  state,
  startError,
}: {
  projectId: string;
  model: LiveModel<DroppedItem>;
  state: LiveState;
  startError: boolean;
}) {
  const [differences, setDifferences] = useState<SortDifference[]>([]);
  const latest = useRef(() => placeInputOf(projectId, model, state));
  latest.current = () => placeInputOf(projectId, model, state);
  const key = JSON.stringify([
    model.slides.map((slide) => `${slide.path}:${slide.size}`),
    model.results.map((result) => `${result.item.path}:${result.slide}:${result.left}`),
    state.pair,
    state.cases,
  ]);
  useEffect(() => {
    if (key === "") return;
    let live = true;
    checkSorting(latest.current())
      .then((found) => {
        if (live) setDifferences(found);
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
          title="The server could not place these files"
          file="Nothing was uploaded"
          text="Your files stay as they are. Check your connection and press the upload button again."
          actions={null}
        />
      ) : null}
      {differences.map((difference) => (
        <ProblemZone
          key={difference.path}
          icon="warn"
          tag="Sorted differently"
          tone="warn"
          title="The server sorts this file differently"
          file={difference.path}
          text={`Your browser puts it with: ${difference.browser}. The server puts it with: ${difference.server}. The upload follows your browser's choice. Pick a place for it on Files if that is wrong.`}
          actions={null}
        />
      ))}
    </>
  );
}
