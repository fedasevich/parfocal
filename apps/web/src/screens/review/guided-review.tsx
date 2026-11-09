import {
  ApiError,
  resolveSetting,
  useGetFirstRead,
  useGetMySettingLayers,
  useGetReviewedLayer,
  useSubmitSlideReview,
} from "@parfocal/api-client";
import { Banner, InlineState } from "@parfocal/ui/components/banner";
import type { Blocker } from "@parfocal/ui/components/before-you-list";
import { Button } from "@parfocal/ui/components/button";
import { CellCluster, CellsLauncher } from "@parfocal/ui/components/cells-panel";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { SidePanel } from "@parfocal/ui/components/side-panel";
import { type OpinionQuestion, SlideDoneCard } from "@parfocal/ui/components/slide-done-card";
import {
  type AreaCall,
  type AreaCount,
  areaRole,
  callOf,
  callToast,
  countOf,
  leadAreaId,
  pickCall,
  roleText,
  unsureAreaIds,
} from "@parfocal/ui/lib/area-call";
import { cn } from "@parfocal/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { polygonToGeoJson } from "../../annotations/geojson.ts";
import { closeDraft, type Point, type PolygonDraft } from "../../annotations/polygon-draft.ts";
import { useConnection } from "../../shell/connection.ts";
import { ConnectionBanner } from "../../shell/connection-banner.tsx";
import { useLabDecisionCutoff } from "../../shell/resolved-settings.ts";
import { showUndoToast } from "../../shell/undo-toasts.tsx";
import { useCellTiming, useTaskRun } from "../../telemetry/use-task-timing.ts";
import { stillBackdrop } from "../../viewer/still-backdrop.tsx";
import { useStillObjects } from "../../viewer/use-still-objects.ts";
import { markTried } from "../home/getting-started.ts";
import { useRememberResume } from "../home/remember-resume.ts";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { SavePresetModal } from "../viewer/save-preset-modal.tsx";
import { type ReviewConfidence, reviewConfidence } from "./ai-wording.ts";
import { useAnswerKeys } from "./answer-keys.ts";
import { CellCountChip, useCellCount } from "./cell-count-chip.tsx";
import { CellsGrid } from "./cells-grid.tsx";
import { useSetName } from "./cells-on-slide.tsx";
import {
  answersOf,
  type Confidence,
  cardText,
  countsAs,
  countWord,
  rawFor,
  rawLabel,
  showsClaim,
} from "./decision-style.ts";
import { disagreeOptions, reasonDraft } from "./disagree-reasons.ts";
import { type DisplayLock, DisplayTab, displaySettings, withOverrides } from "./display-tab.tsx";
import { FirstReadStep } from "./first-read.tsx";
import { useGuidedCoach } from "./guided-coach.ts";
import { nextOpenIndex } from "./guided-progress.ts";
import {
  finishingAnswers,
  type GuidedScene,
  type GuidedTab,
  guidedSetup,
} from "./guided-scenes.ts";
import { noteAction, useNoteKey } from "./note-key.ts";
import { draftFrom, reasonBody, toggleReason as toggledDraft, withNote } from "./note-model.ts";
import {
  answerLabel,
  type LockLine,
  NoteEditor,
  noteReasonsFor,
  ObjectCard,
  ObjectDots,
  SavedNote,
} from "./object-card.tsx";
import { ObjectComments, useThreadMessages } from "./object-comments.tsx";
import { nextObjectAction, previousObjectAction, useObjectKeys } from "./object-keys.ts";
import { imageOfKind, ringOfGeometry, slideToStill, stillToSlide } from "./outline-coords.ts";
import { RedrawLayer } from "./redraw-layer.tsx";
import { type ReviewSession, useReviewSession } from "./review-data.ts";
import { type Answer, type Answers, answerOf, baseAnswers, countAnswers } from "./review-state.ts";
import { ReviewTop } from "./review-top.tsx";
import { type Camera, readout, SlideStill, type StillView } from "./slide-still.tsx";
import { ThreadsTab, useOpenThreadsWarning } from "./threads-tab.tsx";
import { useDecisionSaves } from "./use-decision-saves.ts";
import { useDisplayChoice, useShiftPresetKeys } from "./use-display-choice.ts";
import { useOpinionDraft } from "./use-opinion-draft.ts";

type GuidedReviewProps = {
  taskId: string;
  slideId: string;
  objectId?: string | undefined;
  camera?: Camera | undefined;
  scene: GuidedScene | undefined;
  submitted: boolean;
  tab: GuidedTab | undefined;
  onTabChange: (tab: GuidedTab) => void;
};

