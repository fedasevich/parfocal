import {
  getGetMySettingLayersQueryKey,
  useGetMySettingLayers,
  useListMyReviewTasks,
  useListProjects,
  useSetMySettingLayers,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { useMatches, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { startTour, stopTour, useActiveTourStep, useHelpOpen } from "./tour-state.ts";
import {
  isLastStep,
  offerShows,
  progressAfterNext,
  progressAfterStop,
  progressOf,
  resumeIndex,
  tourLength,
  tourSteps,
} from "./tour-steps.ts";

const HelpDialog = lazy(async () => ({
  default: (await import("./help-dialog.tsx")).HelpDialog,
}));

type Box = { left: number; top: number; width: number; height: number };

function useSavedTour() {
  const queryClient = useQueryClient();
  const layers = okData(useGetMySettingLayers().data);
  const save = useSetMySettingLayers({
    mutation: {
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() }),
    },
  });
  return {
    loaded: layers !== undefined,
    progress: progressOf(layers?.personal.tour_progress),
    saveProgress: (progress: number) =>
      save.mutate({ data: { values: { tour_progress: progress } } }),
    dismiss: () => save.mutate({ data: { values: { tour_progress: tourLength } } }),
  };
}

function useTargetBox(selector: string | undefined, key: number | null): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    setBox(null);
    if (selector === undefined || key === null) return;
    const measure = () => {
      const element = document.querySelector(selector);
      if (!element) return setBox(null);
      const rect = element.getBoundingClientRect();
      setBox({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    };
    measure();
    const timer = window.setInterval(measure, 400);
    return () => window.clearInterval(timer);
  }, [selector, key]);
  return box;
}

function TourCard({ index }: { index: number }) {
  const router = useRouter();
  const saved = useSavedTour();
  const projectId = okData(useListProjects().data)?.[0]?.id;
  const taskId = okData(useListMyReviewTasks().data)?.[0]?.id;
  const step = tourSteps[index];
  const box = useTargetBox(step?.target, index);
  useEffect(() => {
    const destination = tourSteps[index]?.route({ projectId, taskId });
    if (destination !== undefined) void router.navigate({ href: destination });
  }, [index, projectId, taskId, router]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      saved.saveProgress(progressAfterStop(index, saved.progress));
      stopTour();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (step === undefined) return null;
  const last = isLastStep(index);
  const next = () => {
    saved.saveProgress(progressAfterNext(index, saved.progress));
    if (last) stopTour();
    else startTour(index + 1);
  };
  const stop = () => {
    saved.saveProgress(progressAfterStop(index, saved.progress));
    stopTour();
  };
  return (
    <>
      {box ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 rounded-card border-2 border-accent shadow-pop"
          style={{
            left: box.left - 4,
            top: box.top - 4,
            width: box.width + 8,
            height: box.height + 8,
          }}
        />
      ) : null}
      <section
        role="dialog"
        aria-label="Guided tour"
        className="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2 rounded-card border border-line bg-surf-raised p-3 shadow-lg"
      >
        <p className="text-caption text-ink-2">
          Step {index + 1} of {tourLength}
        </p>
        <h2 className="text-body font-semibold text-ink">{step.title}</h2>
        <p className="text-body-sm text-ink">{step.text}</p>
        <div className="flex items-center justify-between gap-2">
          <Button size="xs" variant="ghost" onClick={stop}>
            Stop tour
          </Button>
          <div className="flex gap-2">
            {index > 0 ? (
              <Button size="xs" variant="secondary" onClick={() => startTour(index - 1)}>
                Back
              </Button>
            ) : null}
            <Button size="xs" onClick={next}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

function TourOffer() {
  const onHome = useMatches({ select: (matches) => matches.at(-1)?.routeId === "/" });
  return onHome ? <TourOfferCard /> : null;
}

function TourOfferCard() {
  const saved = useSavedTour();
  if (!saved.loaded || !offerShows(saved)) return null;
  return (
    <section
      aria-label="Tour offer"
      className="fixed right-4 bottom-4 z-40 flex w-80 flex-col gap-2 rounded-card border border-line bg-surf-raised p-3 shadow-lg"
    >
      <p className="font-medium text-ink">New here?</p>
      <p className="text-body-sm text-ink-2">
        A short tour walks through the ten steps from upload to the signed report.
      </p>
      <div className="flex justify-between gap-2">
        <Button size="xs" variant="ghost" onClick={saved.dismiss}>
          Not now
        </Button>
        <Button size="xs" onClick={() => startTour(resumeIndex(saved.progress))}>
          Take the tour
        </Button>
      </div>
    </section>
  );
}

export default function TourHost() {
  const active = useActiveTourStep();
  const helpOpen = useHelpOpen();
  return (
    <>
      {active === null ? <TourOffer /> : <TourCard index={active} />}
      {helpOpen ? (
        <Suspense fallback={null}>
          <HelpDialog />
        </Suspense>
      ) : null}
    </>
  );
}
