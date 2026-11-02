import { useGetSlideAgreement, useListReviewObjects } from "@parfocal/api-client";
import { SlideSubmittedDialog } from "@parfocal/ui/components/slide-submitted-dialog";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { usePeople } from "../people.ts";
import { lookUrl } from "../thumbnails.ts";
import { GuidedReview } from "./guided-review.tsx";
import { useReviewSession } from "./review-data.ts";

const secondsPerObject = 14;
const autoOpenSeconds = 5;

type SlideSubmittedProps = { taskId: string; slideId: string };

export function SlideSubmitted({ taskId, slideId }: SlideSubmittedProps) {
  return (
    <div className="relative">
      <GuidedReview
        taskId={taskId}
        slideId={slideId}
        scene="done"
        submitted
        tab="review"
        onTabChange={() => undefined}
      />
      <NextSlideCard taskId={taskId} slideId={slideId} />
    </div>
  );
}

function NextSlideCard({ taskId, slideId }: SlideSubmittedProps) {
  const session = useReviewSession(taskId, slideId);
  const navigate = useNavigate();
  const person = usePeople();
  const agreement = useGetSlideAgreement(taskId, slideId).data?.data;
  const next = session.neighbours?.next ?? null;
  const nextObjects = useListReviewObjects(taskId, next?.id ?? "", {
    query: { enabled: next !== null },
  }).data?.data;
  const [left, setLeft] = useState(autoOpenSeconds);
  const [stopped, setStopped] = useState(false);
  const position = session.neighbours?.position ?? 0;
  const openNext = () => {
    if (next === null) {
      void navigate({ to: "/my-work" });
      return;
    }
    void navigate({
      to: "/tasks/$taskId/guided",
      params: { taskId },
      search: { slide: next.id },
    });
  };
  useEffect(() => {
    if (stopped) return;
    if (left === 0) {
      openNext();
      return;
    }
    const timer = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(timer);
  });
  useEffect(() => {
    const stop = () => setStopped(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter") openNext();
      else stop();
    };
    window.addEventListener("pointerdown", stop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", onKey);
    };
  });
  if (!session.ready) return null;
  const objects = nextObjects?.objects ?? [];
  const regions = objects.filter((item) => item.kind === "region").length;
  const cells = objects.length - regions;
  const minutes = Math.max(1, Math.round((objects.length * secondsPerObject) / 60));
  const other = person(agreement?.with_user_id)?.name;
  const nextSlide = nextObjects?.slide;
  const agreementText =
    other && agreement
      ? `You and ${other} agree on ${agreement.agree} of ${agreement.total} objects. You can look at the differences later, or go on.`
      : undefined;
  const nextInfo =
    next === null
      ? undefined
      : {
          thumbUrl: lookUrl("overview"),
          eyebrow: `Next · slide ${position + 1} of ${session.neighbours?.total}`,
          name: `${next.label} · ${nextSlide?.stain ?? ""}${next.case_label ? ` · case ${next.case_label}` : ""}`,
          meta: `${regions} regions, ${cells} cells · about ${minutes} min`,
        };
  const seeDifferences = () => {
    const projectId = session.task?.project_id;
    if (projectId) {
      void navigate({
        to: "/projects/$projectId/slides/$slideId",
        params: { projectId, slideId },
        search: { task: taskId },
      });
    }
  };
  return (
    <SlideSubmittedDialog
      title={`Slide ${position} submitted`}
      agreement={agreementText}
      next={nextInfo}
      primaryLabel={next ? `Open slide ${position + 1}` : "Back to My work"}
      status={`${stopped ? "Stays open until you pick." : `Opens by itself in ${left} s.`} Your review can be changed until sign-off.`}
      onPrimary={openNext}
      onDiffer={seeDifferences}
      onBreak={() => void navigate({ to: "/my-work" })}
    />
  );
}