export function GuidedReview(props: GuidedReviewProps) {
  const session = useReviewSession(props.taskId, props.slideId);
  const hidesAi = session.task?.ai_hidden_first_read === true;
  const firstRead = useGetFirstRead(props.taskId, props.slideId, undefined, {
    query: { enabled: hidesAi, retry: false },
  });
  if (!session.ready || (hidesAi && firstRead.isPending)) {
    return (
      <main className="grid h-dvh place-items-center bg-page text-fg-dim">Loading the review…</main>
    );
  }
  if (hidesAi && firstRead.isError) {
    const notRecorded = firstRead.error instanceof ApiError && firstRead.error.status === 404;
    if (notRecorded) return <FirstReadStep session={session} />;
    return (
      <main
        className="grid h-dvh place-items-center bg-page p-6 text-fg"
        data-ai="hidden"
        data-testid="first-read-unavailable"
      >
        <InlineState
          icon="warn"
          title="Your first read could not be checked"
          action={
            <Button variant="ghost" onClick={() => void firstRead.refetch()}>
              Try again
            </Button>
          }
        >
          The AI stays hidden until your first read is confirmed. Try again in a moment.
        </InlineState>
      </main>
    );
  }
  return (
    <GuidedBody key={`${props.scene ?? "region"}-${props.slideId}`} session={session} {...props} />
  );
}

type BodyProps = GuidedReviewProps & { session: ReviewSession };

const netOff = "The connection is lost. It saves when the connection is back.";

