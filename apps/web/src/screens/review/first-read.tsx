import { useAddReviewObject, useSubmitFirstRead } from "@parfocal/api-client";
import { InlineError } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { SidePanel } from "@parfocal/ui/components/side-panel";
import { type OpinionQuestion, QuestionControl } from "@parfocal/ui/components/slide-done-card";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { polygonToGeoJson } from "../../annotations/geojson.ts";
import { closeDraft, type Point, type PolygonDraft } from "../../annotations/polygon-draft.ts";
import { showUndoToast } from "../../shell/undo-toasts.tsx";
import { imageOfKind, stillToSlide } from "./outline-coords.ts";
import { RedrawLayer } from "./redraw-layer.tsx";
import type { ReviewSession } from "./review-data.ts";
import { ReviewTop } from "./review-top.tsx";
import { type Camera, SlideStill } from "./slide-still.tsx";
import { useOpinionDraft } from "./use-opinion-draft.ts";

const asksInFirstRead = (asked: string | undefined) => asked !== "aided";

export function FirstReadStep({ session }: { session: ReviewSession }) {
  const queryClient = useQueryClient();
  const { answers, change } = useOpinionDraft(session);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [draft, setDraft] = useState<PolygonDraft | null>(null);
  const [drawn, setDrawn] = useState<{ id: string; shape: PolygonDraft }[]>([]);
  const [failed, setFailed] = useState(false);
  const adder = useAddReviewObject({
    mutation: { onSuccess: () => void queryClient.invalidateQueries() },
  });
  const recorder = useSubmitFirstRead({
    mutation: {
      onSuccess: () => void queryClient.invalidateQueries(),
      onError: () => setFailed(true),
    },
  });
  const questions: OpinionQuestion[] = (session.opinion?.questions ?? [])
    .filter((question) => asksInFirstRead(question.asked))
    .map((question) => ({
      id: question.key,
      question: question.label,
      required: question.required ?? false,
      kind: question.kind,
      ...(question.kind === "choice" ? { options: question.options } : {}),
      ...(answers[question.key] ? { answer: answers[question.key] } : {}),
    }));
  const missing = questions.filter((question) => question.required && !question.answer);
  const added = session.added.length;

  const finishOutline = () => {
    if (draft === null) return;
    const image = imageOfKind("region");
    const closed = closeDraft(draft.map((point) => stillToSlide(point, image)));
    if (closed.kind !== "closed") return;
    adder.mutate({
      taskId: session.taskId,
      slideId: session.slideId,
      data: { kind: "region", geometry: polygonToGeoJson(closed.points) },
    });
    setDrawn((now) => [...now, { id: crypto.randomUUID(), shape: draft }]);
    setDraft(null);
    showUndoToast({ message: "Object added to your first read." });
  };
  const pickPoint = (point: Point) => {
    if (draft === null) return;
    const last = draft.at(-1);
    if (last?.x === point.x && last.y === point.y) return;
    setDraft([...draft, point]);
  };
  const record = () => {
    setFailed(false);
    recorder.mutate({ taskId: session.taskId, slideId: session.slideId });
  };

  const body = (
    <div className="flex min-h-full flex-col gap-5" data-testid="first-read-panel">
      <div className="grid justify-items-start gap-2">
        <Icon name="eye-off" size="lg" className="text-fg-dim" />
        <h2 className="m-0 text-title-sm font-semibold">Read the slide without the AI</h2>
        <p className="m-0 text-body-sm leading-[1.45] text-fg-dim">
          The AI result is hidden until you record your first read. Answer the questions, add what
          you find, then record. Your first read stays as it is after that.
        </p>
      </div>
      <div className="grid gap-4">
        {questions.map((question, index) => (
          <div key={question.id} className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <b className="text-body font-semibold">
                {index + 1} · {question.question}
              </b>
              {question.required ? (
                <span className="shrink-0 text-caption text-fg-dim">Required</span>
              ) : null}
            </div>
            <QuestionControl question={question} onAnswerChange={change} />
          </div>
        ))}
      </div>
      <div className="grid justify-items-start gap-2">
        <b className="text-body font-semibold">Objects you found</b>
        <span data-testid="first-read-added" className="text-body-sm text-fg-dim">
          {added === 0 ? "None added yet." : `${added} added.`}
        </span>
        {draft === null ? (
          <Button onClick={() => setDraft([])}>
            <Icon name="plus" />
            Add an object
          </Button>
        ) : (
          <div data-testid="add-panel" className="grid gap-2">
            <span className="text-body-sm text-fg-dim">
              Click around the object on the slide to outline it.
            </span>
            <div className="flex gap-2">
              <Button variant="primary" disabled={draft.length < 3} onClick={finishOutline}>
                Finish outline
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
      {failed ? (
        <InlineError>
          Your first read could not be recorded. Nothing was lost. Try again.
        </InlineError>
      ) : null}
      <div className="mt-auto grid gap-2.5">
        <Button
          variant="primary"
          size="lg"
          disabled={missing.length > 0 || draft !== null || recorder.isPending}
          onClick={record}
        >
          Record my first read
        </Button>
        <span className="text-center text-body-sm text-fg-dim">
          {missing.length > 0
            ? `${missing.length} required question${missing.length === 1 ? " is" : "s are"} not answered.`
            : "After this the AI result appears and you can give your decisions."}
        </span>
      </div>
    </div>
  );

  return (
    <main className="flex h-dvh min-w-0 flex-col bg-page text-fg" data-ai="hidden">
      <ReviewTop
        mode="guided"
        session={session}
        counts={undefined}
        nothingToDecide
        submitReason="Record your first read first"
      />
      <div className="flex min-h-0 flex-1">
        <SlideStill
          view={{ kind: "whole" }}
          camera={camera}
          onCameraChange={setCamera}
          regionDecisions={{}}
          bare
          minimap={false}
          hint={false}
          slideName={session.slideName}
          onPointPick={draft === null ? undefined : pickPoint}
          overlay={({ camera: shown, size }) => (
            <>
              <RedrawLayer
                camera={shown}
                size={size}
                draft={draft}
                saved={null}
                onClose={() => {}}
              />
              {drawn.map(({ id, shape }) => (
                <RedrawLayer
                  key={id}
                  camera={shown}
                  size={size}
                  draft={null}
                  saved={shape}
                  onClose={() => {}}
                />
              ))}
            </>
          )}
        />
        <SidePanel
          width={470}
          variant="quiet"
          value="first-read"
          onValueChange={() => {}}
          tabs={[{ value: "first-read", label: "First read", body }]}
        />
      </div>
    </main>
  );
}
