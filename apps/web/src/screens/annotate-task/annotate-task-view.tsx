import {
  AiResultToggle,
  ChangesByMarker,
  CheckedCard,
  CheckProgress,
  CheckStateTag,
  checkedOf,
  OriginCard,
  OriginMark,
  RunProgress,
  type RunState,
  RunTiles,
  SignOffCard,
} from "@parfocal/ui/components/annotate-task";
import { Button } from "@parfocal/ui/components/button";
import { Keycap } from "@parfocal/ui/components/keycap";
import { MagnificationBar } from "@parfocal/ui/components/magnification-bar";
import { UndoToast } from "@parfocal/ui/components/undo-toast";
import { ContextBar, ContextDivider, ContextPill } from "@parfocal/ui/components/viewer-tools";
import { Zone } from "@parfocal/ui/components/zone";
import { useEffect, useState } from "react";
import { ReviewTop } from "../review/review-top.tsx";
import { hpfSize } from "../review/slide-geometry.ts";
import { type Camera, SlideStill } from "../review/slide-still.tsx";
import { ViewerFrame } from "../review/viewer-frame.tsx";
import { annotateRail } from "../viewer-tools/rails.ts";
import { coverHome } from "../viewer-tools/tool-maths.ts";
import type { ToolSession } from "../viewer-tools/tool-session.tsx";
import {
  aiObjectCount,
  cellsPerTile,
  checkCountsOf,
  classOf,
  freshObjects,
  liveChangesOf,
  resultName,
  runCells,
  runColumns,
  runOrder,
  runRows,
  runSlide,
  runTileTotal,
  type TaskObject,
  type TaskPeople,
  type TaskScene,
} from "./fake-task.ts";
import { useTaskPeople } from "./task-people.ts";
import { TaskShapes } from "./task-shapes.tsx";

type SlideState = "open" | "checked" | "signoff" | "signed";

type Toast = { id: number; text: string; undo?: () => void };

const secondsPerTile = 12;
const tickMs = 1100;
const startTiles = 9;
const pickRadius = 22;

const wholeSlideHome = (size: { width: number; height: number }): Camera => ({
  x: hpfSize.width / 2,
  y: hpfSize.height / 2,
  scale: Math.min(size.width / hpfSize.width, size.height / hpfSize.height) * 0.94,
});

const confirmedAll = (people: TaskPeople) =>
  freshObjects(people).map((object) =>
    object.kind === "ai" && object.check === "unchecked"
      ? {
          ...object,
          origin: "ai-confirmed" as const,
          check: "confirmed" as const,
          author: people.me,
          history: [
            ...object.history,
            {
              id: "confirmed",
              who: people.me,
              what: "Confirmed, geometry kept",
              when: "11:09",
            },
          ],
        }
      : object,
  );

function startObjects(scene: TaskScene, people: TaskPeople): TaskObject[] {
  if (scene === "nothing" || scene === "run" || scene === "run-cancelled") return [];
  if (scene === "checked" || scene === "signoff") return confirmedAll(people);
  return freshObjects(people);
}

const startSelected = (scene: TaskScene) =>
  scene === "origins" ? "O15" : scene === "checking" ? "O25" : null;

const startSlide = (scene: TaskScene): SlideState =>
  scene === "checked" || scene === "nothing" ? "checked" : scene === "signoff" ? "signoff" : "open";

type TaskWorkspaceProps = { tools: ToolSession; scene: TaskScene; people: TaskPeople };

