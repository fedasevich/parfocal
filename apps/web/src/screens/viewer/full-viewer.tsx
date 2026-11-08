import {
  type AnalysisTemplate,
  type SlideAiProgress,
  useGetMyHome,
  useGetProject,
  useGetResultSetTyper,
  useGetSlideAiProgress,
  useGetSlideResultStats,
  useListCases,
  useListSlideResultSets,
  useSubmitSlideReview,
  type ViewerPart,
} from "@parfocal/api-client";
import { Banner } from "@parfocal/ui/components/banner";
import type { Blocker } from "@parfocal/ui/components/before-you-list";
import { Button } from "@parfocal/ui/components/button";
import { CellCluster, CellsLauncher } from "@parfocal/ui/components/cells-panel";
import type { DisplaySettings } from "@parfocal/ui/components/display-panel";
import { Icon } from "@parfocal/ui/components/icon";
import { InspectorPanel } from "@parfocal/ui/components/inspector-panel";
import { MagnificationBar } from "@parfocal/ui/components/magnification-bar";
import { ModelWarningsBlock } from "@parfocal/ui/components/model-warnings";
import { type OpinionQuestion, SlideDoneCard } from "@parfocal/ui/components/slide-done-card";
import { ObjectIdTag } from "@parfocal/ui/components/tag";
import { UndoToast } from "@parfocal/ui/components/undo-toast";
import {
  ClassVisibility,
  ResultSetRows,
  TileHint,
  ViewPicker,
} from "@parfocal/ui/components/visualize";
import { Zone } from "@parfocal/ui/components/zone";
import { inspectorCounts, inspectorTabLabels } from "@parfocal/ui/lib/inspector-tabs";
import { objectIdPath } from "@parfocal/ui/lib/object-id";
import {
  advanceScan,
  currentField,
  fieldCentre,
  type Scan,
  scanPath,
  scanSummary,
  startScan,
} from "@parfocal/ui/lib/systematic-scan";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { provideDebug } from "../../debug-handle.ts";
import { useFormat } from "../../format.ts";
import { escLayer } from "../../keys/esc-ladder.ts";
import { destinations } from "../../shell/destinations.ts";
import { useResolvedSettings } from "../../shell/resolved-settings.ts";
import { formatDayMonth } from "../format.ts";
import { useRememberResume } from "../home/remember-resume.ts";
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
  rawFor,
  showsClaim,
} from "../review/decision-style.ts";
import { disagreeOptions, reasonDraft } from "../review/disagree-reasons.ts";
import {
  type DisplayLock,
  DisplayTab,
  displaySettings,
  withOverrides,
} from "../review/display-tab.tsx";
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
import { recallSlideCamera, rememberSlideCamera } from "../review/slide-switch.ts";
import { ThreadsTab, useOpenThreadsWarning } from "../review/threads-tab.tsx";
import { overviewTissue, scanField, scanScale } from "../review/tissue-mask.ts";
import { useDecisionSaves } from "../review/use-decision-saves.ts";
import { useOpinionDraft } from "../review/use-opinion-draft.ts";
import {
  AiSays,
  type ListFilter,
  ObjectList,
  ObjectsSummary,
  ViewerFrame,
} from "../review/viewer-frame.tsx";
import { MeasureCanvas, measuredSize } from "../viewer-tools/measure-canvas.tsx";
import { MeasuredBlock } from "../viewer-tools/measured-block.tsx";
import type { ScreenRect } from "../viewer-tools/minimap-placement.ts";
import { NavigatorCanvas, OverviewCanvas } from "../viewer-tools/navigator-canvas.tsx";
import { peekSpot } from "../viewer-tools/peek-model.ts";
import { reviewRail, reviewRailKeys } from "../viewer-tools/rails.ts";
import { SlidePeek, usePeekKey } from "../viewer-tools/slide-peek.tsx";
import { ViewerMinimap } from "../viewer-tools/viewer-minimap.tsx";
import { areaOrder, areaRoleText, areaRows } from "./area-nav.ts";
import { layerDrawing, setColours } from "./layer-views.tsx";
import { confidenceTintOf, objectStyle } from "./object-draw.ts";
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
import { viewerModelWarnings } from "./viewer-model-warnings.ts";
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
      template={project.template}
    />
  );
}

