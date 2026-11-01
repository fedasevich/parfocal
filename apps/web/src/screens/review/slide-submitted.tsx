import { useGetSlideAgreement, useListReviewObjects } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
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
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="slide-submitted-title"
        className="grid w-140 gap-4 rounded-zone border border-line bg-chrome p-5.5 text-fg shadow-pop"
      >
        <div className="flex items-center gap-2.5">
          <Icon name="check" size="md" className="text-ok" />
          <b id="slide-submitted-title" className="text-title-sm font-semibold">
            Slide {position} submitted
          </b>
        </div>
        {other && agreement ? (
          <p className="m-0 text-body text-fg-dim">
            You and {other} agree on {agreement.agree} of {agreement.total} objects. You can look at
            the differences later, or go on.
          </p>
        ) : null}
        {next ? (
          <div className="grid grid-cols-[150px_1fr] items-center gap-3.5">
            <div
              aria-hidden="true"
              className="h-24 rounded-lg bg-cover bg-center"
              style={{ backgroundImage: `url(${lookUrl("overview")})`, transform: "scaleX(-1)" }}
            />
            <div className="grid gap-1">
              <span className="text-caption font-semibold text-fg-dim">
                Next · slide {position + 1} of {session.neighbours?.total}
              </span>
              <b className="text-lead font-semibold">
                {next.label} · {nextSlide?.stain ?? ""}
                {next.case_label ? ` · case ${next.case_label}` : ""}
              </b>
              <span className="text-body-sm text-fg-dim">
                {regions} regions, {cells} cells · about {minutes} min
              </span>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="lg" onClick={openNext}>
            {next ? `Open slide ${position + 1}` : "Back to My work"}
            <Keycap keys="↵" />
          </Button>
          <Button
            size="lg"
            onClick={() => {
              const projectId = session.task?.project_id;
              if (projectId) {
                void navigate({
                  to: "/projects/$projectId/slides/$slideId",
                  params: { projectId, slideId },
                  search: { task: taskId },
                });
              }
            }}
          >
            See where we differ
          </Button>
          <Button size="lg" onClick={() => void navigate({ to: "/my-work" })}>
            Take a break
          </Button>
        </div>
        <span className="text-body-sm text-fg-dim">
          {stopped ? "Stays open until you pick." : `Opens by itself in ${left} s.`} Your review can
          be changed until sign-off.
        </span>
      </section>
    </div>
  );
}
