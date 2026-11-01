import { useListProjectResultSets } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { DecisionButtons } from "@parfocal/ui/components/decision-buttons";
import { Icon } from "@parfocal/ui/components/icon";
import { MagnificationBar } from "@parfocal/ui/components/magnification-bar";
import { ObjectIdTag } from "@parfocal/ui/components/tag";
import { useState } from "react";
import { okData } from "../placeholder.tsx";
import type { SceneOf } from "../scenes.ts";
import { CellsGrid } from "./cells-grid.tsx";
import { answersOf, cardText, countsAs, rawFor, showsClaim } from "./decision-style.ts";
import { DisplayTab } from "./display-tab.tsx";
import { ObjectComments } from "./object-comments.tsx";
import { type ReviewSession, useReviewSession } from "./review-data.ts";
import { type Answers, answerOf, baseAnswers, countAnswers } from "./review-state.ts";
import { type Camera, SlideStill } from "./slide-still.tsx";
import { AiSays, ObjectList, ObjectsSummary, ViewerFrame } from "./viewer-frame.tsx";

export type GalleryScene = SceneOf<"gallery">;

type CellsOnSlideProps = {
  taskId: string;
  slideId: string;
  scene: GalleryScene | undefined;
};

export function CellsOnSlide(props: CellsOnSlideProps) {
  const session = useReviewSession(props.taskId, props.slideId);
  if (!session.ready) {
    return (
      <main className="grid h-dvh place-items-center bg-page text-fg-dim">Loading the slide…</main>
    );
  }
  return <CellsBody key={props.scene ?? "grid"} session={session} scene={props.scene} />;
}

export function useSetName(session: ReviewSession) {
  const sets = okData(
    useListProjectResultSets(session.task?.project_id ?? "", {
      query: { enabled: session.task !== undefined },
    }).data,
  );
  const id = session.task?.slides[0]?.result_set_id;
  const set = (sets ?? []).find((item) => item.id === id) ?? sets?.[0];
  return set ? `${set.name.split(" ")[0]} ${set.model_version ?? ""}`.trim() : "the AI";
}

