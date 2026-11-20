import { useLingui } from "@lingui/react/macro";
import type { ReviewObject } from "@parfocal/api-client";
import {
  useGetMyTrackRecord,
  useGetResultSetTyper,
  useGetSlideAiProgress,
  useGetSlideResultStats,
  useListCases,
  useListSlideResultSets,
  useSubmitSlideReview,
} from "@parfocal/api-client";
import { type AreaCall, countOf } from "@parfocal/ui/lib/area-call";
import { CHANGED_ZONE_ID, CHANGED_ZONE_NAME } from "@parfocal/ui/lib/findings-layout";
import { objectIdPath } from "@parfocal/ui/lib/object-id";
import {
  advanceScan,
  currentField,
  fieldCentre,
  type Scan,
  scanPath,
  startScan,
} from "@parfocal/ui/lib/systematic-scan";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { deviceIntentEvent } from "../../devices/gamepad-source.ts";
import type { Intent } from "../../devices/intents.ts";
import { useFormat } from "../../format.ts";
import { escLayer } from "../../keys/esc-ladder.ts";
import { useConnection } from "../../shell/connection.ts";
import { useLabDecisionCutoff, useResolvedSettings } from "../../shell/resolved-settings.ts";
import { useCellTiming, useChromeSampling, useTaskRun } from "../../telemetry/use-task-timing.ts";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { useAnswerKeys } from "../review/answer-keys.ts";
import { type CellSpot, panned, previousOpen } from "../review/cell-jump.ts";
import { useSetName } from "../review/cells-on-slide.tsx";
import { escapeComment, type Pin } from "../review/comment-pin.ts";
import { answersOf, type Confidence, countsAs, rawFor } from "../review/decision-style.ts";
import { disagreeOptions, reasonDraft } from "../review/disagree-reasons.ts";
import { shownSetsOf } from "../review/display-model.ts";
import { type DisplayLock, displaySettings, withOverrides } from "../review/display-tab.tsx";
import { useFirstReadGate } from "../review/first-read-gate.ts";
import { finishingAnswers } from "../review/guided-scenes.ts";
import { useNoteKey } from "../review/note-key.ts";
import { reasonBody, withNote } from "../review/note-model.ts";
import { useObjectKeys } from "../review/object-keys.ts";
import { useOthersNotes } from "../review/others-notes.ts";
import { routeReviewTool, useReviewToolKeys } from "../review/review-rail.ts";
import {
  type Answer,
  type Answers,
  answerOf,
  baseAnswers,
  countAnswers,
} from "../review/review-state.ts";
import { cellShapes } from "../review/slide-geometry.ts";
import type { Camera } from "../review/slide-still.tsx";
import { useOpenThreadsWarning } from "../review/threads-tab.tsx";
import { overviewTissue, scanField, scanScale } from "../review/tissue-mask.ts";
import {
  chosenType,
  type TypeChoice,
  typeAnswers,
  typeChoice,
  typeOptions,
} from "../review/type-bar.ts";
import { useCellArrows } from "../review/type-bar.tsx";
import { useDecisionSaves } from "../review/use-decision-saves.ts";
import { useDisplayChoice, useShiftPresetKeys } from "../review/use-display-choice.ts";
import { useOpinionDraft } from "../review/use-opinion-draft.ts";
import { usePagedReview } from "../review/use-paged-review.ts";
import type { ListFilter } from "../review/viewer-frame.tsx";
import type { ScreenRect } from "../viewer-tools/minimap-placement.ts";
import { usePeekKey } from "../viewer-tools/slide-peek.tsx";
import { scatteredCells, viewerFindingsLayout } from "./findings-data.ts";
import { useLearnerEmbeddings } from "./learner-embeddings.ts";
import { fixtureFeatures } from "./learner-fixture-features.ts";
import {
  changedCellIds,
  type LearnerView,
  labelsOnceCorrected,
  retypedCells,
} from "./slide-learner.ts";
import { swipeStart } from "./swipe-split.ts";
import { useAreaMeasures } from "./use-area-measures.ts";
import { emptyLearnerView, useSlideLearner } from "./use-slide-learner.ts";
import type { BodyProps } from "./viewer-model-types.ts";
import { isNavigatorScene, type LayerView, type ViewerTab, viewerSetup } from "./viewer-scenes.ts";
import { type CellZone, nextUnsureCell, zonesOfCells } from "./zone-cells.ts";
import { useRestKey, zoneTile } from "./zone-gallery.tsx";