type BodyProps = FullViewerProps & {
  session: ReviewSession;
  clinical: boolean;
  projectCode: string;
  projectName: string;
  viewerParts: ViewerPart[];
  template: AnalysisTemplate;
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
  template,
}: BodyProps) {
  const format = useFormat();
  const projectCases = okData(
    useListCases({ project_id: projectId }, { query: { enabled: clinical } }).data,
  );
  const reportCaseId = (
    projectCases?.find((item) => item.label === session.caseLabel) ?? projectCases?.[0]
  )?.id;
  const scene = search.scene;
  const setup = viewerSetup(scene);
  const navigator = isNavigatorScene(scene) ? scene : null;
  const measuring = search.tool === "ruler";
  const personalSettings = useResolvedSettings();
  const minimapSetting = personalSettings?.minimap ?? "useful";
  const peekOpen = search.peek === true;
  const [peekHeld, setPeekHeld] = useState(false);
  const navigate = useNavigate();
  const router = useRouter();
  const person = usePeople();
  const submitReview = useSubmitSlideReview();
  const threadsWarning = useOpenThreadsWarning(session.taskId, session.slideId);
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
  const typerSetId = session.task?.slides[0]?.result_set_id;
  const typer = okData(
    useGetResultSetTyper(typerSetId ?? "", { query: { enabled: typerSetId !== undefined } }).data,
  );
  const running = progress?.state === "running";
  const style = session.style;
  const decisions = useDecisionSaves(session, style);
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
  const [cellsRect, setCellsRect] = useState<ScreenRect | null>(null);
  const [cellsFolded, setCellsFolded] = useState(false);
  const [confirmRest, setConfirmRest] = useState(false);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const noTumor = regions.length === 0 && !running;
  const scanStep = () => {
    const next = scan ? advanceScan(scan) : startScan(scanPath(overviewTissue, scanField));
    setScan(next);
    const field = currentField(next);
    if (field === null) return;
    const [x, y] = fieldCentre(field);
    if (search.object !== undefined) onSearch({ object: undefined });
    setCamera({ x, y, scale: scanScale });
  };
  const [pin, setPin] = useState<Pin | null>(null);
  const shownPin = search.tool === "comment" ? pin : null;
  const leaveComment = () => {
    setPin(null);
    onSearch({ tool: undefined });
  };
  const [note, setNote] = useState({ open: false, reasons: [] as string[], text: "" });
  const [preset, setPreset] = useState<string | null>(setup.preset);
  const [idLabels, setIdLabels] = useState<boolean | null>(null);
  const [drawOverrides, setDrawOverrides] = useState<Partial<DisplaySettings>>({});
  const [hiddenClasses, setHiddenClasses] = useState<ReadonlySet<string>>(new Set());
  const [shownSets, setShownSets] = useState<Record<string, boolean>>({ reviewed: true });
  const [saved, setSaved] = useState<{ name: string; key: string }[]>([]);
  const [failed, setFailed] = useState(setup.submitFail);
  const [tellMe, setTellMe] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void; id: number } | null>(null);
  const { answers: opinion, change: changeOpinion } = useOpinionDraft(session);
  const firstOpenCell = cells.find((cell) => !answer(cell.object))?.object ?? cells[0]?.object;
  const firstRegion = regions[0];
  const measurement =
    measuring && firstRegion
      ? { object: "M1", mm: measuredSize(firstRegion.size_mm ?? 0), across: firstRegion.object }
      : null;
  const foundSoFar = (object: string) => !running || (progress?.found.includes(object) ?? false);
  const stagingAreas = regions
    .filter((region) => foundSoFar(region.object))
    .map((region) => ({
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
  const pickedSettings = withOverrides(
    displaySettings(display, preset, extraLocks),
    drawOverrides,
    display,
    extraLocks,
  );
  const settings = idLabels === null ? pickedSettings : { ...pickedSettings, ids: idLabels };
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
  const pathOfObject = (object: string) =>
    objectIdPath({ project: projectCode, caseLabel: session.caseLabel, slide: slideLabel, object });
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
  const setsLock = session.display?.locks.find((lock) => lock.setting === "other-sets");
  const setIsShown = (key: string) => shownSets[key] ?? false;
  const otherSetsOn = setsLock
    ? []
    : slideSets.filter((set) => set.id !== taskSetId && setIsShown(set.id));
  const reviewedOn = setIsShown("reviewed");
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
    const kept = answer(current.object);
    const next = put(current.object, {
      value,
      raw,
      reasons: kept?.value === value ? kept.reasons : [],
      note: kept?.note ?? null,
    });
    decisions.save(current.object, raw, value);
    setToast({
      id: Date.now(),
      text: `${current.object}: ${value === "unsure" ? "not sure" : value}`,
      undo: () => {
        setOverrides(new Map(next).set(current.object, kept ?? null));
        decisions.restore(current.object, kept);
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
  const notNucleus = (object: string) => {
    const target = cells.find((item) => item.object === object);
    if (target === undefined || answer(object)) return;
    const raw = rawFor(style, "disagree", target);
    const reasons = ["Not a cell"];
    const before = overrides;
    put(object, { value: "disagree", raw, reasons, note: null });
    decisions.save(
      object,
      raw,
      "disagree",
      reasonDraft(reasons, disagreeOptions(target.kind, target.class_name, session.classes)),
    );
    setToast({
      id: Date.now(),
      text: `${object}: not a nucleus, counts as disagree`,
      undo: () => {
        setOverrides(before);
        decisions.restore(object, undefined);
      },
    });
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
        search: { task: session.taskId, ...(route.tool ? { tool: route.tool } : {}) },
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
      if (event.key !== "Escape") return;
      const layer = escLayer({
        overlay: peekOpen,
        comment: escapeComment({ tool: search.tool, pin: shownPin }) !== null,
        dragging: false,
        draft: false,
        run: false,
        vertex: false,
        selection: Boolean(selected),
        focusReview: search.focus === true,
        tool: false,
        panel: false,
      });
      if (layer === "comment") leaveComment();
      else if (layer === "selection") pick(undefined);
      else if (layer === "focus") onSearch({ focus: undefined });
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
      if (fired.action === "nextarea" && !navigator && noTumor && scan !== null) {
        if (fired.phase === "press") scanStep();
        return true;
      }
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
  const meId = session.meId;
  useRememberResume(
    scene === undefined
      ? {
          task_id: session.taskId,
          slide_id: slideId,
          mode: "viewer",
          object_id: search.object ?? null,
          camera:
            search.x !== undefined && search.y !== undefined && search.z !== undefined
              ? { x: search.x, y: search.y, z: search.z }
              : null,
        }
      : null,
  );
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (opened.current === slideId) return;
    opened.current = slideId;
    const hasCamera = search.x !== undefined && search.y !== undefined && search.z !== undefined;
    if (hasCamera || search.object !== undefined) return;
    const remembered = recallSlideCamera(meId, slideId);
    if (remembered.z !== undefined) writeSearch.current(remembered);
  }, [meId, slideId, search.x, search.y, search.z, search.object]);
  const pendingCamera = useRef<CameraSearch | null>(null);
  useEffect(() => {
    if (camera === null) return;
    const rest = cameraToSearch(cameraImage, camera);
    pendingCamera.current = rest;
    const timer = setTimeout(() => {
      pendingCamera.current = null;
      rememberSlideCamera(meId, slideId, rest);
    }, cameraWriteDelayMs);
    return () => clearTimeout(timer);
  }, [camera, cameraImage, slideId, meId]);
  useEffect(
    () => () => {
      if (pendingCamera.current === null) return;
      rememberSlideCamera(meId, slideId, pendingCamera.current);
      pendingCamera.current = null;
    },
    [meId, slideId],
  );
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
    otherSets: otherSetsOn.map((set) => ({ id: set.id, color: setColours.b })),
    reviewedOn,
  });
  const showScore = confidence !== "hidden";
  const classColour = (name: string) =>
    session.classes.find((item) => item.name === name)?.color ?? "var(--fg-faint)";
  const styleOfObject = (id: string) => {
    const object = objects.find((item) => item.object === id);
    if (!object) return undefined;
    return objectStyle(object, {
      settings: {
        draw: settings.draw,
        width: settings.width,
        opacity: settings.opacity,
        colorBy: settings.colorBy,
        cutoff: settings.cutoff,
      },
      hiddenClasses,
      classColour,
      decisionOf: (name) => answer(name)?.value,
    });
  };
  const classVisibility = (
    <ClassVisibility
      rows={session.classes.map((item, index) => ({
        name: item.name,
        color: item.color,
        count: objects.filter((object) => object.class_name === item.name).length,
        visible: !hiddenClasses.has(item.name),
        key: String(index + 1),
      }))}
      onVisibleChange={(name, visible) =>
        setHiddenClasses((now) => {
          const next = new Set(now);
          if (visible) next.delete(name);
          else next.add(name);
          return next;
        })
      }
    />
  );

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
        <ModelWarningsBlock
          warnings={viewerModelWarnings(typer, objects, personalSettings?.model_warnings ?? true)}
        />
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
      onToggle={(key, on) => setShownSets((current) => ({ ...current, [key]: on }))}
      locked={
        setsLock
          ? {
              reason: `Locked by ${session.display?.task_code ?? "the task"}: ${setsLock.reason.charAt(0).toLowerCase()}${setsLock.reason.slice(1)}`,
            }
          : undefined
      }
      sets={[
        ...slideSets.map((set) => {
          const task = set.id === taskSetId;
          return {
            key: set.id,
            name: `${set.name} ${set.model_version ?? ""}`.trim(),
            sub: `${set.source === "run" ? "Run here" : "Imported"} ${formatDayMonth(new Date(set.produced_at ?? set.created_at))}${task ? " · the result this task checks" : ""}`,
            color: task ? setColours.a : setColours.b,
            fixed: task,
            on: task ? false : setsLock ? false : setIsShown(set.id),
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
          on: reviewedOn,
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
            fullId={pathOfObject(current.object)}
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
        onPresetPick={(name) => {
          setDrawOverrides({});
          setPreset(name);
        }}
        overrides={drawOverrides}
        onSettingChange={(key, value) => setDrawOverrides((now) => ({ ...now, [key]: value }))}
        classVisibility={classVisibility}
        onSaveAs={() => onSearch({ modal: "preset" })}
        resultSets={resultSetRows}
        after={viewZone}
        idLabels={{ on: settings.ids, onChange: setIdLabels }}
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
      warning={threadsWarning}
      {...(readOnly ? { lockedReason: "Signed off 15 Oct. Changes need an amendment." } : {})}
      onSubmit={submit}
      onAnswerChange={changeOpinion}
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
      object={selected ?? undefined}
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
              reportCaseId !== undefined &&
              void navigate({
                to: "/projects/$projectId/cases/$caseId/report",
                params: { projectId, caseId: reportCaseId },
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

  const tabCounts = inspectorCounts({
    objects: running ? (progress?.found.length ?? 0) : counts.total,
    resultSets: slideSets.length + 1,
    threads: nothing ? [] : session.threads,
    questions: questions.map((question) => ({ answered: Boolean(question.answer) })),
  });
  const inspector = (
    <InspectorPanel
      width={340}
      value={tab}
      onValueChange={(next) => onSearch({ tab: next as ViewerTab })}
      template={template}
      parts={viewerParts}
      counts={tabCounts}
      bodies={{
        objects: { body: objectsBody, foot: objectsFoot },
        display: { body: displayBody },
        comments: { body: commentsBody },
        opinion: { body: opinionBody },
      }}
      staging={
        nothing
          ? undefined
          : {
              areas: stagingAreas,
              running,
              current: selected,
              visited: areaNav.visited,
              roleOf: running ? undefined : areaRole,
              onGoTo: areaNav.goTo,
              onStart: areaNav.goTo,
              onSubmit: () => onSearch({ tab: "opinion" }),
              scan: noTumor ? scanSummary(overviewTissue, scan) : null,
              onScan: scanStep,
            }
      }
    />
  );

  return (
    <>
      <ViewerFrame
        session={session}
        counts={counts}
        tool={shownReviewTool(search.tool, running || nothing)}
        railGroups={reviewRail}
        railKeys={reviewRailKeys}
        panel={inspector}
        panelTab={{ label: inspectorTabLabels[tab], count: tabCounts[tab] }}
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
              pathOf={pathOfObject}
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
            regionStyle={(object) => drawing.regionStyle(object) ?? styleOfObject(object)}
            cellStyle={styleOfObject}
            currentTint={
              confidence === "color" && current ? confidenceTintOf(current.score) : undefined
            }
            tags={running || nothing ? [] : drawing.tags}
            underlay={
              running ? () => <RunningHeat reached={readReach(progress)} /> : drawing.underlay
            }
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
                {nothing || running || setup.issue === "slidefail" ? null : (
                  <ViewerMinimap
                    setting={minimapSetting}
                    view={stillView}
                    camera={still.camera}
                    size={still.size}
                    areas={areas}
                    checked={regions
                      .filter((region) => answer(region.object))
                      .map((region) => region.object)}
                    blockLeft={!whole}
                    blockToast={toast !== null}
                    cells={cells.map((cell) => ({
                      object: cell.object,
                      decided: answer(cell.object) !== undefined,
                    }))}
                    pins={shownPin ? [shownPin] : []}
                    cellsPanel={cellsRect}
                    onMoveView={setCamera}
                    onOpen={() => onSearch({ peek: true })}
                    onPopOut={() =>
                      setToast({
                        id: Date.now(),
                        text: "Opens the whole slide on the second monitor",
                      })
                    }
                  />
                )}
                {whole && cells.length && !running && view === "panel" ? (
                  <CellCluster
                    className="absolute top-[50%] left-[54%]"
                    split={countAnswers(cells, answer)}
                    onClick={() => pick(firstOpenCell)}
                  />
                ) : null}
                {current?.kind === "cell" ? (
                  cellsOpen ? (
                    <MeasuredBlock
                      className="absolute bottom-18 left-1/2 w-fit -translate-x-1/2"
                      onRect={setCellsRect}
                    >
                      <CellsGrid
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
                        onNotNucleus={buttonsOff ? undefined : notNucleus}
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
                    </MeasuredBlock>
                  ) : (
                    <MeasuredBlock
                      className="absolute bottom-18 left-1/2 -translate-x-1/2"
                      onRect={setCellsRect}
                    >
                      <CellsLauncher
                        decided={cells.length - openCells.length}
                        total={cells.length}
                        onClick={() => setCellsOpen(true)}
                      />
                    </MeasuredBlock>
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

function readReach(progress: SlideAiProgress | undefined) {
  const regionsStep = progress?.steps.find((step) => step.key === "regions");
  return Math.min(1, Math.max(0, (regionsStep?.percent ?? 0) / 100));
}

function RunningHeat({ reached }: { reached: number }) {
  return (
    <>
      <defs>
        <clipPath id="running-clip">
          <rect x={0} y={0} width={1400} height={1924 * reached} />
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
        data-testid="ai-reached"
        data-reached={reached}
        x1={0}
        x2={1400}
        y1={1924 * reached}
        y2={1924 * reached}
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
      <ObjectIdTag key="f" copyText={fullId}>
        {fullId}
      </ObjectIdTag>,
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
