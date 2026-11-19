import { useListReviewObjects } from "@parfocal/api-client";
import { useState } from "react";
import { useStillBackdrop } from "../../viewer/still-backdrop.tsx";
import type { StillDrawChoices } from "../../viewer/still-engine.tsx";
import { useStillObjects } from "../../viewer/use-still-objects.ts";
import { okData } from "../placeholder.tsx";
import { type Camera, SlideStill, type StillView } from "../review/slide-still.tsx";

const plainSlide: StillDrawChoices = {
  draw: "outline",
  width: "normal",
  opacity: 1,
  colorBy: "class",
  cutoff: 0,
  confidence: "all",
};

const noOutlines: ReadonlyMap<string, readonly number[]> = new Map();

const noDecision = () => undefined;

type DisagreementStageProps = {
  taskId: string;
  slideId: string;
  object: string;
  slideLabel: string;
  claimHidden?: boolean;
  className?: string;
};

export function DisagreementStage({
  taskId,
  slideId,
  object,
  slideLabel,
  claimHidden = false,
  className = "",
}: DisagreementStageProps) {
  const [camera, setCamera] = useState<{ key: string; camera: Camera | null }>({
    key: "",
    camera: null,
  });
  const key = `${slideId}:${object}`;
  const found = okData(useListReviewObjects(taskId, slideId).data);
  const slide = found?.slide;
  const slideSize =
    slide?.width && slide.height ? { width: slide.width, height: slide.height } : null;
  const objects = found?.objects ?? [];
  const outlined = objects.some((item) => item.object === object && item.outline);
  const still = useStillObjects(objects, noDecision, outlined ? object : null, slideSize);
  const backdrop = useStillBackdrop({
    enabled: found !== undefined,
    slideId,
    objects: claimHidden ? null : still.objects,
    choices: plainSlide,
  });
  const view: StillView = outlined ? { kind: "region", object } : { kind: "whole" };
  return (
    <SlideStill
      key={key}
      view={view}
      camera={camera.key === key ? camera.camera : null}
      onCameraChange={(next) => setCamera({ key, camera: next })}
      backdrop={backdrop}
      engineDrawn={claimHidden ? undefined : still.ids}
      outlines={still.outlines ?? noOutlines}
      outlineFrame={still.frame}
      regionDecisions={{}}
      claimHidden={claimHidden}
      tiles="unloaded"
      minimap={false}
      hint={false}
      slideName={slideLabel}
      className={className}
    />
  );
}
