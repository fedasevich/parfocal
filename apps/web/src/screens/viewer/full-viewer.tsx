import {
  useGetMyHome,
  useGetProject,
  useGetSlideAiProgress,
  useGetSlideResultStats,
  useListSlideResultSets,
  useSaveVerdict,
  useSubmitSlideReview,
  type ViewerPart,
} from "@parfocal/api-client";
import { AnalysisCards } from "@parfocal/ui/components/analysis-cards";
import { Banner } from "@parfocal/ui/components/banner";
import type { Blocker } from "@parfocal/ui/components/before-you-list";
import { Button } from "@parfocal/ui/components/button";
import { CellCluster, CellsLauncher } from "@parfocal/ui/components/cells-panel";
import { Icon } from "@parfocal/ui/components/icon";
import { MagnificationBar } from "@parfocal/ui/components/magnification-bar";
import { type OpinionQuestion, SlideDoneCard } from "@parfocal/ui/components/slide-done-card";
import { UndoToast } from "@parfocal/ui/components/undo-toast";
import { ResultSetRows, TileHint, ViewPicker } from "@parfocal/ui/components/visualize";
import { Zone } from "@parfocal/ui/components/zone";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { provideDebug } from "../../debug-handle.ts";
import { useFormat } from "../../format.ts";
import { destinations } from "../../shell/destinations.ts";
import { formatDayMonth } from "../format.ts";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { useAnswerKeys } from "../review/answer-keys.ts";
import { type CameraSearch, cameraFromSearch, cameraToSearch } from "../review/camera-search.ts";
import { CellsGrid } from "../review/cells-grid.tsx";
import { useSetName } from "../review/cells-on-slide.tsx";
import { escapeComment, type Pin, pinForClick } from "../review/comment-pin.ts";
import {
  answersOf,
  type Confidence,
  cardText,
  countsAs,
  decisionBody,
  rawFor,
  showsClaim,
} from "../review/decision-style.ts";
import { type DisplayLock, DisplayTab, displaySettings } from "../review/display-tab.tsx";
import { CanvasNotice } from "../review/guided-review.tsx";
import { finishingAnswers } from "../review/guided-scenes.ts";
import { useNoteKey } from "../review/note-key.ts";
import { ObjectComments } from "../review/object-comments.tsx";
import { PinMark, PinnedThread } from "../review/pinned-thread.tsx";
import { type ReviewSession, useReviewSession } from "../review/review-data.ts";
import {
  routeReviewTool,
  type StayTool,
  shownReviewTool,
  useReviewToolKeys,
} from "../review/review-rail.ts";
import {
  type Answer,
  type Answers,
  answerOf,
  baseAnswers,
  countAnswers,
} from "../review/review-state.ts";
import { ReviewTop } from "../review/review-top.tsx";
import {
  type Camera,
  imageOf,
  magnificationOf,
  SlideStill,
  type StillView,
} from "../review/slide-still.tsx";
import { caseMemoryKey, openCaseMemory, rememberSlideCamera } from "../review/slide-switch.ts";
import { ThreadsTab } from "../review/threads-tab.tsx";
import {
  AiSays,
  type ListFilter,
  ObjectList,
  ObjectsSummary,
  ViewerFrame,
} from "../review/viewer-frame.tsx";
import { MeasureCanvas, measuredSize } from "../viewer-tools/measure-canvas.tsx";
import { NavigatorCanvas, OverviewCanvas } from "../viewer-tools/navigator-canvas.tsx";
import { peekSpot } from "../viewer-tools/peek-model.ts";
import { reviewRail } from "../viewer-tools/rails.ts";
import { SlidePeek, usePeekKey } from "../viewer-tools/slide-peek.tsx";
import { areaOrder, areaRoleText, areaRows } from "./area-nav.ts";
import { layerDrawing, setColours } from "./layer-views.tsx";
import { ObjectTablePanel, tableRows } from "./object-table.tsx";
import {
  AddedFoot,
  MeasurementFoot,
  ObjectFoot,
  RunningObjects,
  TellMeWhenReady,
} from "./objects-panel.tsx";
import { SavePresetModal } from "./save-preset-modal.tsx";
import { useAreaNav } from "./use-area-nav.ts";
import {
  isNavigatorScene,
  type LayerView,
  layerViews,
  type ViewerScene,
  type ViewerTab,
  viewerSetup,
} from "./viewer-scenes.ts";

export type ViewerSearch = CameraSearch & {
  task?: string | undefined;
  object?: string | undefined;
  scene?: ViewerScene | undefined;
  tab?: ViewerTab | undefined;
  modal?: "preset" | undefined;
  tool?: StayTool | undefined;
  peek?: boolean | undefined;
  focus?: boolean | undefined;
};

type FullViewerProps = {
  projectId: string;
  slideId: string;
  search: ViewerSearch;
  onSearch: (change: Partial<ViewerSearch>) => void;
};

const netOff = "The connection is lost. It saves when the connection is back.";

const loading = (
  <main className="grid h-dvh place-items-center bg-page text-fg-dim">Loading the slide…</main>
);

export function FullViewer(props: FullViewerProps) {
  const home = okData(useGetMyHome().data);
  const taskId = props.search.task ?? home?.resume?.task_id;
  if (taskId === undefined) return loading;
  return <ViewerWithTask {...props} taskId={taskId} />;
}

