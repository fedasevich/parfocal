import { useLingui } from "@lingui/react/macro";
import { ApiError, type ReviewObject } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import type { DisplaySettings } from "@parfocal/ui/components/display-panel";
import type { ShownAlpha } from "@parfocal/viewer-engine";
import { useEffect, useMemo, useRef, useState } from "react";
import { geometryOf, inRing, type Ring } from "../annotations/ai-edit.ts";
import { loadClipper } from "../annotations/brush.ts";
import { polygonToGeoJson } from "../annotations/geojson.ts";
import { closeDraft, type PolygonDraft } from "../annotations/polygon-draft.ts";
import { crossingEdges } from "../annotations/reshape.ts";
import { keeperOf, mergeRings } from "../annotations/split-merge.ts";
import { slideAt } from "../annotations/stage-pointer.ts";
import { isTyping } from "../keys/registry.ts";
import { useAnswerKeys } from "../screens/review/answer-keys.ts";
import { rawFor } from "../screens/review/decision-mapping.ts";
import { answerCount, answersOf, type Count } from "../screens/review/decision-style.ts";
import {
  disagreeOptions,
  reasonDraft,
  toggleReasonLabel,
} from "../screens/review/disagree-reasons.ts";
import { drawChoicesOf, myDisplaySettings } from "../screens/review/display-tab.tsx";
import { coachShown, useGuidedCoach } from "../screens/review/guided-coach.ts";
import { useNoteKey } from "../screens/review/note-key.ts";
import { useObjectKeys } from "../screens/review/object-keys.ts";
import { type ReviewSession, useReviewSession } from "../screens/review/review-data.ts";
import { pendingOrder } from "../screens/review/review-order-state.ts";
import { ReviewOrderTabNotice } from "../screens/review/review-order-state.tsx";
import { answerFromDecision } from "../screens/review/review-state.ts";
import {
  storedType,
  type TypeOption,
  typeAnswers,
  typeChoice,
  typeOptions,
  typesCells,
} from "../screens/review/type-bar.ts";
import { useDecisionSaves } from "../screens/review/use-decision-saves.ts";
import { useOpinionDraft } from "../screens/review/use-opinion-draft.ts";
import { personalPanelValues, useDisplayDefaults } from "../shell/display-defaults.ts";
import { useLabDecisionCutoff } from "../shell/resolved-settings.ts";
import { showUndoToast } from "../shell/undo-toasts.tsx";
import {
  type CalmCamera,
  type CalmStep,
  calmStep,
  landingCamera,
  landingPower,
  stageCalmView,
} from "./calm-camera.ts";
import { reviewObjectOf } from "./focus-object.ts";
import { DockCard } from "./inspector-slots.tsx";
import type { ViewerModule } from "./magnification-control.tsx";
import {
  type OutlineDraft,
  outlineChanged,
  outlineRing,
  pushOutline,
  redoOutline,
  startOutline,
  undoOutline,
} from "./outline-draft.ts";
import { StageAiReading } from "./stage-ai-reading.tsx";
import { StageCellTypeBar } from "./stage-cell-type-bar.tsx";
import { StageCellsGrid } from "./stage-cells-grid.tsx";
import { StageCoachAnswerTip, StageCoachOnSlide, StageCoachStepTip } from "./stage-coach.tsx";
import { StageFocusCard } from "./stage-focus.tsx";
import {
  cellsInTissueOrder,
  guidedZoomLimit,
  nextOpenObject,
  outlineArea,
  outlineCentre,
  placedObjects,
  reviewMinSide,
} from "./stage-geometry.ts";
import { type GuidedFix, StageGuidedCard } from "./stage-guided-card.tsx";
import { StageGuidedView } from "./stage-guided-view.tsx";
import { useStageRulers } from "./stage-measurements.tsx";
import { StageObjectsPanel } from "./stage-objects-panel.tsx";
import { OpinionForm } from "./stage-opinion.tsx";
import { StageOpinionBack } from "./stage-opinion-back.tsx";
import { StageOutlineEditor } from "./stage-outline-editor.tsx";
import { StageRedrawLayer } from "./stage-redraw-layer.tsx";
import {
  type ReviewFate,
  type ReviewFix,
  ringOfFix,
  useReviewFixes,
} from "./stage-review-fixes.ts";
import {
  type MergeCandidate,
  ringOfOutline,
  type ShapeTool,
  StageShapeEdit,
  StageShapeEditBar,
  StageShapeFateBar,
} from "./stage-shape-edit.tsx";
import { StageSlideMarks, sampleOf, useSampleCollapsed } from "./stage-slide-marks.tsx";
import { StageTypePicker } from "./stage-type-picker.tsx";
import type { ViewerEngine } from "./viewer-engine.ts";

const overlayId = "review-objects";

const dimmedShare = 0.35;

const decisionNames = new Set(["agree", "disagree", "unsure"]);

const onControl = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("button, a, input, textarea, select, [role=dialog]") !== null;

function decisionNameOf(value: string | undefined) {
  return value !== undefined && decisionNames.has(value)
    ? (value as "agree" | "disagree" | "unsure")
    : null;
}