function CellsBody({
  session,
  scene,
}: {
  session: ReviewSession;
  scene: GalleryScene | undefined;
}) {
  const style = scene === "blind" ? { ...session.style, kind: "blind" as const } : session.style;
  const objects = session.objects;
  const cells = objects.filter((item) => item.kind === "cell");
  const base = baseAnswers(objects, session.verdicts, style, "review", {});
  const [overrides, setOverrides] = useState<Answers>(new Map());
  const answer = (object: string) => answerOf(base, overrides, object);
  const [current, setCurrent] = useState(
    () => cells.find((cell) => !answer(cell.object))?.object ?? cells[0]?.object ?? "",
  );
  const [tab, setTab] = useState("objects");
  const [folded, setFolded] = useState(scene === "folded");
  const [shut, setShut] = useState(false);
  const [confirming, setConfirming] = useState(scene === "rest");
  const [camera, setCamera] = useState<Camera | null>(null);
  const setName = useSetName(session);
  const counts = countAnswers(objects, answer);
  const object = cells.find((cell) => cell.object === current);
  const openCells = cells.filter((cell) => !answer(cell.object));
  const keys = answersOf(style, session.classes, object).map((item) => item.key);
  const text = object ? cardText(style, object, "number") : null;
  const decide = (raw: string) => {
    if (object === undefined) return;
    const next = new Map(overrides);
    next.set(object.object, {
      value: countsAs(style, raw, object),
      raw,
      reasons: [],
      note: null,
    });
    setOverrides(next);
    const after = cells.find(
      (cell, index) => index > cells.indexOf(object) && !answerOf(base, next, cell.object),
    );
    if (after) {
      setCurrent(after.object);
      setCamera(null);
    }
  };
  const slideLabel = session.slideName.split(" ")[0] ?? "";
  const decisionFoot = object ? (
    <div className="grid gap-2.5">
      <div className="flex items-center gap-2">
        <ObjectIdTag>{object.object}</ObjectIdTag>
        <span className="flex-1 text-body-sm text-fg-dim">Cell in your sample</span>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setShut(true)}>
          <Icon name="close" />
        </Button>
      </div>
      {text?.hiddenNote ? (
        <small className="inline-flex items-center gap-2 text-caption font-semibold text-fg-dim">
          <Icon name="eye-off" />
          {text.hiddenNote}
        </small>
      ) : null}
      <b className="text-body font-semibold">
        {style.kind === "agree"
          ? `The AI says this is a ${object.class_name.toLowerCase()} cell, ${Math.round(object.score * 100)}% sure.`
          : text?.question}
      </b>
      <DecisionButtons
        decisionStyle={style.kind}
        size="large"
        className="[&_button]:h-9.5 [&_button]:text-body"
        value={answer(object.object)?.raw}
        onValueChange={decide}
        classes={session.classes}
        aiClass={object.class_name}
        label={`Your answer on ${object.object}`}
      />
    </div>
  ) : null;
  return (
    <ViewerFrame
      session={session}
      counts={counts}
      tool="select"
      tab={tab}
      onTabChange={setTab}
      tabs={[
        {
          value: "objects",
          label: "Objects",
          count: counts.total,
          body: (
            <>
              <ObjectsSummary
                slideLabel={slideLabel}
                counts={counts}
                added={session.added.map((item) => item.object)}
              />
              <AiSays setName={`${setName}, imported 12 Oct`} objects={objects} />
              <ObjectList
                objects={objects}
                counts={counts}
                answer={answer}
                current={current}
                onPick={(picked) => setCurrent(picked)}
              />
            </>
          ),
          foot: decisionFoot,
        },
        {
          value: "display",
          label: "Display",
          body: <DisplayTab display={session.display} preset={null} extraLocks={[]} viewer />,
        },
        {
          value: "comments",
          label: "Comments",
          count: session.threads.length,
          body: (
            <ObjectComments
              object={current}
              threads={session.threads}
              meId={session.meId}
              blind={session.task?.blinded ?? false}
              blindReviewers={[]}
            />
          ),
        },
        {
          value: "opinion",
          label: "Opinion",
          body: (
            <p className="m-0 text-body-sm text-fg-dim">
              The Slide done card with the opinion questions. It opens from Submit once every object
              is decided.
            </p>
          ),
        },
      ]}
    >
      <SlideStill
        view={{ kind: "cell", object: current }}
        camera={camera}
        onCameraChange={setCamera}
        regionDecisions={{}}
        cellDecisions={Object.fromEntries(
          cells.map((cell) => [cell.object, answer(cell.object)?.value]),
        )}
        ringedCells={confirming ? openCells.map((cell) => cell.object) : []}
        claimHidden={!showsClaim(style)}
        minimap={false}
        hint={false}
        slideName={session.slideName}
        overlay={() => (
          <>
            {shut ? null : (
              <CellsGrid
                className="absolute bottom-18 left-1/2 w-fit -translate-x-1/2"
                cells={cells}
                current={current}
                answer={answer}
                answerKeys={keys}
                claimHidden={!showsClaim(style)}
                folded={folded}
                confirming={confirming}
                onPick={(picked) => {
                  setCurrent(picked);
                  setCamera(null);
                }}
                onAgreeRest={() => setConfirming(true)}
                onCancelRest={() => setConfirming(false)}
                onApplyRest={() => {
                  const next = new Map(overrides);
                  for (const cell of openCells) {
                    next.set(cell.object, {
                      value: "agree",
                      raw: rawFor(style, "agree", cell),
                      reasons: [],
                      note: null,
                    });
                  }
                  setOverrides(next);
                  setConfirming(false);
                }}
                onFoldChange={setFolded}
                onClose={() => setShut(true)}
              />
            )}
            <Button size="lg" className="absolute bottom-4 left-4" onClick={() => setShut(false)}>
              <Icon name="expand" />
              Whole slide
            </Button>
            <MagnificationBar
              className="absolute bottom-4 left-1/2 -translate-x-1/2"
              magnification={40}
              scaleLabel="10 µm"
              scalePx={92}
              micronsPerPixel={0.11}
              open={folded}
            />
          </>
        )}
      />
    </ViewerFrame>
  );
}