function ViewerWithTask(props: FullViewerProps & { taskId: string }) {
  const session = useReviewSession(props.taskId, props.slideId);
  const project = okData(useGetProject(props.projectId).data);
  const progress = useGetSlideAiProgress(props.slideId);
  if (!session.ready || project === undefined || progress.isPending) return loading;
  return (
    <ViewerBody
      key={`${props.search.scene ?? "objects"}-${props.slideId}`}
      {...props}
      session={session}
      clinical={project.privacy_mode === "clinical"}
      projectCode={project.code}
      projectName={project.name}
      viewerParts={project.viewer_parts}
    />
  );
}

type BodyProps = FullViewerProps & {
  session: ReviewSession;
  clinical: boolean;
  projectCode: string;
  projectName: string;
  viewerParts: ViewerPart[];
};

function addedSize(note: string | null) {
  return note?.match(/(\d+(?:\.\d+)?) mm/)?.[0] ?? "";
}

const cameraWriteDelayMs = 250;
const aiProgressPollMs = 3000;

function ViewerBody({
  projectId,
  slideId,
  search,
  onSearch,
  session,
  clinical,
  projectCode,
  projectName,
  viewerParts,
}: BodyProps) {
  const format = useFormat();
  const scene = search.scene;
  const setup = viewerSetup(scene);
  const navigator = isNavigatorScene(scene) ? scene : null;
  const measuring = search.tool === "ruler";
  const peekOpen = search.peek === true;
  const [peekHeld, setPeekHeld] = useState(false);
  const navigate = useNavigate();
  const router = useRouter();
  const person = usePeople();
  const saveVerdict = useSaveVerdict();
  const submitReview = useSubmitSlideReview();
  const progress = okData(
    useGetSlideAiProgress(slideId, {
      query: {
        refetchInterval: (query) =>
          okData(query.state.data)?.state === "running" ? aiProgressPollMs : false,
      },
    }).data,
  );
  const stats = okData(useGetSlideResultStats(session.taskId, slideId).data);
  const slideSets = okData(useListSlideResultSets(slideId).data) ?? [];
  const setName = useSetName(session);
  const running = progress?.state === "running";
  const style = session.style;
  const objects = setup.issue === "noresults" || setup.issue === "withdrawn" ? [] : session.objects;
  const regions = objects.filter((item) => item.kind === "region");
  const cells = objects.filter((item) => item.kind === "cell");
  const added = setup.issue ? [] : session.added;
  const base = baseAnswers(
    objects,
    session.verdicts,
    style,
    setup.submitFail ? "done" : "review",
    finishingAnswers,
    session.classes,
  );
  const [overrides, setOverrides] = useState<Answers>(new Map());
  const answer = (object: string) => answerOf(base, overrides, object);
  const counts = countAnswers(objects, answer);
  const areas = regions.map((region) => ({
    object: region.object,
    size: region.size_mm ?? 0,
  }));
  const decidedRegions = regions.filter((region) => answer(region.object)).length;
  const closePeek = () => {
    setPeekHeld(false);
    onSearch({ peek: undefined });
  };
  usePeekKey(
    peekOpen,
    (held) => {
      setPeekHeld(held);
      if (!peekOpen) onSearch({ peek: true });
    },
    closePeek,
  );
  const [filter, setFilter] = useState<ListFilter>(setup.filter);
  const [cellsOpen, setCellsOpen] = useState(setup.cells);
  const [cellsFolded, setCellsFolded] = useState(false);
  const [confirmRest, setConfirmRest] = useState(false);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);
  const shownPin = search.tool === "comment" ? pin : null;
  const leaveComment = () => {
    setPin(null);
    onSearch({ tool: undefined });
  };
  const [note, setNote] = useState({ open: false, reasons: [] as string[], text: "" });
  const [preset, setPreset] = useState<string | null>(setup.preset);
  const [saved, setSaved] = useState<{ name: string; key: string }[]>([]);
  const [failed, setFailed] = useState(setup.submitFail);
  const [tellMe, setTellMe] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void; id: number } | null>(null);
  const [opinion, setOpinion] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(session.opinion?.answers ?? {}).map(([key, value]) => [key, String(value)]),
    ),
  );
  const firstOpenCell = cells.find((cell) => !answer(cell.object))?.object ?? cells[0]?.object;
  const firstRegion = regions[0];
  const measurement =
    measuring && firstRegion
      ? { object: "M1", mm: measuredSize(firstRegion.size_mm ?? 0), across: firstRegion.object }
      : null;
  const stagingAreas = regions.map((region) => ({
    object: region.object,
    size: region.size_mm ?? 0,
    probability: region.score,
    call: answer(region.object)?.value ?? null,
    measured: measurement?.across === region.object ? measurement.mm : null,
  }));
  const selected =
    search.object ??
    setup.object ??
    (measurement ? measurement.object : setup.cells ? (firstOpenCell ?? null) : null);
  const tab: ViewerTab = search.tab ?? setup.tab;
  const view: LayerView = setup.view;
  const extraLocks: DisplayLock[] = setup.confidenceLock
    ? [{ setting: "confidence", value: "hidden", reason: setup.confidenceLock }]
    : [];
  const display = session.display
    ? {
        ...session.display,
        presets: [...session.display.presets, ...saved.map((item) => ({ ...item, settings: {} }))],
      }
    : undefined;
  const settings = displaySettings(display, preset, extraLocks);
  const confidence = settings.confidence as Confidence;
  const readOnly = setup.readOnly;
  const buttonsOff = readOnly
    ? "Signed off. Ask the researcher to amend."
    : setup.issue === "slidefail"
      ? "This part of the slide can't be read yet"
      : setup.connLost
        ? netOff
        : undefined;
  const slideLabel = session.slideName.split(" ")[0] ?? "";
  const current = objects.find((item) => item.object === selected);
  const addedCurrent = added.find((item) => item.object === selected);
  const people = (session.task?.slides[0]?.reviewer_ids ?? []).flatMap((id) => {
    const found = person(id);
    return found ? [found] : [];
  });
  const shortName = (id: string | undefined) => {
    const set = slideSets.find((item) => item.id === id);
    return set ? `${set.name.split(" ")[0]} ${set.model_version ?? ""}`.trim() : "";
  };
  const taskSetId = session.task?.slides[0]?.result_set_id;
  const otherSet = slideSets.find((item) => item.id !== taskSetId);
  const setA = setName;
  const setB = shortName(stats?.model_vs_model.set_b_id ?? otherSet?.id) || "the other set";
  const pick = (object: string | undefined) => {
    setCamera(null);
    setNote({ open: false, reasons: [], text: "" });
    setConfirmRest(false);
    if (object?.includes("·")) setCellsOpen(true);
    onSearch({ object, x: undefined, y: undefined, z: undefined });
  };
  const goView = (next: string) => onSearch({ scene: next as LayerView, tab: "display" });
  const put = (object: string, value: Answer | null) => {
    const next = new Map(overrides);
    next.set(object, value);
    setOverrides(next);
    return next;
  };
  const decide = (raw: string) => {
    if (current === undefined || buttonsOff) return;
    const value = countsAs(style, raw, current);
    const previous = overrides.get(current.object);
    const kept = answer(current.object);
    const next = put(current.object, {
      value,
      raw,
      reasons: kept?.value === value ? kept.reasons : [],
      note: kept?.note ?? null,
    });
    saveVerdict.mutate({
      taskId: session.taskId,
      slideId: session.slideId,
      objectId: current.object,
      data: decisionBody(style, raw, session.classes, value),
    });
    setToast({
      id: Date.now(),
      text: `${current.object}: ${value === "unsure" ? "not sure" : value}`,
      undo: () => {
        const restore = new Map(next);
        if (previous === undefined) restore.delete(current.object);
        else restore.set(current.object, previous);
        setOverrides(restore);
      },
    });
    if (value !== "agree") setNote({ open: true, reasons: [], text: "" });
    if (current.kind === "cell") {
      const after = cells.find(
        (cell, index) => index > cells.indexOf(current) && !answerOf(base, next, cell.object),
      );
      if (after) pick(after.object);
    }
  };
  const saveNote = () => {
    if (current === undefined) return;
    const kept = answer(current.object);
    if (kept)
      put(current.object, { ...kept, reasons: note.reasons, note: note.text.trim() || null });
    setNote({ ...note, open: false });
  };

  const pickTool = (next: string) => {
    const route = routeReviewTool(next);
    if (route === null) return;
    if (route.kind === "annotate") {
      void navigate({
        to: "/projects/$projectId/slides/$slideId/annotate",
        params: { projectId, slideId },
        search: { task: session.taskId, tool: route.tool },
      });
      return;
    }
    onSearch({
      tool: route.tool,
      ...(route.tool === "ruler" ? { object: undefined, scene: undefined } : {}),
      ...(route.tab ? { tab: route.tab } : {}),
    });
  };

  useReviewToolKeys(pickTool, !peekOpen);

  useNoteKey(() => {
    if (current === undefined || tab !== "objects") return;
    const kept = answer(current.object);
    if (kept) setNote({ open: true, reasons: kept.reasons, text: kept.note ?? "" });
  });

  useAnswerKeys(
    answersOf(style, session.classes, current),
    decide,
    current !== undefined && tab === "objects",
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable], [role=dialog], [role=menu]")) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        onSearch({ focus: true, scene: undefined, tool: undefined });
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (event.key === "Escape" && peekOpen) return;
      if (event.key === "Escape" && escapeComment({ tool: search.tool, pin: shownPin })) {
        leaveComment();
        return;
      }
      if (event.key === "Escape" && selected) {
        pick(undefined);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const regionDecisions = Object.fromEntries(
    regions.map((region) => [region.object, answer(region.object)?.value]),
  );
  const cellDecisions = Object.fromEntries(
    cells.map((cell) => [cell.object, answer(cell.object)?.value]),
  );
  const openCells = cells.filter((cell) => !answer(cell.object));
  const stillView: StillView = current
    ? current.kind === "cell"
      ? { kind: "cell", object: current.object }
      : { kind: "region", object: current.object }
    : addedCurrent
      ? { kind: "region", object: addedCurrent.object }
      : { kind: "whole" };
  const cameraImage = imageOf(stillView);
  const shownCamera = camera ?? cameraFromSearch(cameraImage, search);
  const ranked = areaRows(areas, (object) => answer(object)?.value);
  const areaNav = useAreaNav({
    order: areaOrder(ranked),
    spot: {
      object: selected ?? null,
      ...(camera ? cameraToSearch(cameraImage, camera) : { x: search.x, y: search.y, z: search.z }),
    },
    magnification: shownCamera ? magnificationOf(stillView, shownCamera) : 0,
    goTo: (object) => (navigator ? onSearch({ scene: undefined, object }) : pick(object)),
    restore: (spot) => {
      setCamera(null);
      setPeekHeld(false);
      onSearch({
        object: spot.object ?? undefined,
        x: spot.x,
        y: spot.y,
        z: spot.z,
        ...(peekOpen ? { peek: undefined } : {}),
      });
    },
    intercept: (fired) => {
      if (fired.action !== "nextarea" || !navigator || navigator === "overview") return false;
      if (fired.phase !== "press") return true;
      if (navigator === "travel") onSearch({ scene: undefined, object: "T3" });
      else onSearch({ scene: "travel" });
      return true;
    },
  });
  const areaRole = (object: string) => {
    const role = ranked.find((row) => row.object === object)?.role;
    return role ? areaRoleText[role] : undefined;
  };
  const writeSearch = useRef(onSearch);
  writeSearch.current = onSearch;
  const debugCamera = useRef(shownCamera);
  debugCamera.current = shownCamera;
  useEffect(
    () =>
      provideDebug({
        getCamera: () => debugCamera.current,
        setCamera: (next) => setCamera({ x: next.x, y: next.y, scale: next.scale }),
      }),
    [],
  );
  const caseKey = caseMemoryKey(session.task?.project_id, session.caseLabel);
  useEffect(() => {
    openCaseMemory(caseKey);
  }, [caseKey]);
  useEffect(() => {
    if (camera !== null) rememberSlideCamera(slideId, cameraToSearch(cameraImage, camera));
  }, [camera, cameraImage, slideId]);
  useEffect(() => {
    if (camera === null) return;
    const timer = setTimeout(
      () => writeSearch.current(cameraToSearch(cameraImage, camera)),
      cameraWriteDelayMs,
    );
    return () => clearTimeout(timer);
  }, [camera, cameraImage]);
  const drawing = layerDrawing({
    view,
    objects,
    added: added.map((item) => item.object),
    stats,
    confidence,
    setA,
    setB,
    reviewers: people,
    selected,
  });
  const showScore = confidence !== "hidden";

  const openRegions = regions.filter((region) => !answer(region.object));
  const blockers: Blocker[] = counts.open
    ? [
        ...openRegions.map((region) => ({
          id: region.object,
          text: `${region.object} is still open`,
          goTo: `Go to ${region.object}`,
          onGoTo: () => {
            pick(region.object);
            onSearch({ object: region.object, tab: "objects" });
          },
        })),
        ...(openCells.length
          ? [
              {
                id: "cells",
                text: `${openCells.length} cell${openCells.length === 1 ? "" : "s"} in the sample ${openCells.length === 1 ? "is" : "are"} still open`,
                goTo: "Go to the cells",
                onGoTo: () => onSearch({ object: openCells[0]?.object, tab: "objects" }),
              },
            ]
          : []),
      ]
    : [];
  const questions: OpinionQuestion[] = (session.opinion?.questions ?? []).map((question) => ({
    id: question.key,
    question: question.label,
    required: question.required ?? false,
    kind: question.kind,
    ...(question.kind === "choice" ? { options: question.options } : {}),
    ...(question.kind === "scale" && question.min_label && question.max_label
      ? {
          help: `${question.min ?? 1} ${question.min_label} · ${question.max ?? 5} ${question.max_label}`,
        }
      : {}),
    ...(opinion[question.key] ? { answer: opinion[question.key] } : {}),
  }));
  const doneBlockers: Blocker[] = blockers.length
    ? blockers
    : questions
        .map((question, position) => ({ question, position }))
        .filter(({ question }) => question.required && !opinion[question.id])
        .map(({ question, position }) => ({
          id: question.id,
          text: `Question ${position + 1} is not answered`,
          goTo: "Answer it",
        }));
  const submit = () => {
    if (failed) {
      setFailed(false);
      return;
    }
    submitReview.mutate({ taskId: session.taskId, slideId: session.slideId });
    void navigate({
      to: "/tasks/$taskId/submitted",
      params: { taskId: session.taskId },
      search: { slide: session.slideId },
    });
  };

  const noTask = search.task === undefined && session.objects.length === 0;
  const nothing = noTask || setup.issue === "noresults" || setup.issue === "withdrawn";
  const objectsBody: ReactNode =
    running && progress ? (
      <RunningObjects progress={progress} objects={objects} />
    ) : nothing ? (
      <Zone title={`Objects on ${slideLabel}`}>
        <p className="m-0 text-body-sm leading-[1.5] text-fg-dim">
          {noTask
            ? `No review task asks about ${slideLabel}. Look at it here, and write what you find in the clinical report.`
            : setup.issue === "noresults"
              ? `Nothing to decide here yet. ${slideLabel} has no ${setName} result in ${session.task?.code ?? "this task"}.`
              : `${session.task?.code ?? "The task"} was withdrawn on 16 Oct. There is nothing left to decide.`}
        </p>
      </Zone>
    ) : (
      <>
        <ObjectsSummary
          slideLabel={slideLabel}
          counts={counts}
          added={added.map((item) => item.object)}
        />
        <AiSays setName={`${setName}, imported 12 Oct`} objects={objects} />
        <ObjectList
          objects={objects}
          counts={counts}
          answer={answer}
          current={selected ?? undefined}
          onPick={pick}
          filter={filter}
          onFilterChange={setFilter}
          showScore={showScore}
          added={added.map((item) => ({
            object: item.object,
            size: addedSize(item.note),
            note: item.note,
          }))}
          onOpenCells={() => pick(firstOpenCell)}
          measurements={measurement ? [measurement] : []}
        />
      </>
    );
  const firstOpen = openRegions[0]?.object;
  const objectsFoot: ReactNode = running ? (
    <TellMeWhenReady on={tellMe} onChange={setTellMe} />
  ) : nothing ? undefined : measurement && selected === measurement.object ? (
    <MeasurementFoot
      {...measurement}
      onClose={() => onSearch({ object: "" })}
      onRemove={() => {
        onSearch({ tool: undefined, object: undefined });
        setToast({
          id: Date.now(),
          text: `${measurement.object} removed`,
          undo: () => onSearch({ tool: "ruler", object: measurement.object }),
        });
      }}
    />
  ) : current ? (
    <ObjectFoot
      object={current}
      text={cardText(style, current, confidence)}
      style={style}
      classes={session.classes}
      answer={answer(current.object)}
      disabledReason={buttonsOff}
      author={person(session.meId)}
      note={note}
      saveOffReason={setup.connLost ? netOff : undefined}
      onNote={setNote}
      onSaveNote={saveNote}
      onAnswer={decide}
      onClose={() => pick(undefined)}
    />
  ) : addedCurrent ? (
    <AddedFoot
      object={addedCurrent.object}
      size={addedSize(addedCurrent.note)}
      note={addedCurrent.note}
      onClose={() => pick(undefined)}
    />
  ) : firstOpen ? (
    <Button variant="primary" className="w-full" onClick={() => pick(firstOpen)}>
      Go to {firstOpen}, the first open object
    </Button>
  ) : (
    <Button variant="primary" className="w-full" onClick={() => onSearch({ tab: "opinion" })}>
      All decided. Open the Slide done card
    </Button>
  );

  const resultSetRows = (
    <ResultSetRows
      sets={[
        ...slideSets.map((set) => {
          const task = set.id === taskSetId;
          return {
            key: set.id,
            name: `${set.name} ${set.model_version ?? ""}`.trim(),
            sub: `${set.source === "run" ? "Run here" : "Imported"} ${formatDayMonth(new Date(set.produced_at ?? set.created_at))}${task ? " · the result this task checks" : ""}`,
            color: task ? setColours.a : setColours.b,
            fixed: task,
            on: false,
            menu: [
              {
                icon: "slides" as const,
                label: "Compare with another set",
                onSelect: (): void => goView("models"),
              },
              {
                icon: "smart" as const,
                label: set.source === "run" ? "Run again" : "Run a model on this slide",
                onSelect: (): void =>
                  void router.navigate({ href: destinations.runModel(projectId) }),
              },
              {
                icon: "upload" as const,
                label: "Add another result set",
                onSelect: (): void =>
                  void navigate({
                    to: "/projects/$projectId/upload",
                    params: { projectId },
                    search: { scene: "viewer" },
                  }),
              },
            ],
          };
        }),
        {
          key: "reviewed",
          name: "Your review",
          sub: "The reviewed layer, as you edit it",
          color: setColours.reviewed,
          on: true,
          menu: [
            {
              icon: "slides" as const,
              label: "Compare with the AI",
              onSelect: (): void => goView("diff"),
            },
          ],
        },
      ]}
    />
  );

  const viewZone = (
    <Zone title="View" end={<span className="text-caption text-fg-dim">Ways to show results</span>}>
      <ViewPicker views={layerViews} value={view} onValueChange={goView} />
    </Zone>
  );
  const thread = session.threads.find((item) => item.anchor === current?.object);
  const displayBody =
    view === "table" && current ? (
      <>
        <Zone title={`${current.object} · Tumor region`} highlight>
          <TableObjectFacts
            object={current.object}
            score={showScore ? current.score : null}
            size={current.size_mm}
            sets={[setA, setB]}
            answer={answer(current.object)}
            fullId={`${projectCode}/${session.caseLabel ?? ""}/${slideLabel}/${current.object}`}
            comments={thread ? thread.replies + 1 : 0}
            onComments={() => onSearch({ tab: "comments" })}
          />
        </Zone>
        {viewZone}
      </>
    ) : (
      <DisplayTab
        display={display}
        preset={preset}
        extraLocks={extraLocks}
        viewer
        presetOpen={setup.presetOpen}
        onPresetPick={setPreset}
        onSaveAs={() => onSearch({ modal: "preset" })}
        resultSets={resultSetRows}
        after={viewZone}
      />
    );

  const commentsBody = shownPin ? (
    <PinnedThread
      key={`${shownPin.x},${shownPin.y}`}
      pin={shownPin}
      taskId={session.taskId}
      slideId={session.slideId}
      offReason={setup.connLost ? netOff : undefined}
      onCancel={leaveComment}
      onPosted={() => {
        setPin(null);
        setToast({ id: Date.now(), text: "Thread pinned on the slide." });
      }}
    />
  ) : selected ? (
    <ObjectComments
      object={selected}
      threads={session.threads}
      meId={session.meId}
      blind={session.task?.blinded ?? false}
      blindReviewers={[]}
      offReason={setup.connLost ? netOff : undefined}
    />
  ) : (
    <ThreadsTab
      taskId={session.taskId}
      slideId={session.slideId}
      slideLabel={slideLabel}
      hidden={nothing}
      onOpen={(anchor) => onSearch({ object: anchor, tab: "comments" })}
      onGoTo={(anchor) => onSearch({ object: anchor, tab: "objects" })}
    />
  );

  const opinionBody = (
    <SlideDoneCard
      panel
      className="min-h-full"
      slideNumber={session.neighbours?.position ?? 1}
      counts={{ ...counts, added: added.length }}
      questions={questions}
      blockers={doneBlockers}
      submitLabel={failed ? "Try again" : "Submit"}
      failed={failed}
      {...(readOnly ? { lockedReason: "Signed off 15 Oct. Changes need an amendment." } : {})}
      onSubmit={submit}
      onAnswerChange={(id, value) => setOpinion({ ...opinion, [id]: value })}
    />
  );

  const banner = setup.connLost ? (
    <Banner
      tone="warn"
      actions={
        <Button size="sm" onClick={() => setToast({ id: Date.now(), text: "Still offline" })}>
          Retry now
        </Button>
      }
    >
      <b>Connection lost.</b> Decisions can't be saved right now. Nothing is lost. Retrying...
    </Banner>
  ) : readOnly ? (
    <Banner
      tone="info"
      icon="lock"
      actions={
        <Button size="sm">
          Ask {person(session.task?.created_by_user_id)?.name.split(" ")[0] ?? "the researcher"} to
          amend
        </Button>
      }
    >
      <b>Signed off 15 Oct.</b> Changes need an amendment.
    </Banner>
  ) : setup.sourceOff ? (
    <Banner
      tone="warn"
      icon="link"
      actions={
        <Button
          size="sm"
          onClick={() => void router.navigate({ href: `${destinations.admin()}?section=storage` })}
        >
          Source status
        </Button>
      }
    >
      <b>Scanner archive is not answering since 10:40.</b> {slideLabel} is read in place from there,
      so it opens from the 7-day tile cache. Places never viewed show a quiet checker until the
      source is back.
    </Banner>
  ) : null;

  const canvasNotice =
    setup.issue === "slidefail" ? (
      <CanvasNotice
        icon="warn"
        title={`${slideLabel} could not be read at 20x and 40x.`}
        actions={
          <>
            <Button variant="primary">Retry</Button>
            <Button>Ask the researcher</Button>
          </>
        }
      >
        Tiles are missing on the server. Lower magnifications still show, and your other slides
        work.
      </CanvasNotice>
    ) : setup.issue === "withdrawn" ? (
      <CanvasNotice
        icon="info"
        title={`${session.task?.code ?? "The task"} was withdrawn.`}
        actions={
          <Button variant="primary" onClick={() => void navigate({ to: "/my-work" })}>
            Back to My work
          </Button>
        }
      >
        {person(session.task?.created_by_user_id)?.name ?? "The researcher"} withdrew{" "}
        {session.task?.code ?? "the task"} on 16 Oct. Your 7 decided slides are kept and show in the
        report.
      </CanvasNotice>
    ) : setup.issue === "noresults" ? (
      <CanvasNotice
        icon="smart"
        title={`No ${setName} result on ${slideLabel} yet.`}
        actions={<Button>Ask the researcher</Button>}
      >
        Look at the slide without AI, or ask the researcher to run the model.
      </CanvasNotice>
    ) : null;

  const whole = stillView.kind === "whole";
  const tileHint =
    setup.tileHint === "loading" ? (
      <TileHint percent={40}>Loading sharper tiles · 12 left</TileHint>
    ) : setup.tileHint === "unloaded" ? (
      <TileHint percent={6}>Loading the slide</TileHint>
    ) : setup.tileHint === "slow" ? (
      <TileHint
        className="w-112"
        percent={70}
        action={
          <Button
            size="sm"
            onClick={() =>
              void router.navigate({ href: `${destinations.admin()}?section=storage` })
            }
          >
            Source status
          </Button>
        }
      >
        <b>Slow source.</b> The scanner archive answers in 2.4 s. Keep reading, the view sharpens as
        tiles arrive. Lower magnifications come first.
      </TileHint>
    ) : null;

  const topBar = (
    <ReviewTop
      mode="full"
      onWholeSlide={() => onSearch({ peek: true })}
      session={
        noTask
          ? {
              ...session,
              taskName: projectName,
              taskSub: session.caseLabel ? `Case ${session.caseLabel}` : projectCode,
              neighbours: undefined,
            }
          : session
      }
      counts={counts}
      nothingToDecide={running || nothing}
      {...(running ? { progressSub: "The AI is still reading" } : {})}
      {...(clinical
        ? {
            primaryLabel: "Open report",
            primaryTitle: "Open the clinical report of this case",
            onSubmit: () =>
              void navigate({
                to: "/projects/$projectId/slides/$slideId/report",
                params: { projectId, slideId },
              }),
          }
        : {
            submitReason: nothing
              ? "Nothing to decide on this slide"
              : counts.open
                ? `${counts.open} object${counts.open === 1 ? " is" : "s are"} still open.`
                : undefined,
            onSubmit: () => onSearch({ tab: "opinion" }),
          })}
    />
  );

  return (
    <>
      <ViewerFrame
        session={session}
        counts={counts}
        tool={shownReviewTool(search.tool, running || nothing)}
        railGroups={reviewRail}
        panelHead={
          nothing ? null : (
            <AnalysisCards
              parts={viewerParts}
              areas={stagingAreas}
              current={selected}
              visited={areaNav.visited}
              roleOf={areaRole}
              onGoTo={areaNav.goTo}
              onStart={areaNav.goTo}
              onSubmit={() => onSearch({ tab: "opinion" })}
            />
          )
        }
        onToolChange={pickTool}
        onCompare={() => onSearch({ scene: "picking", object: undefined, tool: undefined })}
        overlay={
          peekOpen ? (
            <SlidePeek
              slideName={session.slideName}
              areas={areas}
              checked={regions
                .filter((region) => answer(region.object))
                .map((region) => region.object)}
              atCell={navigator === "cells" || navigator === "focus" || current?.kind === "cell"}
              held={peekHeld}
              onClose={closePeek}
              onPick={(point) => {
                if (!areaNav.jump(peekSpot(point))) closePeek();
              }}
            />
          ) : null
        }
        tab={tab}
        onTabChange={(next) => onSearch({ tab: next as ViewerTab })}
        topBar={topBar}
        scene={scene ?? "objects"}
        banner={banner}
        below={
          view === "table" ? (
            <ObjectTablePanel
              slideLabel={slideLabel}
              rows={tableRows(
                objects,
                added.map((item) => ({
                  object: item.object,
                  size: addedSize(item.note),
                  note: item.note,
                })),
                answer,
                format,
              )}
              stats={stats}
              classColour={(name) =>
                session.classes.find((item) => item.name === name)?.color ?? "var(--fg-faint)"
              }
              showScore={showScore}
              cutoff={settings.cutoff}
              selected={selected}
              onPick={(object) => onSearch({ object })}
              onCsv={() =>
                setToast({ id: Date.now(), text: "Downloads the table as CSV with full IDs" })
              }
            />
          ) : null
        }
        tabs={[
          {
            value: "objects",
            label: "Objects",
            count: running ? (progress?.found.length ?? 0) : counts.total,
            body: objectsBody,
            ...(objectsFoot ? { foot: objectsFoot } : {}),
          },
          { value: "display", label: "Display", body: displayBody },
          {
            value: "comments",
            label: "Comments",
            ...(nothing ? {} : { count: session.threads.filter((item) => !item.resolved).length }),
            body: commentsBody,
          },
          { value: "opinion", label: "Opinion", body: opinionBody },
        ]}
      >
        {navigator === "overview" ? (
          <OverviewCanvas areas={areas} checked={["T1"]} />
        ) : navigator ? (
          <NavigatorCanvas
            scene={navigator}
            areas={ranked}
            decided={decidedRegions}
            current="T2"
            onPeek={() => onSearch({ peek: true })}
            onTravel={() => onSearch({ scene: "travel" })}
            onGoTo={(object) => onSearch({ scene: undefined, object })}
            onPopOut={() =>
              setToast({ id: Date.now(), text: "Opens the whole slide on the second monitor" })
            }
          />
        ) : measurement ? (
          <MeasureCanvas measurement={measurement} regionSize={firstRegion?.size_mm ?? 0} />
        ) : (
          <SlideStill
            view={stillView}
            camera={shownCamera}
            onCameraChange={setCamera}
            regionDecisions={regionDecisions}
            cellDecisions={cellDecisions}
            ringedCells={confirmRest ? openCells.map((cell) => cell.object) : []}
            claimHidden={!showsClaim(style)}
            drawAs={settings.draw}
            showIds={settings.ids}
            failed={setup.issue === "slidefail"}
            bare={nothing || running}
            minimap={false}
            hint={false}
            tiles={setup.tiles}
            slideName={session.slideName}
            regionStyle={drawing.regionStyle}
            tags={running || nothing ? [] : drawing.tags}
            underlay={running ? () => <RunningHeat /> : drawing.underlay}
            onPointPick={(point) => {
              const placed = pinForClick(search.tool, point);
              if (placed === null) return;
              setPin(placed);
              onSearch({ object: undefined, tab: "comments" });
            }}
            overlay={(still) => (
              <>
                {canvasNotice}
                {shownPin ? (
                  <PinMark pin={shownPin} camera={still.camera} size={still.size} />
                ) : null}
                {drawing.legend ? (
                  <div className="absolute top-4 left-4">{drawing.legend}</div>
                ) : null}
                {drawing.extra}
                {whole && cells.length && !running && view === "panel" ? (
                  <CellCluster
                    className="absolute top-[50%] left-[54%]"
                    split={countAnswers(cells, answer)}
                    onClick={() => pick(firstOpenCell)}
                  />
                ) : null}
                {current?.kind === "cell" ? (
                  cellsOpen ? (
                    <CellsGrid
                      className="absolute bottom-18 left-1/2 w-fit -translate-x-1/2"
                      cells={cells}
                      current={current.object}
                      answer={answer}
                      answerKeys={answersOf(style, session.classes, current).map(
                        (item) => item.key,
                      )}
                      claimHidden={!showsClaim(style)}
                      folded={cellsFolded}
                      confirming={confirmRest}
                      onPick={(object) => pick(object)}
                      onAgreeRest={() => setConfirmRest(true)}
                      onCancelRest={() => setConfirmRest(false)}
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
                        setConfirmRest(false);
                        setToast({
                          id: Date.now(),
                          text: `${openCells.length} cells marked agree`,
                          undo: () => setOverrides(overrides),
                        });
                      }}
                      onFoldChange={setCellsFolded}
                      onClose={() => setCellsOpen(false)}
                    />
                  ) : (
                    <CellsLauncher
                      className="absolute bottom-18 left-1/2 -translate-x-1/2"
                      decided={cells.length - openCells.length}
                      total={cells.length}
                      onClick={() => setCellsOpen(true)}
                    />
                  )
                ) : null}
                {whole ? null : (
                  <Button
                    size="lg"
                    className="absolute bottom-4 left-4"
                    onClick={() => pick(undefined)}
                  >
                    <Icon name="expand" />
                    Whole slide
                  </Button>
                )}
                <div className="absolute bottom-4 left-1/2 grid -translate-x-1/2 justify-items-center gap-2">
                  {tileHint}
                  <MagnificationBar
                    magnification={
                      camera
                        ? magnificationOf(stillView, camera)
                        : stillView.kind === "cell"
                          ? 40
                          : whole
                            ? 1.25
                            : 2.5
                    }
                    scaleLabel={stillView.kind === "cell" ? "10 µm" : whole ? "5 mm" : "500 µm"}
                    scalePx={92}
                    micronsPerPixel={stillView.kind === "cell" ? 0.11 : whole ? 33.87 : 4.43}
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
        )}
      </ViewerFrame>
      <SavePresetModal
        open={search.modal === "preset"}
        slideLabel={slideLabel}
        taskCode={session.task?.code ?? "this task"}
        taken={[
          ...(session.display?.presets ?? []).map((item) => item.name),
          ...saved.map((item) => item.name),
        ]}
        onClose={() => onSearch({ modal: undefined })}
        onSave={(name) => {
          const key = `⇧${(session.display?.presets.length ?? 0) + saved.length + 2}`;
          setSaved([...saved, { name, key }]);
          setPreset(name);
          onSearch({ modal: undefined });
          setToast({
            id: Date.now(),
            text: `Preset ${name} saved.`,
            undo: () => {
              setSaved(saved);
              setPreset(preset);
            },
          });
        }}
      />
    </>
  );
}