type Placed = ReturnType<typeof placedObjects>;

function useDrawing(
  engine: ViewerEngine,
  module: ViewerModule,
  id: string,
  kind: "nuclei" | "human-annotations",
  objects: Placed,
  choices: ReturnType<typeof drawChoicesOf>,
  current: string | null,
): ShownAlpha[] {
  const drawing = useMemo(
    () => module.createObjectDrawing({ id, host: engine, kind }),
    [module, engine, id, kind],
  );
  const [shown, setShown] = useState<ShownAlpha[]>([]);
  useEffect(() => () => drawing.clear(), [drawing]);
  useEffect(() => {
    drawing.setObjects(objects);
    drawing.setChoices(choices);
    drawing.setCurrent(current);
    setShown([...(drawing.result()?.shown ?? [])]);
  }, [drawing, objects, choices, current]);
  return shown;
}

function withDecisions(shown: Placed, decisionKey: string): Placed {
  if (decisionKey === "") return shown;
  const decided = new Map(JSON.parse(decisionKey) as [string, string][]);
  return shown.map((item) => ({ ...item, decision: decisionNameOf(decided.get(item.id)) }));
}

function reviewedObjects(
  objects: readonly ReviewObject[],
  fixed: ReadonlyMap<string, ReviewFix>,
  fates: ReadonlyMap<string, ReviewFate>,
  classes: readonly { id: string; name: string }[],
): ReviewObject[] {
  return objects.flatMap((item) => {
    const fate = fates.get(item.object);
    if (fate?.kind === "merged") return [];
    if (fate?.kind === "split") {
      return fate.parts.map((part) => ({ ...item, object: part.object, outline: part.outline }));
    }
    const fix = fixed.get(item.object);
    if (fix === undefined || fix.deleted) return [];
    const name = classes.find((entry) => entry.id === fix.classId)?.name;
    return [
      {
        ...item,
        outline: ringOfFix(fix) ?? item.outline ?? null,
        class_name: name ?? item.class_name,
      },
    ];
  });
}

function ObjectOutlines({
  engine,
  module,
  objects,
  classes,
  current,
  collapsed,
  decisions,
  settings,
  fixed,
  fates,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  objects: readonly ReviewObject[];
  classes: ReviewSession["classes"];
  current: string | null;
  collapsed: boolean;
  decisions: ReviewSession["decisions"];
  settings: DisplaySettings;
  fixed: ReadonlyMap<string, ReviewFix>;
  fates: ReadonlyMap<string, ReviewFate>;
}) {
  const defaults = useDisplayDefaults();
  const classKey = JSON.stringify(classes.map((item) => [item.id, item.name, item.color]));
  const projectClasses = useMemo(
    () =>
      (JSON.parse(classKey) as [string, string, string][]).map(([id, name, colour]) => ({
        id,
        name,
        colour,
      })),
    [classKey],
  );
  const decisionKey =
    settings.colorBy === "decision"
      ? JSON.stringify([...decisions].map(([id, decision]) => [id, decision.value]))
      : "";
  const shownObjects = useMemo(
    () => (collapsed ? objects.filter((item) => item.kind !== "cell") : objects),
    [collapsed, objects],
  );
  const placed = useMemo(
    () =>
      withDecisions(
        placedObjects(shownObjects, projectClasses, defaults.classPalette),
        decisionKey,
      ),
    [shownObjects, projectClasses, decisionKey, defaults.classPalette],
  );
  const reviewed = useMemo(
    () =>
      withDecisions(
        placedObjects(
          reviewedObjects(shownObjects, fixed, fates, projectClasses),
          projectClasses,
          defaults.classPalette,
        ),
        decisionKey,
      ),
    [shownObjects, fixed, fates, projectClasses, decisionKey, defaults.classPalette],
  );
  const kept = useMemo(
    () => placed.filter((item) => !fixed.has(item.id) && !fates.has(item.id)),
    [placed, fixed, fates],
  );
  const dimmed = useMemo(
    () => placed.filter((item) => fixed.has(item.id) || fates.has(item.id)),
    [placed, fixed, fates],
  );
  const choices = useMemo(() => drawChoicesOf(settings), [settings]);
  const dimmedChoices = useMemo(
    () => ({ ...choices, opacity: Math.round((choices.opacity ?? 100) * dimmedShare) }),
    [choices],
  );
  const currentReviewed = current !== null && reviewed.some((item) => item.id === current);
  const keptShown = useDrawing(
    engine,
    module,
    overlayId,
    "nuclei",
    kept,
    choices,
    currentReviewed ? null : current,
  );
  useDrawing(engine, module, `${overlayId}-ai-dimmed`, "nuclei", dimmed, dimmedChoices, null);
  const reviewedShown = useDrawing(
    engine,
    module,
    `${overlayId}-reviewed`,
    "human-annotations",
    reviewed,
    choices,
    currentReviewed ? current : null,
  );
  return (
    <div
      hidden
      data-testid="review-object-outlines"
      data-objects={placed.length}
      data-dimmed={dimmed.map((item) => item.id).join(" ")}
      data-reviewed={reviewed.map((item) => item.id).join(" ")}
      data-draw={choices.draw}
      data-width={choices.width}
      data-opacity={choices.opacity}
      data-shown={JSON.stringify([...keptShown, ...reviewedShown])}
      data-color-by={choices.colorBy}
      data-cutoff={choices.cutoff}
    />
  );
}