const aiProgressPollMs = 3000;

export function useViewerState(props: BodyProps) {
  const { clinical, onSearch, projectCode, projectId, search, session, slideId, template } = props;
  const { t } = useLingui();
  const netOff = t`The connection is lost. It saves when the connection is back.`;
  const format = useFormat();
  const projectCases = okData(
    useListCases({ project_id: projectId }, { query: { enabled: clinical } }).data,
  );
  const reportCaseId = (
    projectCases?.find((item) => item.label === session.caseLabel) ?? projectCases?.[0]
  )?.id;
  const scene = search.scene;
  const setup = viewerSetup(scene);
  const { online } = useConnection();
  const navigator = isNavigatorScene(scene) ? scene : null;
  const measuring = search.tool === "ruler";
  const personalSettings = useResolvedSettings();
  const minimapSetting = personalSettings?.minimap ?? "useful";
  const peekOpen = search.peek === true;
  const [peekHeld, setPeekHeld] = useState(false);
  const [swipeAt, setSwipeAt] = useState(swipeStart);
  const navigate = useNavigate();
  const _router = useRouter();
  const person = usePeople();
  const submitReview = useSubmitSlideReview();
  const threadsWarning = useOpenThreadsWarning(session.taskId, session.slideId);
  const othersOn = useOthersNotes(session.taskId, session.slideId, session.meId);
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
  const trackRecord = okData(useGetMyTrackRecord().data);
  const running = progress?.state === "running";
  const style = session.style;
  const paged = usePagedReview(session.classes.map((item) => item.name));
  const fixtureObjects =
    setup.issue === "noresults" || setup.issue === "withdrawn" ? [] : session.objects;
  const firstReadGate = useFirstReadGate(session);
  const firstReadOpen = firstReadGate === "open";
  const [learnerView, setLearnerView] = useState<LearnerView>(emptyLearnerView);
  const typerObjects =
    paged && !firstReadOpen
      ? [...fixtureObjects.filter((item) => item.kind !== "cell"), ...paged.cells]
      : fixtureObjects;
  const objects = retypedCells(typerObjects, learnerView.changes);
  const decisions = useDecisionSaves({ ...session, objects }, style);
  const regions = objects.filter((item) => item.kind === "region");
  const cells = objects.filter((item) => item.kind === "cell");
  const added = setup.issue ? [] : session.added;
  const base = baseAnswers(
    objects,
    session.decisions,
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
  useEffect(() => {
    const onIntent = (event: Event) => {
      const intent = (event as CustomEvent<Intent>).detail;
      if (intent.kind !== "peek") return;
      if (intent.held) {
        setPeekHeld(true);
        if (!peekOpen) onSearch({ peek: true });
      } else if (peekOpen) {
        closePeek();
      }
    };
    window.addEventListener(deviceIntentEvent, onIntent);
    return () => window.removeEventListener(deviceIntentEvent, onIntent);
  });
  const [filter, setFilter] = useState<ListFilter>(setup.filter);
  const [cellsOpen, setCellsOpen] = useState(setup.cells);
  const [cellsRect, setCellsRect] = useState<ScreenRect | null>(null);
  const [cellsFolded, setCellsFolded] = useState(false);
  const [confirmRest, setConfirmRest] = useState(false);
  const [openZoneId, setOpenZoneId] = useState<string | null>(null);
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
  const choice = useDisplayChoice(session, setup.preset);
  const preset = choice.preset;
  const [hiddenClasses, setHiddenClasses] = useState<ReadonlySet<string>>(new Set());
  const shownSets = shownSetsOf(session.myDisplay?.settings);
  const [failed, setFailed] = useState(setup.submitFail);
  const [tellMe, setTellMe] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void; id: number } | null>(null);
  const { answers: opinion, change: changeOpinion } = useOpinionDraft(session);
  const firstOpenCell = cells.find((cell) => !answer(cell.object))?.object ?? cells[0]?.object;
  const firstRegion = regions[0];
  const measureAcross = measuring ? (search.across ?? firstRegion?.object ?? null) : null;
  const measures = useAreaMeasures(regions, session.slideSize, measureAcross);
  const measurement = measures.current;
  const foundSoFar = (object: string) => !running || (progress?.found.includes(object) ?? false);
  const stagingAreas = regions
    .filter((region) => foundSoFar(region.object))
    .map((region) => ({
      object: region.object,
      size: region.size_mm ?? 0,
      probability: region.score,
      call: answer(region.object)?.value ?? null,
      measured: measures.mmOf(region.object),
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
  const display = session.display;
  const labCutoff = useLabDecisionCutoff();
  const pickedSettings = withOverrides(
    displaySettings(display, preset, extraLocks, undefined, labCutoff),
    choice.overrides,
    display,
    extraLocks,
  );
  const settings = pickedSettings;
  useShiftPresetKeys(display, choice);
  const confidence = settings.confidence as Confidence;
  const readOnly = setup.readOnly;
  const buttonsOff = readOnly
    ? t`Signed off. Ask the researcher to amend.`
    : setup.issue === "slidefail"
      ? t`This part of the slide can't be read yet`
      : setup.connLost
        ? netOff
        : undefined;
  const slideLabel = session.slideName.split(" ")[0] ?? "";
  const pathOfObject = (object: string) =>
    objectIdPath({ project: projectCode, caseLabel: session.caseLabel, slide: slideLabel, object });
  const current = objects.find((item) => item.object === selected);
  const timing = useTaskRun("review", session.slideId, "viewer");
  useCellTiming(current?.object, current?.kind === "cell");
  useChromeSampling("viewer", search.focus === true ? "focus" : "chrome");
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
  const setB = shortName(stats?.model_vs_model.set_b_id ?? otherSet?.id) || t`the other set`;
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
  const decide = (raw: string, choice?: TypeChoice) => {
    if (current === undefined || buttonsOff) return;
    const value = choice?.value ?? countsAs(style, raw, current);
    const kept = answer(current.object);
    const next = put(current.object, {
      value,
      raw,
      reasons: choice?.reasons ?? (kept?.value === value ? kept.reasons : []),
      note: kept?.note ?? null,
    });
    decisions.save(
      current.object,
      raw,
      value,
      choice?.draft ??
        (kept?.value === value
          ? reasonBody(kept.reasons, value, current, session.classes)
          : undefined),
      kept?.note,
    );
    setToast({
      id: Date.now(),
      text: `${current.object}: ${value === "unsure" ? "not sure" : value}`,
      undo: () => {
        setOverrides(new Map(next).set(current.object, kept ?? null));
        decisions.restore(current.object, kept);
      },
    });
    if (value !== "agree") setNote({ open: true, reasons: choice?.reasons ?? [], text: "" });
    if (current.kind === "cell") {
      const inZone = openZone?.cells.some((cell) => cell.object === current.object)
        ? nextUnsureCell(openZone, current.object, (object) => !answerOf(base, next, object))
        : undefined;
      const after =
        inZone !== undefined
          ? { object: inZone }
          : cells.find(
              (cell, index) => index > cells.indexOf(current) && !answerOf(base, next, cell.object),
            );
      if (after) pick(after.object);
    }
  };
  const notNucleus = (object: string) => {
    const target = cells.find((item) => item.object === object);
    if (target === undefined || answer(object)) return;
    const raw = rawFor(style, "disagree", target);
    const reasons = [t`Not a cell`];
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
      text: t`${object}: not a nucleus, counts as disagree`,
      undo: () => {
        setOverrides(before);
        decisions.restore(object, undefined);
      },
    });
  };
  const saveNote = () => {
    if (current === undefined) return;
    const kept = answer(current.object);
    if (kept) {
      const next = withNote(kept, note);
      put(current.object, next);
      decisions.save(
        current.object,
        next.raw,
        next.value,
        reasonBody(next.reasons, next.value, current, session.classes),
        next.note,
      );
    }
    setNote({ ...note, open: false });
  };

  const pickTool = (next: string) => {
    const route = routeReviewTool(next);
    if (route === null) return;
    if (route.kind === "annotate") {
      void navigate({
        to: "/projects/$projectId/slides/$slideId",
        params: { projectId, slideId },
        search: { task: session.taskId, mode: "annotate", tool: route.tool },
      });
      return;
    }
    onSearch({
      tool: route.tool,
      ...(route.tool === "ruler" ? { object: undefined, scene: "objects" } : {}),
      ...(route.tab ? { tab: route.tab } : {}),
    });
  };

  useReviewToolKeys(pickTool, !peekOpen);

  useNoteKey(() => {
    if (current === undefined || tab !== "objects") return;
    const kept = answer(current.object);
    if (kept) setNote({ open: true, reasons: kept.reasons, text: kept.note ?? "" });
  });

  const onCell = current?.kind === "cell";
  const decideType = (id: string) => {
    if (current === undefined) return;
    const option = typeOptions.find((item) => item.id === id);
    if (option === undefined) decide(id);
    else {
      const choice = typeChoice(style, option, current, session.classes);
      decide(choice.raw, choice);
    }
  };
  useAnswerKeys(
    onCell ? typeAnswers : answersOf(style, session.classes, current),
    onCell ? decideType : decide,
    current !== undefined && tab === "objects",
  );
  const spots: CellSpot[] = cells.flatMap((cell) => {
    const shape = cellShapes[cell.object];
    return shape
      ? [
          {
            object: cell.object,
            x: shape.x,
            y: shape.y,
            decided: answer(cell.object) !== undefined,
          },
        ]
      : [];
  });
  const stillCamera = useRef<Camera | null>(null);
  useCellArrows({
    spots,
    current: current?.object,
    enabled: onCell && tab === "objects" && !peekOpen,
    onJump: pick,
    onPan: (direction) => {
      if (stillCamera.current) setCamera(panned(stillCamera.current, direction));
    },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable], [role=dialog], [role=menu]")) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        onSearch({ layout: "focus", scene: undefined, tool: undefined });
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (
        event.key === "Enter" &&
        current?.kind === "cell" &&
        !target.closest("button, a, summary, select")
      ) {
        event.preventDefault();
        onSearch({ layout: "focus", scene: undefined, tool: undefined });
        return;
      }
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
      else if (layer === null && openZoneId !== null && tab === "objects") setOpenZoneId(null);
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
  const typerCells = typerObjects.filter((item) => item.kind === "cell");
  const embeddings = useLearnerEmbeddings();
  const pooledFeaturesOf = paged === null ? fixtureFeatures : embeddings;
  const learning = pooledFeaturesOf !== null && !setup.issue && typerCells.length > 0;
  const learnerLabels = new Map<string, string>();
  for (const cell of cells) {
    const picked = chosenType(style, cell, session.classes, answer(cell.object));
    if (picked === undefined || picked === "notcell") continue;
    learnerLabels.set(cell.object, picked === "keep" ? cell.class_name : picked);
  }
  const learner = useSlideLearner({
    slideKey: slideId,
    enabled: learning,
    pooledFeaturesOf: pooledFeaturesOf ?? fixtureFeatures,
    input: {
      cells: typerCells,
      labels: labelsOnceCorrected(learnerLabels, typerCells),
      decided: (object) => answer(object) !== undefined,
    },
    onView: setLearnerView,
  });
  const changedIds = new Set(changedCellIds(learnerView.changes));
  const changedCells = cells.filter((cell) => changedIds.has(cell.object));
  const changedCellZone: CellZone | undefined =
    changedCells.length === 0
      ? undefined
      : { id: CHANGED_ZONE_ID, name: CHANGED_ZONE_NAME, cells: changedCells, total: changedCells };
  const hadChanged = useRef(false);
  const changedNow = changedCells.length;
  useEffect(() => {
    if (changedNow > 0 && !hadChanged.current) {
      setToast({
        id: Date.now(),
        text: t`The typer learned from your ${learnerView.corrections} corrections and changed ${changedNow} similar cells. They are in a new zone.`,
      });
    }
    hadChanged.current = changedNow > 0;
  }, [changedNow, learnerView.corrections, t]);
  const zones = zonesOfCells(cells, paged ?? undefined);
  const everyZone = changedCellZone ? [...zones, changedCellZone] : zones;
  const openZone = everyZone.find((zone) => zone.id === openZoneId);
  const openZoneCells = openZone?.cells.filter((cell) => !answer(cell.object)) ?? [];
  const nextInZone = () => {
    if (openZone === undefined) return;
    const next = nextUnsureCell(openZone, selected ?? undefined, (object) => !answer(object));
    if (next !== undefined) pick(next);
  };
  const restLookRight = () => {
    if (openZone === undefined || buttonsOff || openZoneCells.length === 0) return;
    const before = overrides;
    const next = new Map(overrides);
    for (const cell of openZoneCells) {
      const raw = rawFor(style, "agree", cell);
      decisions.save(cell.object, raw, "agree");
      next.set(cell.object, { value: "agree", raw, reasons: [], note: null });
    }
    setOverrides(next);
    setToast({
      id: Date.now(),
      text: t`${openZoneCells.length} cells in ${openZone.name} marked agree`,
      undo: () => {
        setOverrides(before);
        for (const cell of openZoneCells) decisions.restore(cell.object, undefined);
      },
    });
  };

  const zoneKeys = openZone !== undefined && tab === "objects";
  const previousInZone = () => {
    if (openZone === undefined) return;
    const order = openZone.cells.map((cell) => cell.object);
    const before = previousOpen(order, selected ?? undefined, (object) => !answer(object));
    if (before !== undefined) pick(before);
  };
  useObjectKeys(nextInZone, previousInZone, zoneKeys);
  useRestKey(restLookRight, zoneKeys);
  const findingsLayout = viewerFindingsLayout(template, zones.length, stagingAreas.length);
  const decidedObject = (object: string) => answer(object) !== undefined;
  const classColor = (name: string) =>
    session.classes.find((item) => item.name === name)?.color ?? "var(--fg-faint)";
  const tileOf = (cell: ReviewObject) => zoneTile(cell, answer(cell.object));
  const scattered = paged ? [] : scatteredCells(cells, zones);
  const unsureIds = new Set(
    [...zones.flatMap((zone) => zone.cells), ...scattered].map((cell) => cell.object),
  );
  const callArea = (id: string, call: AreaCall) => {
    const region = regions.find((item) => item.object === id);
    if (region === undefined || buttonsOff) return;
    const value = countOf(call);
    const raw = rawFor(style, value, region);
    const kept = answer(id);
    const next = put(id, { value, raw, reasons: [], note: kept?.note ?? null });
    decisions.save(id, raw, value, undefined, kept?.note);
    setToast({
      id: Date.now(),
      text: `${id}: ${value === "unsure" ? "not sure" : value}`,
      undo: () => {
        setOverrides(new Map(next).set(id, kept ?? null));
        decisions.restore(id, kept);
      },
    });
  };
  return {
    netOff,
    format,
    reportCaseId,
    scene,
    setup,
    online,
    navigator,
    personalSettings,
    minimapSetting,
    peekOpen,
    peekHeld,
    setPeekHeld,
    swipeAt,
    setSwipeAt,
    navigate,
    person,
    submitReview,
    threadsWarning,
    othersOn,
    progress,
    stats,
    slideSets,
    setName,
    typer,
    trackRecord,
    running,
    style,
    paged,
    firstReadOpen,
    learnerView,
    objects,
    regions,
    cells,
    added,
    overrides,
    setOverrides,
    answer,
    counts,
    areas,
    decidedRegions,
    closePeek,
    filter,
    setFilter,
    cellsOpen,
    setCellsOpen,
    cellsRect,
    setCellsRect,
    cellsFolded,
    setCellsFolded,
    confirmRest,
    setConfirmRest,
    openZoneId,
    setOpenZoneId,
    camera,
    setCamera,
    scan,
    noTumor,
    scanStep,
    pin,
    setPin,
    shownPin,
    leaveComment,
    note,
    setNote,
    choice,
    preset,
    hiddenClasses,
    setHiddenClasses,
    failed,
    setFailed,
    tellMe,
    setTellMe,
    toast,
    setToast,
    opinion,
    changeOpinion,
    firstOpenCell,
    firstRegion,
    measurement,
    measures,
    stagingAreas,
    selected,
    tab,
    view,
    extraLocks,
    display,
    settings,
    confidence,
    readOnly,
    buttonsOff,
    slideLabel,
    pathOfObject,
    current,
    timing,
    addedCurrent,
    people,
    taskSetId,
    setA,
    setsLock,
    setIsShown,
    otherSetsOn,
    reviewedOn,
    setB,
    pick,
    goView,
    decide,
    notNucleus,
    saveNote,
    pickTool,
    onCell,
    decideType,
    stillCamera,
    regionDecisions,
    cellDecisions,
    openCells,
    learner,
    changedCells,
    zones,
    everyZone,
    openZoneCells,
    nextInZone,
    restLookRight,
    findingsLayout,
    decidedObject,
    classColor,
    tileOf,
    scattered,
    unsureIds,
    callArea,
  };
}