function RunningHeat() {
  return (
    <>
      <defs>
        <clipPath id="running-clip">
          <rect x={0} y={0} width={1400} height={1924 * 0.55} />
        </clipPath>
      </defs>
      <image
        href="/mock-assets/tumor-heat.png"
        width={1400}
        height={1924}
        opacity={0.5}
        clipPath="url(#running-clip)"
      />
      <line
        x1={0}
        x2={1400}
        y1={1924 * 0.55}
        y2={1924 * 0.55}
        stroke="var(--accent)"
        strokeWidth={2}
        strokeDasharray="8 6"
        vectorEffect="non-scaling-stroke"
      />
    </>
  );
}

function TableObjectFacts({
  score,
  size,
  sets,
  answer,
  fullId,
  object,
  comments,
  onComments,
}: {
  object: string;
  score: number | null;
  size: number | null;
  sets: string[];
  answer: Answer | undefined;
  fullId: string;
  comments: number;
  onComments: () => void;
}) {
  const format = useFormat();
  const rows: [string, ReactNode][] = [
    ...(score === null
      ? []
      : [
          [
            "Score",
            <span key="s" className="font-mono">
              {format.number(score, { decimals: 2 })}
            </span>,
          ] as [string, ReactNode],
        ]),
    ["Size", size === null ? "" : `${format.size(size)} across`],
    ["In sets", sets.join(", ")],
    [
      "Your decision",
      answer
        ? `${answer.value === "unsure" ? "Not sure" : `${answer.value.charAt(0).toUpperCase()}${answer.value.slice(1)}`}${answer.reasons[0] ? `, ${answer.reasons[0].toLowerCase()}` : ""}`
        : "Open",
    ],
    ["Preset", answer ? "Task default" : "None yet"],
    [
      "Full ID",
      <span key="f" className="font-mono">
        {fullId}
      </span>,
    ],
  ];
  return (
    <>
      <dl className="m-0 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-body-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-fg-dim">{label}</dt>
            <dd className="m-0">{value}</dd>
          </div>
        ))}
      </dl>
      <Button className="w-full" onClick={onComments}>
        <Icon name="comment" />
        {comments} comments on {object}
      </Button>
    </>
  );
}