export function StageReviewObjects({
  engine,
  module,
  stage = null,
  taskId,
  slideId,
  object,
  guided = false,
  cellsGrid = false,
  jumpRequest = null,
  focus = null,
  doneRequest = 0,
  onComments,
  onNote,
  onCurrent,
  onAddMissed,
  answersOff,
  readOnly = false,
  opinionLocked,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  stage?: HTMLElement | null;
  taskId: string;
  slideId: string;
  object: string | undefined;
  guided?: boolean;
  cellsGrid?: boolean;
  jumpRequest?: { readonly id: string; readonly count: number } | null;
  focus?: { onShowUi: () => void } | null;
  doneRequest?: number;
  onComments: (object: string) => void;
  onNote?: (object: string) => void;
  onCurrent?: (object: string | null) => void;
  onAddMissed?: (kind: ReviewObject["kind"]) => void;
  answersOff?: string | undefined;
  readOnly?: boolean;
  opinionLocked?: string | undefined;
}) {
  const { t } = useLingui();
  const session = useReviewSession(taskId, slideId);
  const labCutoff = useLabDecisionCutoff();
  const defaults = useDisplayDefaults();
  const settings = useMemo(
    () => myDisplaySettings(session.myDisplay, labCutoff, personalPanelValues(defaults)),
    [session.myDisplay, labCutoff, defaults],
  );
  const [pending, setPending] = useState<ReadonlyMap<string, Count>>(new Map());
  const saves = useDecisionSaves(session, session.style, (object) =>
    setPending((before) => {
      if (!before.has(object)) return before;
      const next = new Map(before);
      next.delete(object);
      return next;
    }),
  );
  const opinionDraft = useOpinionDraft(session);
  const hold = (object: string, value: Count) =>
    setPending((before) => new Map(before).set(object, value));
  const savedKey = [...session.decisions.keys()].join();
  useEffect(() => {
    const saved = savedKey.split(",");
    setPending((before) => {
      const kept = [...before].filter(([object]) => !saved.includes(object));
      return kept.length === before.size ? before : new Map(kept);
    });
  }, [savedKey]);
  const fixes = useReviewFixes(taskId, slideId, session.ready, (objectId, error) => {
    const detail =
      error instanceof ApiError ? (error.problem?.detail ?? error.problem?.title) : null;
    showUndoToast({
      message: detail
        ? t`The outline of ${objectId} was not saved. ${detail}`
        : t`The outline of ${objectId} was not saved.`,
    });
  });
  const [fixing, setFixing] = useState<{
    readonly object: string;
    readonly step: "reasons" | "redraw" | "type";
  } | null>(null);
  const [draft, setDraft] = useState<PolygonDraft>([]);
  const [shaping, setShaping] = useState<{
    readonly object: string;
    readonly tool: ShapeTool;
  } | null>(null);
  const [merging, setMerging] = useState<readonly string[]>([]);
  const [outline, setOutline] = useState<OutlineDraft | null>(null);
  const [leaving, setLeaving] = useState<{ readonly go: () => void } | null>(null);
  const objects = session.objects;
  const order = objects.map((item) => item.object);
  const decided = new Set([...session.decisions.keys(), ...pending.keys()]);
  const allDecided = order.length > 0 && order.every((id) => decided.has(id));
  const wanted = reviewObjectOf(object, objects);
  const [chosen, setCurrent] = useState<string | null>(wanted ?? null);
  const [gridOpen, setGridOpen] = useState(cellsGrid);
  const [done, setDone] = useState(false);
  const [seenRequest, setSeenRequest] = useState(doneRequest);
  if (doneRequest !== seenRequest) {
    setSeenRequest(doneRequest);
    if (guided) setDone(true);
  }
  const hasCells = objects.some((item) => item.kind === "cell");
  const current =
    chosen ??
    (guided || focus !== null ? (nextOpenObject(order, decided, null) ?? order[0] ?? null) : null);
  const canFix = guided && focus === null && !readOnly && answersOff === undefined;
  const fixStep = canFix && fixing !== null && fixing.object === current ? fixing.step : null;
  useNoteKey(() => {
    if (current !== null && decided.has(current)) onNote?.(current);
  });
  const measurements = useStageRulers(!guided);
  const rulers = measurements?.rulers ?? [];
  const flyTo = (id: string | null) => {
    const area = outlineArea(
      objects.find((item) => item.object === id)?.outline ??
        rulers.find((item) => item.label === id)?.points,
      reviewMinSide,
    );
    if (area !== null) void engine.flyToArea(area, guidedZoomLimit);
  };
  const pick = (id: string | null) => {
    if (id === null) return;
    setDone(false);
    setCurrent(id);
    flyTo(id);
  };
  const focusedObject = useRef<string | null>(null);
  useEffect(() => {
    if (wanted === undefined || focusedObject.current === wanted) return;
    focusedObject.current = wanted;
    setDone(false);
    setCurrent(wanted);
    const area = outlineArea(objects.find((item) => item.object === wanted)?.outline);
    if (area !== null) void engine.flyToArea(area, guidedZoomLimit);
  }, [wanted, objects, engine]);
  const stepGoal = useRef<CalmCamera | null>(null);
  const stepTo = (id: string) => {
    const cell = outlineCentre(objects.find((item) => item.object === id)?.outline);
    const view = stageCalmView();
    const flying = engine.getMotion() === "flying";
    const from = flying ? stepGoal.current : engine.getCamera();
    const move: CalmStep =
      cell === null || view === null || from === null
        ? { kind: "fly" }
        : calmStep(from, view, { x: cell.x, y: cell.y, size: cell.radius * 2 });
    setDone(false);
    setCurrent(id);
    if (move.kind === "stay") return;
    if (move.kind === "fly") return landOnCell(id);
    stepGoal.current = move.camera;
    void engine.flyTo(move.camera);
  };
  const landOnCell = (id: string) => {
    const cell = outlineCentre(objects.find((item) => item.object === id)?.outline);
    const spacing = engine.getSlide()?.micronsPerPixel ?? null;
    const power = landingPower(
      module.scanObjective(spacing) ?? module.effectiveMagnification(0, spacing),
    );
    if (cell === null || spacing === null || power === null) {
      stepGoal.current = null;
      flyTo(id);
      return;
    }
    const zoom = module.zoomForMagnification(spacing, power);
    const goal = landingCamera(stageCalmView(), cell, zoom);
    stepGoal.current = goal;
    void engine.flyTo(goal);
  };
  const pickInStrip = (id: string) => {
    setDone(false);
    setCurrent(id);
    landOnCell(id);
  };
  const ready = session.ready && objects.length > 0;
  const orderWait = pendingOrder(session.order, session.ready);
  const coach = useGuidedCoach(guided && object === undefined);
  const coachOn =
    guided && coachShown(coach.open, ready ? objects.length : 0, answersOff === undefined);
  const opening = useRef(true);
  const reported = useRef(onCurrent);
  reported.current = onCurrent;
  const opensOnOpinion =
    guided && object === undefined && answersOff === undefined && !readOnly && allDecided;
  useEffect(() => {
    if (!ready || !opening.current) return;
    opening.current = false;
    if (opensOnOpinion) {
      setDone(true);
      return;
    }
    const area = outlineArea(
      objects.find((item) => item.object === current)?.outline,
      reviewMinSide,
    );
    if (area !== null) void engine.flyToArea(area, guidedZoomLimit);
  }, [ready, objects, engine, current, opensOnOpinion]);
  useEffect(() => {
    if (ready) reported.current?.(current);
  }, [ready, current]);
  const advance = (answered: string) => {
    const next = nextOpenObject(order, new Set([...decided, answered]), answered);
    if (next === null) setDone(true);
    else pick(next);
  };
  const openReasons = (item: ReviewObject) => {
    setCurrent(item.object);
    setShaping(null);
    setFixing({ object: item.object, step: "reasons" });
  };
  const answer = (item: ReviewObject, raw: string) => {
    if (answersOff !== undefined) return;
    const value = answerCount(session.style, session.classes, item, raw);
    if (value === undefined) return;
    const stored = session.decisions.get(item.object);
    const again =
      stored !== undefined &&
      answerFromDecision(stored, session.style, item, session.classes).raw === raw;
    if (!again) {
      saves.save(item.object, raw, value);
      hold(item.object, value);
    }
    if (canFix && session.style.kind !== "blind" && value === "disagree") {
      openReasons(item);
      return;
    }
    if (guided) advance(item.object);
    else setCurrent(item.object);
  };
  const currentItem = objects.find((item) => item.object === current);
  const currentOutline = currentItem?.outline;
  const currentArea = useMemo(() => outlineArea(currentOutline), [currentOutline]);
  const currentFix = current === null ? undefined : fixes.fixed.get(current);
  const originalRing = useMemo(() => ringOfOutline(currentOutline), [currentOutline]);
  const currentRing = useMemo(() => {
    const fixedRing = ringOfFix(currentFix);
    return fixedRing === null ? originalRing : ringOfOutline(fixedRing);
  }, [currentFix, originalRing]);
  const currentFate = current === null ? undefined : fixes.fates.get(current);
  const canSplit = currentItem?.kind === "region";
  const canShape =
    canFix &&
    session.style.kind !== "blind" &&
    !done &&
    stage !== null &&
    current !== null &&
    currentFate === undefined &&
    currentRing.length >= 3;
  const candidates = useMemo(
    (): MergeCandidate[] =>
      objects.flatMap((item) => {
        if (item.kind !== "region" || fixes.fates.has(item.object)) return [];
        const fix = fixes.fixed.get(item.object);
        if (fix?.deleted) return [];
        const ring: Ring = ringOfOutline(ringOfFix(fix) ?? item.outline);
        return ring.length >= 3 ? [{ object: item.object, ring }] : [];
      }),
    [objects, fixes.fates, fixes.fixed],
  );
  const splitCurrent = (parts: readonly Ring[]) => {
    if (current === null) return;
    const parent = current;
    const count = parts.length;
    setShaping(null);
    void fixes.split(parent, parts).then((saved) => {
      if (!saved) return;
      showUndoToast({
        message: t`${parent} is split into ${count} parts. The AI result is not changed.`,
        undo: () => void fixes.unsplit(parent),
      });
    });
  };
  const fateLine = (object: string, fate: ReviewFate) => {
    if (fate.kind === "merged") return t`${object} is merged into ${fate.into}.`;
    const parts = fate.parts.map((part) => part.object).join(", ");
    return t`${object} is split into ${parts}.`;
  };
  const mergeCurrent = async () => {
    if (current === null) return;
    const chosen = merging.includes(current) ? merging : [current, ...merging];
    const rings = chosen.flatMap((id) => {
      const ring = candidates.find((item) => item.object === id)?.ring;
      return ring === undefined ? [] : [ring];
    });
    await loadClipper();
    const outline = rings.length === chosen.length ? mergeRings(rings) : null;
    const keeper = keeperOf(chosen);
    if (outline === null || keeper === null) {
      showUndoToast({ message: t`Only regions that touch or overlap can be merged.` });
      return;
    }
    setShaping(null);
    setMerging([]);
    const saved = await fixes.merge(chosen, outline);
    if (!saved) return;
    const count = chosen.length;
    showUndoToast({
      message: t`${count} regions merged into ${keeper}. The AI result is not changed.`,
      undo: () => void fixes.unsplit(keeper),
    });
  };
  const shapeTool =
    canShape && fixStep === null && shaping?.object === current ? shaping.tool : null;
  const busy = fixStep !== null || shapeTool !== null;
  const outlineNow =
    shapeTool === "handles" && current !== null
      ? outline?.object === current
        ? outline
        : startOutline(current, currentRing)
      : null;
  const outlineShown = outlineNow === null ? null : outlineRing(outlineNow);
  const outlineCrossing = useMemo(
    () => (outlineShown === null ? [] : crossingEdges(outlineShown)),
    [outlineShown],
  );
  const outlineDirty = outlineNow !== null && outlineChanged(outlineNow);
  const askingToLeave = leaving !== null && shapeTool === "handles";
  const changeOutline = (next: (draft: OutlineDraft) => OutlineDraft) => {
    if (outlineNow === null) return;
    setLeaving(null);
    setOutline(next(outlineNow));
  };
  const keepOutline = (asFix: boolean) => {
    if (outlineNow === null || current === null) return;
    const object = current;
    const geometry = geometryOf(outlineRing(outlineNow));
    const message = t`New outline saved for ${object}. The AI result is not changed.`;
    setOutline(null);
    setLeaving(null);
    if (asFix && currentItem !== undefined) {
      saveFix(currentItem, { geometry }, message);
      return;
    }
    const before = fixes.change(object, { geometry });
    showUndoToast({ message, undo: () => fixes.restore(object, before) });
  };
  const settleOutline = (go: () => void) => {
    if (!outlineDirty) {
      setOutline(null);
      setLeaving(null);
      go();
      return;
    }
    if (outlineCrossing.length > 0) {
      setLeaving({ go });
      return;
    }
    keepOutline(false);
    go();
  };
  const finishOutline = () => {
    if (outlineCrossing.length > 0) return;
    if (outlineDirty) keepOutline(true);
    else setOutline(null);
    setShaping(null);
  };
  const discardOutline = () => {
    setOutline(null);
    setLeaving(null);
    setShaping(null);
  };
  useEffect(() => {
    if (outline === null || (shapeTool === "handles" && outline.object === current)) return;
    setOutline(null);
    setLeaving(null);
    if (outlineChanged(outline) && crossingEdges(outlineRing(outline)).length === 0) {
      fixes.change(outline.object, { geometry: geometryOf(outlineRing(outline)) });
    }
  }, [outline, shapeTool, current, fixes]);
  const shapeEntry = canShape && fixStep === null && shapeTool === null;
  useEffect(() => {
    if (!shapeEntry || stage === null || current === null) return;
    const open = () => setShaping({ object: current, tool: "handles" });
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented) return;
      if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (isTyping(event.target) || onControl(event.target)) return;
      event.preventDefault();
      open();
    };
    const doubleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !stage.contains(event.target)) return;
      if (!inRing(currentRing, slideAt(engine, stage, event))) return;
      event.stopPropagation();
      event.preventDefault();
      open();
    };
    const page = stage.ownerDocument;
    window.addEventListener("keydown", key);
    page.addEventListener("dblclick", doubleClick, true);
    return () => {
      window.removeEventListener("keydown", key);
      page.removeEventListener("dblclick", doubleClick, true);
    };
  }, [shapeEntry, stage, current, currentRing, engine]);
  const typedCell =
    currentItem?.kind === "cell" &&
    typesCells(session.style) &&
    outlineArea(currentItem.outline) !== null
      ? currentItem
      : null;
  const decideType = (cell: ReviewObject, id: string) => {
    if (answersOff !== undefined) return;
    const option = typeOptions.find((item) => item.id === id);
    if (option === undefined) {
      if (id === "unsure") {
        saves.save(cell.object, rawFor(session.style, "unsure", cell), "unsure");
        hold(cell.object, "unsure");
      }
    } else {
      const choice = typeChoice(session.style, option, cell, session.classes);
      const stored = session.decisions.get(cell.object);
      const kept =
        option.id === "notcell" &&
        stored?.answer === choice.raw &&
        stored.reasons.includes("not_a_cell");
      if (!kept) {
        saves.save(cell.object, choice.raw, choice.value, choice.draft);
        hold(cell.object, choice.value);
      }
      if (canFix && option.id === "notcell") {
        openReasons(cell);
        return;
      }
    }
    if (guided) advance(cell.object);
  };
  const stepToOpenCell = (answered: ReviewObject) => {
    if (guided || !gridOpen || answersOff !== undefined || answered.kind !== "cell") return;
    const cellOrder = cellsInTissueOrder(objects).map((item) => item.object);
    const next = nextOpenObject(cellOrder, new Set([...decided, answered.object]), answered.object);
    if (next !== null) stepTo(next);
  };
  useAnswerKeys(
    typeAnswers,
    (raw) => {
      if (typedCell === null) return;
      decideType(typedCell, raw);
      stepToOpenCell(typedCell);
    },
    ready && typedCell !== null && !busy,
  );
  const listKeysLive =
    ready && !guided && focus === null && currentItem !== undefined && typedCell === null;
  useAnswerKeys(
    answersOf(session.style, session.classes, currentItem),
    (raw) => {
      if (currentItem === undefined) return;
      answer(currentItem, raw);
      stepToOpenCell(currentItem);
    },
    listKeysLive,
  );
  const sample = useMemo(() => sampleOf(objects), [objects]);
  const collapsed = useSampleCollapsed(engine, sample);
  const wholeSlide = () => {
    setCurrent(null);
    void engine.flyToFit();
  };
  const index = current === null ? -1 : order.indexOf(current);
  const stepKeysLive = guided && ready && focus === null;
  const stepping = stepKeysLive && !done && !busy;
  const leaveFor = (target: string | null | undefined) => {
    if (target === null || target === undefined) return;
    setDraft([]);
    setMerging([]);
    setShaping(null);
    setFixing(null);
    pick(target);
  };
  const backToObjects = () => leaveFor(current ?? order[0]);
  const everyObjectDecided = order.length > 0 && order.every((id) => decided.has(id));
  const stepNext = () => {
    if (done) return backToObjects();
    const target = order[index + 1] ?? nextOpenObject(order, decided, current);
    if (target === null && everyObjectDecided && answersOff === undefined) {
      setDraft([]);
      setMerging([]);
      setShaping(null);
      setFixing(null);
      setDone(true);
      return;
    }
    leaveFor(target);
  };
  const stepPrevious = () =>
    done ? backToObjects() : leaveFor(index > 0 ? order[index - 1] : null);
  useAnswerKeys(
    answersOf(session.style, session.classes, currentItem),
    (raw) => {
      if (currentItem !== undefined) answer(currentItem, raw);
    },
    stepping && typedCell === null && currentItem !== undefined,
  );
  const stepNextKept = () => settleOutline(stepNext);
  const stepPreviousKept = () => settleOutline(stepPrevious);
  useObjectKeys(stepNextKept, stepPreviousKept, stepKeysLive);
  const jump = (id: string) =>
    pick(
      id === "cells"
        ? (objects.find((item) => item.kind === "cell" && !decided.has(item.object))?.object ??
            objects.find((item) => item.kind === "cell")?.object ??
            null)
        : id,
    );
  const [seenJump, setSeenJump] = useState(jumpRequest?.count ?? 0);
  if (jumpRequest !== null && jumpRequest.count !== seenJump) {
    setSeenJump(jumpRequest.count);
    if (jumpRequest.id === "cells") setGridOpen(true);
    jump(jumpRequest.id);
  }
  const toggleReason = (item: ReviewObject, reason: string) => {
    const decision = session.decisions.get(item.object);
    if (decision === undefined) return;
    const kept = answerFromDecision(decision, session.style, item, session.classes);
    const options = disagreeOptions(item.kind, item.class_name, session.classes);
    const reasons = toggleReasonLabel(kept.reasons, reason, options);
    void saves.saveReasons(
      item.object,
      kept.raw,
      kept.value,
      reasonDraft(reasons, options),
      kept.note,
    );
  };
  const saveFix = (item: ReviewObject, change: Partial<ReviewFix>, message: string) => {
    const before = fixes.change(item.object, change);
    setFixing({ object: item.object, step: "reasons" });
    showUndoToast({
      message,
      undo: () => fixes.restore(item.object, before),
    });
  };
  const finishRedraw = (item: ReviewObject, points: Float32Array | null) => {
    const closed = points === null ? closeDraft(draft) : { kind: "closed" as const, points };
    if (closed.kind !== "closed") return;
    setDraft([]);
    saveFix(
      item,
      { geometry: polygonToGeoJson(closed.points) },
      t`New outline saved for ${item.object}. The AI result is not changed.`,
    );
  };
  const cancelRedraw = (item: ReviewObject) => {
    setDraft([]);
    setFixing({ object: item.object, step: "reasons" });
  };
  const fixFor = (item: ReviewObject): GuidedFix => ({
    open: fixStep !== null,
    offered: canFix && session.style.kind !== "blind",
    onEditShape:
      shapeEntry && current === item.object
        ? () => setShaping({ object: item.object, tool: "handles" })
        : null,
    redrawPoints: fixStep === "redraw" ? draft.length : null,
    typePicker:
      fixStep === "type" ? (
        <StageTypePicker
          object={item}
          classes={session.classes}
          chosen={fixes.fixOf(item.object)?.classId ?? null}
          onPick={(classId) => {
            const name = session.classes.find((entry) => entry.id === classId)?.name ?? "";
            saveFix(
              item,
              { classId },
              t`${item.object} saved as ${name}. The AI result is not changed.`,
            );
          }}
          onCancel={() => setFixing({ object: item.object, step: "reasons" })}
        />
      ) : null,
    onReason: (reason) => toggleReason(item, reason),
    onBack: () => setFixing(null),
    onFix: (what) => {
      setDraft([]);
      setFixing({ object: item.object, step: what === "outline" ? "redraw" : "type" });
    },
    onFinishRedraw: () => finishRedraw(item, null),
    onCancelRedraw: () => cancelRedraw(item),
  });
  const coachPart = coachOn ? (
    <StageCoachAnswerTip
      keys={answersOf(session.style, session.classes, currentItem).map((item) => item.key)}
    />
  ) : answersOff === undefined ? (
    <Button variant="ghost" size="sm" className="w-fit px-0" onClick={coach.reopen}>
      {t`How guided review works`}
    </Button>
  ) : null;
  return (
    <>
      <ObjectOutlines
        engine={engine}
        module={module}
        objects={objects}
        classes={session.classes}
        current={current}
        collapsed={collapsed}
        decisions={session.decisions}
        settings={settings}
        fixed={fixes.fixed}
        fates={fixes.fates}
      />
      {fixStep === "redraw" && stage !== null && currentItem !== undefined ? (
        <StageRedrawLayer
          engine={engine}
          stage={stage}
          draft={draft}
          onDraft={setDraft}
          onClose={(points) => finishRedraw(currentItem, points)}
          onCancel={() => cancelRedraw(currentItem)}
        />
      ) : null}
      {shapeTool === "handles" && stage !== null && current !== null && outlineShown !== null ? (
        <StageOutlineEditor
          key={`${current}:outline`}
          engine={engine}
          stage={stage}
          object={current}
          ring={outlineShown}
          original={originalRing}
          edited={currentFix !== undefined || outlineDirty}
          onChange={(ring) => changeOutline((draft) => pushOutline(draft, ring))}
          onUndo={() => changeOutline(undoOutline)}
          onRedo={() => changeOutline(redoOutline)}
          onCommit={finishOutline}
          onDiscard={discardOutline}
          onStep={(delta) => (delta === 1 ? stepNextKept() : stepPreviousKept())}
        />
      ) : null}
      {shapeTool !== null && shapeTool !== "handles" && stage !== null && current !== null ? (
        <StageShapeEdit
          key={`${current}:${shapeTool}`}
          engine={engine}
          stage={stage}
          object={current}
          classId={currentFix?.classId ?? null}
          ring={currentRing}
          edited={currentFix !== undefined}
          tool={shapeTool}
          candidates={candidates}
          merging={merging}
          onMerging={setMerging}
          onSave={(geometry) => fixes.change(current, { geometry })}
          {...(canSplit ? { onSplit: splitCurrent } : {})}
          onClose={() => setShaping(null)}
          onStep={(delta) => (delta === 1 ? stepNext() : stepPrevious())}
        />
      ) : null}
      {guided && ready && focus === null && currentItem !== undefined ? (
        <StageGuidedView
          key={currentItem.object}
          engine={engine}
          module={module}
          object={currentItem.object}
          area={currentArea}
          finished={done}
        />
      ) : null}
      {focus === null ? (
        <StageSlideMarks
          engine={engine}
          objects={objects}
          decisionOf={(id) => session.decisions.get(id)?.value}
          showScore={session.style.kind !== "yesno" && session.style.kind !== "blind"}
          sample={sample}
          collapsed={collapsed}
          ids={settings.ids}
          added={session.added}
          onWholeSlide={guided ? null : wholeSlide}
        />
      ) : null}
      {coachOn && focus === null ? (
        <StageCoachOnSlide object={current ?? ""} drawn={session.task?.drawn ?? false} />
      ) : null}
      {focus === null || currentItem === undefined || typedCell !== null ? null : (
        <StageFocusCard
          session={session}
          object={currentItem}
          onAnswer={(raw) => answer(currentItem, raw)}
          onShowUi={focus.onShowUi}
          keysLive={ready}
          readOnly={readOnly}
        />
      )}
      {gridOpen && hasCells && ready && focus === null ? (
        <StageCellsGrid
          engine={engine}
          session={session}
          saves={saves}
          slideId={slideId}
          current={current}
          readOnly={readOnly}
          onPick={pickInStrip}
          onStep={stepTo}
          onClose={() => setGridOpen(false)}
        />
      ) : null}
      {typedCell === null || readOnly || busy ? null : (
        <StageCellTypeBar
          engine={engine}
          cell={typedCell}
          chosen={storedType(
            session.style,
            typedCell,
            session.classes,
            session.decisions.get(typedCell.object),
          )}
          onChoose={(option: TypeOption) => decideType(typedCell, option.id)}
        />
      )}
      <DockCard section="objects" order={1}>
        <section
          aria-label={t`AI objects`}
          data-testid="stage-review-objects"
          data-ready={ready}
          data-guided={guided}
          data-current={current ?? ""}
          className={guided ? "flex flex-col gap-4" : "flex flex-col gap-2"}
        >
          {guided && done ? (
            <>
              <StageOpinionBack
                session={session}
                pending={pending}
                current={current}
                onBack={backToObjects}
                onJump={(id) => {
                  if (id === "cells") setGridOpen(true);
                  jump(id);
                }}
              />
              <OpinionForm
                session={session}
                draft={opinionDraft}
                pending={pending}
                readOnly={opinionLocked}
                onObjects={(id) => {
                  if (id === "cells") setGridOpen(true);
                  if (id !== undefined) jump(id);
                }}
              />
            </>
          ) : guided && currentItem !== undefined ? (
            <StageGuidedCard
              session={session}
              object={currentItem}
              position={index + 1}
              coach={coachPart}
              stepTip={coachOn ? <StageCoachStepTip onStart={coach.dismiss} /> : null}
              onAnswer={(raw) => answer(currentItem, raw)}
              onJump={(id) => {
                if (id === "cells") setGridOpen(true);
                jump(id);
              }}
              onPrevious={stepPreviousKept}
              onSkip={stepNextKept}
              onNote={() => {
                if (current !== null) onNote?.(current);
              }}
              onAddMissed={
                onAddMissed === undefined || session.task?.display.add_missed === false
                  ? undefined
                  : () => onAddMissed(currentItem.kind)
              }
              answersOff={answersOff}
              readOnly={readOnly}
              fix={fixFor(currentItem)}
            />
          ) : null}
          {shapeTool !== null && current !== null ? (
            <StageShapeEditBar
              object={current}
              tool={shapeTool}
              edited={currentFix !== undefined}
              canSplit={canSplit}
              merging={(merging.includes(current) ? merging : [current, ...merging]).length}
              crossing={outlineCrossing.length > 0}
              asking={askingToLeave}
              onTool={(tool) =>
                settleOutline(() => {
                  setMerging([]);
                  setShaping({ object: current, tool });
                })
              }
              onRestore={() => {
                setOutline(null);
                setLeaving(null);
                fixes.restore(current, undefined);
              }}
              onMerge={() => void mergeCurrent()}
              onDone={shapeTool === "handles" ? finishOutline : () => setShaping(null)}
              onKeepEditing={() => setLeaving(null)}
              onDiscard={() => {
                const go = leaving?.go;
                setOutline(null);
                setLeaving(null);
                go?.();
              }}
            />
          ) : null}
          {canFix && current !== null && currentFate !== undefined ? (
            <StageShapeFateBar
              object={current}
              line={fateLine(current, currentFate)}
              undoLabel={currentFate.kind === "split" ? t`Undo the split` : t`Undo the merge`}
              onUndo={() =>
                void fixes.unsplit(currentFate.kind === "split" ? current : currentFate.into)
              }
            />
          ) : null}
          {orderWait ? (
            <ReviewOrderTabNotice order={orderWait} onRetry={session.retryOrder} />
          ) : null}
          <StageAiReading
            slideId={slideId}
            resultSetId={
              session.task?.slides.find((item) => item.slide_id === slideId)?.result_set_id
            }
            objects={objects}
          />
          {readOnly && answersOff !== undefined ? (
            <p
              data-testid="read-only-note"
              className="m-0 inline-flex items-center gap-2 text-body-sm text-fg-dim"
            >
              {answersOff}
            </p>
          ) : null}
          {!ready && !readOnly && answersOff !== undefined ? (
            <p
              data-testid="answers-off"
              className="m-0 inline-flex items-center gap-2 text-body-sm text-warn"
            >
              {answersOff}
            </p>
          ) : null}
          {!guided && ready ? (
            <StageObjectsPanel
              answersOff={answersOff}
              readOnly={readOnly}
              session={session}
              current={current}
              onPick={(id) => (id === null ? setCurrent(null) : pick(id))}
              onAnswer={answer}
              onNote={(id) => (decided.has(id) ? onNote?.(id) : onComments(id))}
              onOpenCells={() => setGridOpen(true)}
              cellTyped={typedCell !== null}
              rulers={rulers}
              onRemoveRuler={(ruler) => measurements?.remove(ruler.shapeId)}
            />
          ) : null}
        </section>
      </DockCard>
    </>
  );
}
