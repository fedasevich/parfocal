import { Trans } from "@lingui/react/macro";
import { type ReviewObject, useGetSlideAiProgress } from "@parfocal/api-client";
import { useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { RunningObjects, TellMeWhenReady } from "../screens/viewer/objects-panel.tsx";

const progressPollMs = 3000;

export function StageAiReading({
  slideId,
  objects,
}: {
  slideId: string;
  objects: readonly ReviewObject[];
}) {
  const progress = okData(
    useGetSlideAiProgress(slideId, {
      query: {
        refetchInterval: (query) =>
          okData(query.state.data)?.state === "running" ? progressPollMs : false,
      },
    }).data,
  );
  const running = progress?.state === "running";
  const [tellMe, setTellMe] = useState(false);
  const [wasRunning, setWasRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  if (running !== wasRunning) {
    setWasRunning(running);
    if (!running && wasRunning && tellMe) setFinished(true);
  }
  return (
    <div data-testid="stage-ai-reading" data-state={running ? "running" : "ready"}>
      <p role="status" className="sr-only">
        {finished ? <Trans>The AI finished reading this slide.</Trans> : ""}
      </p>
      {running && progress !== undefined ? (
        <div className="flex flex-col gap-3">
          <RunningObjects progress={progress} objects={[...objects]} />
          <TellMeWhenReady on={tellMe} onChange={setTellMe} />
        </div>
      ) : null}
    </div>
  );
}