function TaskWorkspace({ tools, scene, people }: TaskWorkspaceProps) {
  const { session } = tools;
  const liveChanges = liveChangesOf(people);
  const running = scene === "run" || scene === "run-cancelled";
  const [objects, setObjects] = useState(() => startObjects(scene, people));
  const [selected, setSelected] = useState<string | null>(startSelected(scene));
  const [showAi, setShowAi] = useState(scene !== "ai-off");
  const [slide, setSlide] = useState<SlideState>(startSlide(scene));
  const [tab, setTab] = useState(scene === "ai-off" ? "display" : "objects");
  const [tool, setTool] = useState("select");
  const [camera, setCamera] = useState<Camera | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [tilesDone, setTilesDone] = useState(running ? startTiles : 0);
  const [runState, setRunState] = useState<RunState>(
    scene === "run-cancelled" ? "cancelled" : "running",
  );
  const [pending, setPending] = useState(scene === "live");

  useEffect(() => {
    if (!running || runState !== "running") return;
    const timer = window.setInterval(() => {
      setTilesDone((done) => {
        if (done >= runTileTotal - 1) setRunState("done");
        return Math.min(done + 1, runTileTotal);
      });
    }, tickMs);
    return () => window.clearInterval(timer);
  }, [running, runState]);

  const finishedTiles = runOrder.slice(0, tilesDone);
  const owned = new Set(objects.map((object) => object.id));
  const runObjects = running
    ? finishedTiles.flatMap((tile) => runCells(tile)).filter((object) => !owned.has(object.id))
    : [];
  const all = [...objects, ...runObjects];
  const visible = showAi ? all : all.filter((object) => object.kind === "human");
  const selectedObject = all.find((object) => object.id === selected);
  const counts = checkCountsOf(all);
  const unchecked = counts.total - checkedOf(counts);
  const empty = all.length === 0 && !running;
  const notify = (text: string, undo?: () => void) =>
    setToast({ id: Date.now(), text, ...(undo ? { undo } : {}) });

  const change = (id: string, patch: (object: TaskObject) => TaskObject) =>
    setObjects((current) => current.map((object) => (object.id === id ? patch(object) : object)));

  const setCheck = (id: string, kind: "confirmed" | "deleted") => {
    const before = all.find((object) => object.id === id);
    if (before === undefined) return;
    const what = kind === "confirmed" ? "Confirmed, geometry kept" : "Deleted, not a nucleus";
    const apply = (object: TaskObject): TaskObject => ({
      ...object,
      origin: kind === "confirmed" ? "ai-confirmed" : object.origin,
      check: kind,
      author: people.me,
      history: [...object.history, { id: kind, who: people.me, what, when: "11:20" }],
    });
    const fromRun = runObjects.some((object) => object.id === id);
    if (fromRun) setObjects((current) => [...current, apply(before)]);
    else change(id, apply);
    notify(`${id} ${kind === "confirmed" ? "confirmed" : "deleted"}`, () =>
      setObjects((current) =>
        fromRun
          ? current.filter((object) => object.id !== id)
          : current.map((object) => (object.id === id ? before : object)),
      ),
    );
  };

  const confirmSelected = () => {
    if (selectedObject?.kind === "ai" && selectedObject.check === "unchecked") {
      setCheck(selectedObject.id, "confirmed");
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest("input, textarea, [role=dialog]")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "c") confirmSelected();
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const showChanges = () => {
    setObjects((current) => [
      ...current.map((object) => liveChanges.patches[object.id]?.(object) ?? object),
      ...liveChanges.added,
    ]);
    setPending(false);
    notify(
      `3 changes by ${liveChanges.by.map((person) => person.name).join(" and ")} are on the slide`,
    );
  };

  const markChecked = () => setSlide("checked");

  const canConfirm = selectedObject?.kind === "ai" && selectedObject.check === "unchecked";
  const progressText = running
    ? `${objects.length + runObjects.length} objects from the run`
    : `${checkedOf(counts)} of ${counts.total} checked`;
  const checkedSummary = empty
    ? "You marked this slide as having nothing to mark. Colleagues see it as checked."
    : `${counts.total} AI objects checked: ${counts.confirmed} confirmed, ${counts.edited} edited, ${counts.deleted} deleted. You added ${all.filter((object) => object.kind === "human" && object.author === people.me).length} by hand.`;

  const objectsBody = (
    <>
      {selectedObject ? (
        <OriginCard
          objectId={selectedObject.id}
          classLabel={classOf[selectedObject.classKey].label}
          classColour={classOf[selectedObject.classKey].colour}
          origin={selectedObject.origin}
          author={selectedObject.author}
          history={selectedObject.history}
        />
      ) : null}
      <Zone title="Objects" sub={`${visible.length} on the slide`}>
        {visible.length === 0 ? (
          <p className="m-0 text-body-sm text-fg-dim">
            {empty ? "This slide has no objects." : "Nothing is shown. Turn the AI result on."}
          </p>
        ) : (
          <ul className="m-0 grid max-h-[46vh] list-none gap-0.5 overflow-auto p-0">
            {visible.slice(0, 60).map((object) => (
              <li key={object.id}>
                <button
                  type="button"
                  aria-pressed={object.id === selected}
                  onClick={() => setSelected(object.id)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-body-sm text-fg hover:bg-chrome-3 aria-pressed:bg-accent-soft"
                >
                  <i
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: classOf[object.classKey].colour }}
                  />
                  <span className="w-9 shrink-0 font-mono">{object.id}</span>
                  <OriginMark origin={object.origin} author={object.author} />
                  {object.kind === "ai" && object.origin === "ai" ? (
                    <CheckStateTag state={object.check} className="ml-auto" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Zone>
    </>
  );

  const displayBody = (
    <>
      <AiResultToggle
        checked={showAi}
        onCheckedChange={setShowAi}
        resultName={resultName}
        count={running ? runTileTotal * cellsPerTile : aiObjectCount}
      />
      {empty ? null : (
        <Zone title="Check progress" sub="Scope: all AI objects, least sure first">
          <CheckProgress counts={counts} scope="AI objects" />
        </Zone>
      )}
      <Zone title="Per class">
        <ul className="m-0 grid list-none gap-1.5 p-0 text-body-sm">
          {(["tumor", "immune"] as const).map((key) => (
            <li key={key} className="flex items-center gap-2">
              <i
                aria-hidden="true"
                className="size-2.5 rounded-full"
                style={{ background: classOf[key].colour }}
              />
              {classOf[key].label}
              <span className="ml-auto font-mono text-fg-dim">
                {
                  visible.filter((object) => object.classKey === key && object.check !== "deleted")
                    .length
                }
              </span>
            </li>
          ))}
        </ul>
      </Zone>
    </>
  );

  const pendingIds = pending ? Object.keys(liveChanges.patches) : [];
  const finished = new Set(finishedTiles);

  return (
    <ViewerFrame
      session={session}
      counts={undefined}
      topBar={
        <ReviewTop
          mode="annotate"
          session={session}
          counts={undefined}
          nothingToDecide
          progressSub={progressText}
          primaryLabel={empty ? "Nothing to mark" : "Mark slide checked"}
          primaryTitle="Tell your colleagues you are done with this slide"
          submitReason={
            slide !== "open"
              ? undefined
              : running && runState === "running"
                ? "The run is still going"
                : running
                  ? undefined
                  : unchecked > 0
                    ? `${unchecked} AI objects are not checked yet`
                    : undefined
          }
          onSubmit={markChecked}
        />
      }
      tool={tool}
      railGroups={annotateRail}
      onToolChange={setTool}
      tab={tab}
      onTabChange={setTab}
      scene={`annotate-task-${scene}`}
      tabs={[
        { value: "objects", label: "Objects", count: visible.length, body: objectsBody },
        { value: "display", label: "Display", body: displayBody },
      ]}
    >
      <SlideStill
        view={{ kind: "whole" }}
        look="hpf"
        homeOf={running ? wholeSlideHome : coverHome(hpfSize, [736, 774], 1.6)}
        camera={camera}
        onCameraChange={setCamera}
        regionDecisions={{}}
        bare
        minimap={false}
        hint={false}
        onPointPick={(point) => {
          const near = visible
            .filter((object) => object.check !== "deleted")
            .map((object) => ({ object, gap: Math.hypot(object.x - point.x, object.y - point.y) }))
            .filter((item) => item.gap < pickRadius)
            .sort((left, right) => left.gap - right.gap)[0];
          if (near === undefined) return;
          setSelected(near.object.id);
          setObjects((current) =>
            current.map((object) =>
              object.id === near.object.id && object.changedBy
                ? { ...object, changedBy: undefined }
                : object,
            ),
          );
        }}
        underlay={() => (
          <>
            {running ? (
              <RunTiles
                columns={runColumns}
                rows={runRows}
                width={runSlide.width}
                height={runSlide.height}
                finished={finished}
                runningTile={runState === "running" ? runOrder[tilesDone] : undefined}
              />
            ) : null}
            <TaskShapes objects={visible} selected={selected} pendingIds={pendingIds} />
          </>
        )}
        overlay={() => (
          <>
            <ContextBar label="Annotate task">
              <ContextPill>
                {showAi ? `AI result on · ${resultName}` : "AI result hidden"}
              </ContextPill>
              {empty ? null : (
                <>
                  <ContextDivider />
                  <span className="font-mono" data-testid="check-progress-line">
                    {progressText}
                  </span>
                </>
              )}
              {canConfirm ? (
                <>
                  <ContextDivider />
                  <Button size="sm" variant="primary" onClick={confirmSelected}>
                    Confirm {selectedObject?.id} <Keycap keys="C" size="sm" />
                  </Button>
                  <Button size="sm" onClick={() => setCheck(selectedObject?.id ?? "", "deleted")}>
                    Delete
                  </Button>
                </>
              ) : null}
            </ContextBar>
            {running ? (
              <div className="absolute bottom-4 left-4">
                <RunProgress
                  state={runState}
                  tilesDone={tilesDone}
                  tilesTotal={runTileTotal}
                  objects={runObjects.length}
                  estimate={`${Math.max(1, Math.round(((runTileTotal - tilesDone) * secondsPerTile) / 60))} min`}
                  onCancel={() => setRunState("cancelled")}
                />
              </div>
            ) : null}
            {slide === "checked" ? (
              <div className="absolute top-20 left-1/2 -translate-x-1/2">
                <CheckedCard
                  nothingToMark={empty}
                  summary={checkedSummary}
                  onUndo={() => setSlide("open")}
                  onNext={() => notify("Next slide in the task")}
                />
              </div>
            ) : null}
            {slide === "signoff" || slide === "signed" ? (
              <div className="absolute top-20 left-1/2 -translate-x-1/2">
                <SignOffCard
                  slideName={session.slideName}
                  openThreads={2}
                  signedOff={slide === "signed"}
                  experts={[
                    { person: people.me, checked: true, sub: "Checked 11:20" },
                    { person: people.anna, checked: true, sub: "Nothing to mark" },
                    { person: people.simona, checked: true, sub: "Checked 12:05" },
                  ]}
                  onSignOff={() => {
                    setSlide("signed");
                    notify("The layer is locked");
                  }}
                  onShowThreads={() => notify("The Comments tab lists both threads")}
                />
              </div>
            ) : null}
            {pending ? (
              <div className="absolute bottom-16 left-1/2 -translate-x-1/2">
                <ChangesByMarker people={liveChanges.by} count={3} onClick={showChanges} />
              </div>
            ) : null}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
              <MagnificationBar
                magnification={20}
                scaleLabel="20 µm"
                scalePx={92}
                micronsPerPixel={0.5}
              />
            </div>
            {toast ? (
              <div className="absolute right-4 bottom-4">
                <UndoToast
                  key={toast.id}
                  message={toast.text}
                  {...(toast.undo ? { onUndo: toast.undo } : {})}
                  onExpire={() => setToast(null)}
                />
              </div>
            ) : null}
          </>
        )}
      />
    </ViewerFrame>
  );
}

export function AnnotateTaskView({ tools, scene }: { tools: ToolSession; scene: TaskScene }) {
  const people = useTaskPeople();
  if (people === undefined) {
    return (
      <main className="grid h-dvh place-items-center bg-page text-fg-dim">Loading the slide…</main>
    );
  }
  return <TaskWorkspace key={scene} tools={tools} scene={scene} people={people} />;
}