function GuidedBody({
  session,
  objectId,
  camera: startCamera,
  scene,
  submitted,
  tab,
  onTabChange,
}: BodyProps) {
  const { online } = useConnection();
  const sceneSetup = guidedSetup(scene);
  const setup = { ...sceneSetup, connLost: sceneSetup.connLost || !online };
  const navigate = useNavigate();
  const person = usePeople();
  const submitReview = useSubmitSlideReview({
    mutation: { onSuccess: () => markTried("guided-review") },
  });
  const threadsWarning = useOpenThreadsWarning(session.taskId, session.slideId);
  const style = setup.style ? { ...session.style, kind: setup.style } : session.style;
  const decisions = useDecisionSaves(session, style);
  const objects = setup.issue === "noresults" ? [] : session.objects;
  const noResults = objects.length === 0;
  const regions = objects.filter((item) => item.kind === "region");
  const cells = objects.filter((item) => item.kind === "cell");
  const base = baseAnswers(
    objects,
    session.verdicts,
    style,
    setup.stage,
    finishingAnswers,
    session.classes,
  );
  const [overrides, setOverrides] = useState<Answers>(
    () =>
      new Map(
        Object.entries(setup.answered).map(([object, value]) => [
          object,
          {
            value,
            raw: rawFor(
              style,
              value,
              objects.find((item) => item.object === object),
            ),
            reasons: [],
            note: null,
          },
        ]),
      ),
  );
  const answer = (object: string) => answerOf(base, overrides, object);
  const firstOpenCell = () => {
    const at = objects.findIndex((item) => item.kind === "cell" && !answer(item.object));
    return at < 0 ? regions.length : at;
  };
  const [index, setIndex] = useState(() => {
    const asked = objectId ? objects.findIndex((item) => item.object === objectId) : -1;
    if (asked >= 0) return asked;
    if (setup.focus === "first-open-cell") return firstOpenCell();
    return Math.max(
      0,
      objects.findIndex((item) => item.object === setup.focus),
    );
  });
  const [showDone, setShowDone] = useState(setup.done);
  const [disagreeOpen, setDisagreeOpen] = useState(setup.disagreeOpen);
  const [noteFor, setNoteFor] = useState<string | null>(setup.noteDraft ? "current" : null);
  const [noteDraft, setNoteDraft] = useState(setup.noteDraft ?? { reasons: [], text: "" });
  const [redraw, setRedraw] = useState<PolygonDraft | null>(null);
  const [redrawnNow, setRedrawn] = useState<Record<string, PolygonDraft>>({});
  const layer = okData(useGetReviewedLayer(session.taskId, session.slideId, undefined).data);
  const redrawn = useMemo(() => {
    const loaded: Record<string, PolygonDraft> = {};
    for (const edit of layer?.edits ?? []) {
      const ring = ringOfGeometry(edit.geometry);
      if (ring !== null) {
        const image = imageOfKind(edit.kind === "cell" ? "cell" : "region");
        loaded[edit.object] = ring.map((point) => slideToStill(point, image));
      }
    }
    return { ...loaded, ...redrawnNow };
  }, [layer, redrawnNow]);
  const [cellsShut, setCellsShut] = useState(false);
  const [cellsFolded, setCellsFolded] = useState(false);
  const [confirmRest, setConfirmRest] = useState(setup.cellsPreview);
  const [whole, setWhole] = useState(setup.whole || setup.done);
  const [camera, setCamera] = useState<Camera | null>(() =>
    objectId !== undefined && startCamera !== undefined ? startCamera : null,
  );
  const { answers: opinion, change: changeOpinion } = useOpinionDraft(session, setup.dropAnswers);
  const [failed, setFailed] = useState(setup.submitFail);
  const coach = useGuidedCoach(session.meId, scene === undefined && objectId === undefined);
  const coachOn = setup.coach || coach.open;
  const startReview = () => {
    if (setup.coach) {
      void navigate({
        to: "/tasks/$taskId/guided",
        params: { taskId: session.taskId },
        search: { slide: session.slideId, scene: "region" },
      });
      return;
    }
    coach.dismiss();
  };
  const tabNow: GuidedTab = coachOn ? "review" : (tab ?? setup.tab);
  const current = objects[Math.min(index, Math.max(0, objects.length - 1))];
  const currentId = current?.object ?? "";
  const timing = useTaskRun("review", session.slideId, "viewer");
  useCellTiming(currentId, current?.kind === "cell");
  useRememberResume(
    scene === undefined && session.slideId
      ? {
          task_id: session.taskId,
          slide_id: session.slideId,
          mode: "guided",
          object_id: currentId || null,
          camera: camera ? { x: camera.x, y: camera.y, z: camera.scale } : null,
        }
      : null,
  );
  const counts = countAnswers(objects, answer);
  const extraLocks: DisplayLock[] = setup.confidenceLock
    ? [{ setting: "confidence", value: "hidden", reason: setup.confidenceLock }]
    : [];
  const myLayers = okData(useGetMySettingLayers().data);
  const labCutoff = useLabDecisionCutoff();
  const wording =
    scene === undefined
      ? resolveSetting("confidence_wording", {
          lab: myLayers?.lab ?? { values: {}, locked: [] },
          personal: myLayers?.personal ?? {},
          device: {},
        }).value
      : null;
  const choice = useDisplayChoice(session, setup.preset);
  const [savingPreset, setSavingPreset] = useState(false);
  useShiftPresetKeys(session.display, choice);
  const sceneSettings = withOverrides(
    displaySettings(session.display, choice.preset, extraLocks, undefined, labCutoff),
    choice.overrides,
    session.display,
    extraLocks,
  );
  const confidenceLocked = [...(session.display?.locks ?? []), ...extraLocks].some(
    (lock) => lock.setting === "confidence",
  );
  const chosenConfidence = confidenceLocked ? undefined : choice.overrides.confidence;
  const confidence: ReviewConfidence =
    wording === null
      ? (sceneSettings.confidence as Confidence)
      : ((chosenConfidence as ReviewConfidence | undefined) ??
        reviewConfidence(session.display, choice.preset, extraLocks, wording));
  const shownConfidence = confidence === "frequency" ? "word" : confidence;
  const settings = { ...sceneSettings, confidence: shownConfidence };
  const readOnly = setup.readOnly || setup.issue === "withdrawn";
  const tileFail = setup.issue === "slidefail";
  const lockLine: LockLine = setup.readOnly
    ? { icon: "lock", text: "Signed off. Ask the researcher to amend.", tone: "lock" }
    : tileFail
      ? {
          icon: "warn",
          text: `${session.slideName.split(" ")[0]} can't be read at 20x and 40x yet. Retry, or ask the researcher.`,
          tone: "warn",
        }
      : null;
  const buttonsOff = readOnly || tileFail || setup.connLost;
  const blindReviewers = (session.task?.slides[0]?.reviewer_ids ?? []).filter(
    (id) => id !== session.meId,
  );
  const otherReviewer = person(blindReviewers[0])?.name.split(" ")[0] ?? "the other reviewer";
  const threadOf = (object: string) => session.threads.find((item) => item.anchor === object);
  const messages = useThreadMessages(
    session.taskId,
    session.slideId,
    threadOf(currentId),
    session.meId,
  );
  const openThreads = session.threads.filter((item) => !item.resolved).length;
  const setName = useSetName(session);

  const goTo = (at: number) => {
    setIndex(Math.max(0, Math.min(objects.length - 1, at)));
    setDisagreeOpen(false);
    setNoteFor(null);
    setCamera(null);
    setWhole(false);
    setShowDone(false);
  };
  const jump = (target: string) => {
    if (target === "cells") {
      setCellsShut(false);
      goTo(firstOpenCell());
      return;
    }
    goTo(objects.findIndex((item) => item.object === target));
  };
  const advance = (from: number, decided: Answers) => {
    const target = nextOpenIndex(
      objects.map((item) => item.object),
      from,
      (object) => Boolean(answerOf(base, decided, object)),
    );
    if (target === null) {
      setShowDone(true);
      setWhole(true);
      return;
    }
    goTo(target);
  };
  const put = (object: string, value: Answer | null) => {
    const next = new Map(overrides);
    next.set(object, value);
    setOverrides(next);
    return next;
  };
  const answerWith = (raw: string) => {
    if (current === undefined || buttonsOff) return;
    const value = countsAs(style, raw, current);
    const kept = answer(currentId);
    const next = put(currentId, {
      value,
      raw,
      reasons: kept?.value === value ? kept.reasons : [],
      note: kept?.note ?? null,
    });
    decisions.save(
      currentId,
      raw,
      value,
      kept?.value === value ? reasonBody(kept.reasons, value, current, session.classes) : undefined,
      kept?.note,
    );
    const label = rawLabel(style, raw, session.classes);
    showUndoToast({
      message:
        style.kind === "agree"
          ? `${currentId}: ${countWord[value].toLowerCase()}`
          : `${currentId}: ${label}, counts as ${countWord[value].toLowerCase()}`,
      undo: () => {
        setOverrides(new Map(next).set(currentId, kept ?? null));
        decisions.restore(currentId, kept);
        setIndex(index);
        setShowDone(false);
        setWhole(false);
      },
    });
    if (style.kind === "agree" && value === "disagree") {
      setDisagreeOpen(true);
      return;
    }
    if (settings.auto) advance(index, next);
  };
  const regionAreas = regions.map((region) => ({
    id: region.object,
    call: callOf(answer(region.object)?.value),
  }));
  const callArea = (picked: AreaCall) => {
    if (current === undefined || buttonsOff) return;
    const kept = answer(currentId);
    const call = pickCall(callOf(kept?.value), picked);
    if (call === null) {
      put(currentId, null);
      decisions.restore(currentId, undefined);
      showUndoToast({ message: callToast(regionAreas, currentId, null) });
      return;
    }
    const raw = rawFor(style, countOf(call), current);
    const next = put(currentId, {
      value: countOf(call),
      raw,
      reasons: [],
      note: kept?.note ?? null,
    });
    decisions.save(currentId, raw, countOf(call));
    showUndoToast({
      message: callToast(regionAreas, currentId, call),
      undo: () => {
        setOverrides(new Map(next).set(currentId, kept ?? null));
        decisions.restore(currentId, kept);
      },
    });
    if (settings.auto && call !== "unsure") advance(index, next);
  };
  const notNucleus = (object: string) => {
    const target = objects.find((item) => item.object === object);
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
    showUndoToast({
      message: `${object}: not a nucleus, counts as disagree`,
      undo: () => {
        setOverrides(before);
        decisions.restore(object, undefined);
      },
    });
  };
  const toggleReason = (reason: string) => {
    const kept = answer(currentId);
    if (!kept) return;
    const reasons = kept.reasons.includes(reason)
      ? kept.reasons.filter((item) => item !== reason)
      : [...kept.reasons, reason];
    put(currentId, { ...kept, reasons });
    if (current !== undefined && kept.value === "disagree") {
      decisions.save(
        currentId,
        kept.raw,
        kept.value,
        reasonDraft(reasons, disagreeOptions(current.kind, current.class_name, session.classes)),
        kept.note,
      );
    }
  };
  const startRedraw = () => {
    setRedraw([]);
    setCamera(null);
  };
  const pickPoint = (point: Point) => {
    if (redraw === null) return;
    const last = redraw.at(-1);
    if (last?.x === point.x && last.y === point.y) return;
    setRedraw([...redraw, point]);
  };
  const finishRedraw = () => {
    if (redraw === null) return;
    const image = imageOfKind(current?.kind ?? "region");
    const closed = closeDraft(redraw.map((point) => stillToSlide(point, image)));
    if (closed.kind !== "closed") return;
    decisions.saveOutline(currentId, polygonToGeoJson(closed.points));
    const saved = redraw;
    setRedrawn((now) => ({ ...now, [currentId]: saved }));
    setRedraw(null);
    showUndoToast({
      message: `New outline saved for ${currentId}. The AI result is not changed.`,
      undo: () => {
        decisions.clearOutline(currentId);
        setRedrawn((now) => {
          const { [currentId]: _gone, ...rest } = now;
          return rest;
        });
      },
    });
  };
  const saveNote = () => {
    const kept = answer(currentId);
    if (kept) {
      const next = withNote(kept, noteDraft);
      put(currentId, next);
      if (current !== undefined) {
        decisions.save(
          currentId,
          next.raw,
          next.value,
          reasonBody(next.reasons, next.value, current, session.classes),
          next.note,
        );
      }
    }
    setNoteFor(null);
  };
  const openNote = () => {
    const kept = answer(currentId);
    setNoteDraft(draftFrom(kept));
    setNoteFor("current");
  };
  const toSubmitted = () =>
    navigate({
      to: "/tasks/$taskId/submitted",
      params: { taskId: session.taskId },
      search: { slide: session.slideId },
    });
  const submit = () => {
    if (failed) {
      setFailed(false);
      return;
    }
    submitReview.mutate({ taskId: session.taskId, slideId: session.slideId });
    timing.finish();
    void toSubmitted();
  };

  useNoteKey(() => {
    if (!showDone && !noResults && answer(currentId)) openNote();
  });

  const areaMode = session.nodeStaging && current?.kind === "region";
  useAnswerKeys(
    answersOf(style, session.classes, current),
    (raw) => (areaMode ? callArea(callOf(raw as AreaCount) ?? "unsure") : answerWith(raw)),
    !showDone && !noResults,
  );

  useObjectKeys(
    () => goTo(index + 1),
    () => goTo(index - 1),
    !showDone && !noResults,
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable], [role=dialog]")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (showDone || noResults) return;
      if (event.key === "ArrowRight") {
        goTo(index + 1);
      } else if (event.key === "ArrowLeft") {
        goTo(index - 1);
      } else if (event.key === "Escape") {
        if (confirmRest) setConfirmRest(false);
        else if (current?.kind === "cell") setCellsShut(true);
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
  const cellCount = useCellCount(cells, answer);
  const view: StillView =
    whole || showDone || noResults
      ? { kind: "whole" }
      : current?.kind === "cell"
        ? { kind: "cell", object: currentId }
        : { kind: "region", object: currentId };
  const claimShown = showsClaim(style);
  const still = useStillObjects(
    regions,
    (object) => answer(object)?.value,
    view.kind === "region" ? currentId : null,
  );
  const backdrop = stillBackdrop({
    enabled: view.kind !== "cell" && !tileFail && !noResults,
    slideId: session.slideId,
    objects: claimShown ? still.objects : null,
    choices: settings,
  });
  const submitReason =
    counts.open > 0
      ? `${counts.open} object${counts.open === 1 ? " is" : "s are"} still open.`
      : undefined;
  const openRegions = regions.filter((region) => !answer(region.object));
  const blockers: Blocker[] = [
    ...openRegions.map((region) => ({
      id: region.object,
      text: `${region.object} is still open`,
      goTo: `Go to ${region.object}`,
      onGoTo: () => jump(region.object),
    })),
    ...(openCells.length
      ? [
          {
            id: "cells",
            text: `${openCells.length} cell${openCells.length === 1 ? "" : "s"} in the sample ${openCells.length === 1 ? "is" : "are"} still open`,
            goTo: "Go to the cells",
            onGoTo: () => jump("cells"),
          },
        ]
      : []),
  ];
  const questions: OpinionQuestion[] = (session.opinion?.questions ?? [])
    .filter((question) => !session.task?.ai_hidden_first_read || question.asked !== "first-read")
    .map((question) => {
      const answerText = opinion[question.key];
      const missing = question.required === true && !answerText && setup.dropAnswers.length > 0;
      return {
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
        ...(answerText ? { answer: answerText } : {}),
        ...(missing ? { missing: true } : {}),
      };
    });
  const missingQuestions = questions
    .map((question, position) => ({ question, position }))
    .filter(({ question }) => question.required && !opinion[question.id]);
  const unsureAreas: Blocker[] = session.nodeStaging
    ? unsureAreaIds(regionAreas).map((id) => ({
        id,
        text: `${id} is not sure. The researcher sees it.`,
        goTo: `Go to ${id}`,
        onGoTo: () => jump(id),
      }))
    : [];
  const doneBlockers: Blocker[] = counts.open
    ? blockers
    : missingQuestions.map(({ question, position }) => ({
        id: question.id,
        text: `Question ${position + 1} is not answered`,
        goTo: "Answer it",
      }));
  const nextLabel = session.neighbours
    ? `Submit and open slide ${session.neighbours.position + 1}`
    : "Submit";

  const authorOfNotes = person(session.meId);
  const kept = answer(currentId);
  const note: ReactNode =
    noteFor !== null && current ? (
      <NoteEditor
        object={currentId}
        reasons={
          disagreeOpen ? [] : noteReasonsFor(current, setup.pending ?? kept?.value, session.classes)
        }
        chosen={noteDraft.reasons}
        text={noteDraft.text}
        offReason={setup.connLost ? netOff : undefined}
        onReason={(reason) => setNoteDraft(toggledDraft(noteDraft, reason))}
        meId={session.meId}
        onText={(text) => setNoteDraft({ ...noteDraft, text })}
        onSave={saveNote}
        onCancel={() => setNoteFor(null)}
      />
    ) : kept && (kept.note || (kept.reasons.length && !disagreeOpen)) ? (
      <SavedNote
        answer={kept}
        label={answerLabel(style, kept, session.classes)}
        author={authorOfNotes}
        onEdit={openNote}
      />
    ) : kept || setup.pending ? (
      <button
        type="button"
        onClick={openNote}
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-body-sm font-medium text-fg-dim hover:text-fg"
      >
        <Icon name="comment" />
        Add a note
        <Keycap action={noteAction} size="sm" />
      </button>
    ) : null;

  const coachTips = coachOn ? (
    <div className="grid gap-3">
      <CoachTip n={3}>
        Answer with one of the buttons, or press{" "}
        {answersOf(style, session.classes, current)
          .map((item) => item.key)
          .join(", ")
          .replace(/, ([^,]*)$/, " or $1")}
        .
      </CoachTip>
      <CoachTip n={4}>
        The next object comes by itself. The dots take you back to any of them.
      </CoachTip>
      <Button variant="primary" size="lg" className="w-fit" onClick={startReview}>
        Got it, start
      </Button>
    </div>
  ) : null;

  const issueCard =
    setup.issue === "withdrawn" ? (
      <IssueCard
        icon="info"
        title={`${session.task?.code ?? "The task"} was withdrawn`}
        body={`${person(session.task?.created_by_user_id)?.name ?? "The researcher"} withdrew ${session.task?.code ?? "the task"} on 16 Oct. Your 7 decided slides are kept and show in the report.`}
        action={
          <Button
            variant="primary"
            size="lg"
            className="w-fit"
            onClick={() => void navigate({ to: "/my-work" })}
          >
            <Icon name="back" />
            Back to My work
          </Button>
        }
      />
    ) : noResults ? (
      <IssueCard
        icon="smart"
        title="Nothing to decide here yet."
        body={`${session.slideName.split(" ")[0]} has no ${setName} result in ${session.task?.code ?? "this task"}. Look at it without AI in the full viewer, or go on to the next slide.`}
        action={
          <Button variant="primary" size="lg" className="w-fit" onClick={() => void toSubmitted()}>
            Next slide
            <Icon name="next" />
          </Button>
        }
      />
    ) : null;

  const reviewBody = issueCard ? (
    issueCard
  ) : showDone ? (
    <SlideDoneCard
      className="min-h-full"
      slideNumber={session.neighbours?.position ?? 1}
      counts={{ ...counts, added: session.added.length }}
      questions={questions}
      blockers={doneBlockers}
      unsure={unsureAreas}
      submitLabel={nextLabel}
      failed={failed}
      warning={threadsWarning}
      onSubmit={submit}
      onAnswerChange={changeOpinion}
    />
  ) : current ? (
    <div className="flex min-h-full flex-col gap-5">
      <ObjectCard
        position={index + 1}
        total={objects.length}
        object={current}
        dots={
          <ObjectDots
            regions={regions}
            cells={cells}
            current={currentId}
            answer={answer}
            skipped={setup.showSkipped ? objects.map((item) => item.object) : []}
            lead={session.nodeStaging ? leadAreaId(regionAreas) : null}
            onJump={jump}
          />
        }
        text={cardText(style, current, confidence)}
        style={style}
        classes={session.classes}
        answer={kept}
        pending={
          setup.pending && noteFor !== null ? setup.pending : setup.connLost ? setup.pending : null
        }
        lockLine={lockLine}
        disabled={buttonsOff}
        disagreeOpen={disagreeOpen}
        note={note}
        coach={coachTips}
        areaCall={
          areaMode
            ? {
                value: callOf(kept?.value),
                role: roleText[areaRole(regionAreas, currentId)],
                onCall: callArea,
              }
            : undefined
        }
        onAnswer={answerWith}
        onReason={toggleReason}
        onBackToAnswers={() => setDisagreeOpen(false)}
        redrawPoints={redraw === null ? null : redraw.length}
        onFinishRedraw={finishRedraw}
        onCancelRedraw={() => setRedraw(null)}
        onFix={(what) =>
          what === "outline"
            ? startRedraw()
            : showUndoToast({ message: "Pick the right class with 1 to 4 (prototype)" })
        }
        onAddMissed={() =>
          showUndoToast({
            message: `Draw around what the AI missed. It becomes T${regions.length + 2}⁺ (prototype)`,
          })
        }
      />
      <div className="mt-auto flex items-center justify-between pt-2">
        <Button
          variant="ghost"
          disabled={index === 0}
          title={index === 0 ? "This is the first object" : undefined}
          onClick={() => goTo(index - 1)}
        >
          <Icon name="back" />
          Previous
          <Keycap action={previousObjectAction} size="sm" />
        </Button>
        <Button variant="ghost" onClick={() => goTo(index + 1)}>
          {kept ? "Next" : "Skip for now"}
          <Keycap action={nextObjectAction} size="sm" />
          <Icon name="next" />
        </Button>
      </div>
    </div>
  ) : null;

  const commentsBody =
    showDone || noResults ? (
      <ThreadsTab
        taskId={session.taskId}
        slideId={session.slideId}
        slideLabel={session.slideName.split(" ")[0] ?? ""}
        hidden={noResults}
        onOpen={(anchor) => {
          jump(anchor);
          onTabChange("comments");
        }}
        onGoTo={(anchor) => {
          jump(anchor);
          onTabChange("review");
        }}
      />
    ) : (
      <ObjectComments
        taskId={session.taskId}
        slideId={session.slideId}
        object={currentId}
        threads={session.threads}
        meId={session.meId}
        blind={session.task?.blinded ?? false}
        blindReviewers={blindReviewers}
        initialDraft={setup.commentDraft}
        offReason={setup.connLost ? netOff : undefined}
        onSent={(text) =>
          showUndoToast({
            message: `Comment added on ${currentId}. It shows in the full viewer too${text.includes("@") ? ", and the people you mention are told" : ""}.`,
          })
        }
      />
    );

  const banner = setup.connLost ? (
    <ConnectionBanner pinned />
  ) : setup.readOnly ? (
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
  ) : submitted && !showDone ? (
    <Banner tone="info">
      You submitted this slide. Changes are saved and {otherReviewer} is told.
    </Banner>
  ) : null;

  const canvasIssue = tileFail ? (
    <CanvasNotice
      icon="warn"
      title={`${session.slideName.split(" ")[0]} could not be read at 20x and 40x.`}
      actions={
        <>
          <Button variant="primary">Retry</Button>
          <Button>Ask the researcher</Button>
        </>
      }
    >
      Tiles are missing on the server. Lower magnifications still show, and your other slides work.
    </CanvasNotice>
  ) : noResults ? (
    <CanvasNotice
      icon="smart"
      title={`No ${setName} result on ${session.slideName.split(" ")[0]} yet.`}
      actions={<Button>Ask the researcher</Button>}
    >
      Review the slide without AI, or ask the researcher to run the model.
    </CanvasNotice>
  ) : null;

  return (
    <main
      className="flex h-dvh min-w-0 flex-col bg-page text-fg"
      data-scene={scene ?? "region"}
      data-ai={session.task?.ai_hidden_first_read ? "shown" : undefined}
    >
      <ReviewTop
        mode="guided"
        onHowItWorks={coach.reopen}
        object={currentId || undefined}
        session={session}
        counts={counts}
        onWholeSlide={() => setWhole(true)}
        nothingToDecide={noResults}
        submitReason={noResults ? "Nothing to decide on this slide" : submitReason}
        onSubmit={() => {
          setShowDone(true);
          setWhole(true);
          onTabChange("review");
        }}
      />
      {banner}
      <div data-vt-target="" className="flex min-h-0 flex-1">
        <SlideStill
          view={view}
          camera={camera}
          onCameraChange={setCamera}
          backdrop={backdrop}
          engineDrawn={claimShown ? still.ids : undefined}
          regionDecisions={regionDecisions}
          cellDecisions={cellDecisions}
          ringedCells={confirmRest ? openCells.map((cell) => cell.object) : []}
          claimHidden={!showsClaim(style)}
          drawAs={settings.draw}
          showIds={settings.ids}
          failed={tileFail}
          bare={noResults}
          minimap={!noResults}
          hint={!showDone && !noResults}
          slideName={session.slideName}
          onPointPick={redraw === null ? undefined : pickPoint}
          overlay={({ camera: shown, size, moved }) => (
            <>
              <RedrawLayer
                camera={shown}
                size={size}
                draft={redraw}
                saved={redrawn[currentId] ?? null}
                onClose={finishRedraw}
              />
              {canvasIssue}
              {coachOn ? (
                <>
                  <CoachTip n={1} className="absolute top-[45%] left-[35%] w-75">
                    The AI found this. It is outlined in white.
                  </CoachTip>
                  <CoachTip n={2} className="absolute bottom-24 left-4 w-85">
                    Drag to move around. Scroll or use + and − to zoom. Back to {currentId} brings
                    you back.
                  </CoachTip>
                </>
              ) : null}
              {view.kind === "whole" && cells.length && !noResults ? (
                <CellCluster
                  className="absolute top-[50%] left-[54%]"
                  split={countAnswers(cells, answer)}
                  onClick={() => {
                    setWhole(false);
                    setShowDone(false);
                    jump("cells");
                  }}
                />
              ) : null}
              {cellCount && current?.kind === "cell" && !showDone && !noResults ? (
                <CellCountChip
                  result={cellCount}
                  className="absolute top-4 left-1/2 -translate-x-1/2"
                />
              ) : null}
              {current?.kind === "cell" && !showDone && !noResults ? (
                cellsShut ? (
                  <CellsLauncher
                    className="absolute bottom-18 left-1/2 -translate-x-1/2"
                    decided={cells.length - openCells.length}
                    total={cells.length}
                    onClick={() => setCellsShut(false)}
                  />
                ) : (
                  <CellsGrid
                    className="absolute bottom-18 left-1/2 w-fit -translate-x-1/2"
                    cells={cells}
                    current={currentId}
                    answer={answer}
                    answerKeys={answersOf(style, session.classes, current).map((item) => item.key)}
                    claimHidden={!showsClaim(style)}
                    folded={cellsFolded}
                    confirming={confirmRest}
                    onPick={(object) => jump(object)}
                    onNotNucleus={buttonsOff ? undefined : notNucleus}
                    onAgreeRest={() => setConfirmRest(true)}
                    onCancelRest={() => setConfirmRest(false)}
                    onApplyRest={() => {
                      const next = new Map(overrides);
                      const before = overrides;
                      for (const cell of openCells) {
                        decisions.save(cell.object, rawFor(style, "agree", cell), "agree");
                        next.set(cell.object, {
                          value: "agree",
                          raw: "agree",
                          reasons: [],
                          note: null,
                        });
                      }
                      setOverrides(next);
                      setConfirmRest(false);
                      showUndoToast({
                        message: `${openCells.length} cells marked agree`,
                        undo: () => {
                          setOverrides(before);
                          for (const cell of openCells) decisions.restore(cell.object, undefined);
                        },
                      });
                    }}
                    onFoldChange={setCellsFolded}
                    onClose={() => setCellsShut(true)}
                  />
                )
              ) : null}
              {noResults ? null : (
                <div className="absolute bottom-4 left-4 flex items-center gap-2">
                  {showDone ? null : (
                    <Button
                      size="lg"
                      variant={moved && !confirmRest ? "primary" : "secondary"}
                      title={`Center ${currentId} again`}
                      onClick={() => {
                        setCamera(null);
                        setWhole(false);
                      }}
                    >
                      <Icon name="target" />
                      Back to {currentId}
                    </Button>
                  )}
                  <fieldset
                    aria-label="Zoom"
                    className="m-0 inline-flex h-10 min-w-0 items-center rounded-ctl border border-line-strong bg-btn-bg p-0"
                  >
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      aria-label="Zoom out"
                      title="Zoom out (−)"
                      onClick={() => setCamera({ ...shown, scale: shown.scale / 1.4 })}
                    >
                      <Icon name="minus" />
                    </Button>
                    <span
                      className="min-w-14 text-center font-mono text-body-sm font-semibold"
                      title="Magnification on screen"
                    >
                      {readout(view, shown)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      aria-label="Zoom in"
                      title="Zoom in (+)"
                      onClick={() => setCamera({ ...shown, scale: shown.scale * 1.4 })}
                    >
                      <Icon name="plus" />
                    </Button>
                  </fieldset>
                  <Button
                    size="lg"
                    className={
                      view.kind === "whole"
                        ? "border-accent bg-[color-mix(in_srgb,var(--accent)_18%,var(--chrome))]"
                        : undefined
                    }
                    aria-pressed={view.kind === "whole"}
                    title={view.kind === "whole" ? `Back to ${currentId}` : "See the whole slide"}
                    onClick={() => {
                      setCamera(null);
                      setWhole(view.kind !== "whole");
                      if (view.kind === "whole") setShowDone(false);
                    }}
                  >
                    <Icon name="expand" />
                    Whole slide
                  </Button>
                </div>
              )}
            </>
          )}
        />
        <SidePanel
          width={470}
          variant="quiet"
          value={tabNow}
          onValueChange={(next) => onTabChange(next as GuidedTab)}
          tabs={[
            { value: "review", label: "Review", body: reviewBody },
            {
              value: "comments",
              label: "Comments",
              ...(messages.length && !showDone ? { count: messages.length } : {}),
              ...(showDone && openThreads ? { count: openThreads } : {}),
              body: commentsBody,
            },
            {
              value: "display",
              label: "Display",
              body: (
                <DisplayTab
                  display={session.display}
                  preset={choice.preset}
                  extraLocks={extraLocks}
                  confidence={shownConfidence}
                  changed={choice.changed}
                  saveBlocked={choice.save.reason}
                  onSave={choice.saveChanges}
                  onPresetPick={choice.pick}
                  overrides={choice.overrides}
                  onSettingChange={choice.change}
                  onSaveAs={() => setSavingPreset(true)}
                />
              ),
            },
          ]}
        />
      </div>
      <SavePresetModal
        open={savingPreset}
        slideLabel={session.slideName.split(" ")[0] ?? ""}
        taskCode={session.task?.code ?? "this task"}
        taken={(session.display?.presets ?? []).map((item) => item.name)}
        onClose={() => setSavingPreset(false)}
        onSave={async (name, scope) => {
          const result = await choice.saveAs(name, scope);
          if (result.status === "saved") {
            setSavingPreset(false);
            showUndoToast({
              message: `Preset ${name} saved.`,
              ...(result.undo ? { undo: result.undo } : {}),
            });
          }
          return result.status;
        }}
      />
    </main>
  );
}

function CoachTip({
  n,
  children,
  className,
}: {
  n: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-zone bg-[#0ea5e9] px-3.5 py-3 text-body-sm leading-[1.45] text-white shadow-pop",
        className,
      )}
    >
      <b className="grid size-5.5 shrink-0 place-items-center rounded-full bg-white text-caption text-[#0369a1]">
        {n}
      </b>
      <span>{children}</span>
    </div>
  );
}

export function IssueCard({
  icon,
  title,
  body,
  action,
}: {
  icon: "info" | "smart";
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <div className="grid justify-items-start gap-3">
      <Icon name={icon} size="lg" className="text-fg-dim" />
      <h2 className="m-0 text-title-sm font-semibold">{title}</h2>
      <p className="m-0 text-body leading-[1.5] text-fg-dim">{body}</p>
      {action}
    </div>
  );
}

export function CanvasNotice({
  icon,
  title,
  actions,
  children,
}: {
  icon: "warn" | "smart" | "info";
  title: string;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="absolute top-4 left-1/2 w-[min(760px,calc(100%-2rem))] -translate-x-1/2">
      <InlineState
        icon={icon}
        title={title}
        action={<span className="flex gap-2">{actions}</span>}
        className="border-solid shadow-pop"
      >
        {children}
      </InlineState>
    </div>
  );
}
