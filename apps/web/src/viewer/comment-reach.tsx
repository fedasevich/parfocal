import { useListProjectSlides } from "@parfocal/api-client";
import { sameObjectId } from "@parfocal/ui/lib/object-id";
import { useEffect, useMemo, useRef } from "react";
import { onReach } from "../annotations/comment-bus.ts";
import { publishReferences, type Reference } from "../annotations/comment-references.ts";
import { publishCurrentResult, publishResultObjects } from "../annotations/result-objects.ts";
import { okData } from "../screens/placeholder.tsx";
import { useReviewSession } from "../screens/review/review-data.ts";

export function ReviewCommentObjects({
  taskId,
  slideId,
  current,
  onReachObject,
}: {
  taskId: string;
  slideId: string;
  current: string | null;
  onReachObject: (id: string) => void;
}) {
  const { objects } = useReviewSession(taskId, slideId);
  const results = useMemo(
    () =>
      objects.flatMap((item) =>
        item.outline && item.outline.length >= 2 ? [{ id: item.object, ring: item.outline }] : [],
      ),
    [objects],
  );
  useEffect(() => publishResultObjects(slideId, results), [slideId, results]);
  useEffect(() => () => publishResultObjects(slideId, []), [slideId]);
  useEffect(() => {
    publishCurrentResult(slideId, current);
    return () => publishCurrentResult(slideId, null);
  }, [slideId, current]);
  const references = useMemo<Reference[]>(
    () =>
      objects.map((item) => ({
        id: item.object,
        text: item.object,
        sub: item.kind === "cell" ? "Cell" : "Region",
        reach: { kind: "object", id: item.object },
      })),
    [objects],
  );
  const source = `review:${slideId}`;
  useEffect(() => publishReferences(source, references), [source, references]);
  useEffect(() => () => publishReferences(source, []), [source]);
  const latest = useRef({ objects, onReachObject });
  latest.current = { objects, onReachObject };
  useEffect(
    () =>
      onReach(slideId, (target) => {
        if (target.kind !== "object") return;
        const found = latest.current.objects.find((item) => sameObjectId(item.object, target.id));
        if (found !== undefined) latest.current.onReachObject(found.object);
      }),
    [slideId],
  );
  return null;
}

export function SlideReferences({
  projectId,
  slideId,
  within,
  onOpenSlide,
}: {
  projectId: string;
  slideId: string;
  within: readonly string[] | null;
  onOpenSlide: (id: string) => void;
}) {
  const slides = okData(useListProjectSlides(projectId).data);
  const withinKey = within === null ? null : within.join(",");
  const references = useMemo<Reference[]>(() => {
    const allowed = withinKey === null ? null : new Set(withinKey.split(","));
    return (slides ?? [])
      .filter((slide) => allowed === null || allowed.has(slide.id))
      .map((slide) => ({
        id: slide.id,
        text: slide.label,
        sub: "Slide",
        reach: { kind: "slide", slideId: slide.id },
      }));
  }, [slides, withinKey]);
  const source = `slides:${projectId}`;
  useEffect(() => publishReferences(source, references), [source, references]);
  useEffect(() => () => publishReferences(source, []), [source]);
  const open = useRef(onOpenSlide);
  open.current = onOpenSlide;
  useEffect(
    () =>
      onReach(slideId, (target) => {
        if (target.kind === "slide" && target.slideId !== slideId) open.current(target.slideId);
      }),
    [slideId],
  );
  return null;
}
