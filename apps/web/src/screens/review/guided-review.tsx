import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  resolveSetting,
  useGetMySettingLayers,
  useGetReviewedLayer,
  useReopenSlideReview,
  useSubmitSlideReview,
} from "@parfocal/api-client";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { CellCluster, CellsLauncher } from "@parfocal/ui/components/cells-panel";
import { DecisionButtons } from "@parfocal/ui/components/decision-buttons";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { SidePanel } from "@parfocal/ui/components/side-panel";
import { SlideDoneCard } from "@parfocal/ui/components/slide-done-card";
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
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { polygonToGeoJson } from "../../annotations/geojson.ts";
import { closeDraft, type Point, type PolygonDraft } from "../../annotations/polygon-draft.ts";
import { useConnection } from "../../shell/connection.ts";
import { ConnectionBanner } from "../../shell/connection-banner.tsx";
import { useLabDecisionCutoff, useResolvedSettings } from "../../shell/resolved-settings.ts";
import { showUndoToast } from "../../shell/undo-toasts.tsx";
import { useCellTiming, useTaskRun } from "../../telemetry/use-task-timing.ts";
import { engineBehindStill, noResultsOn, useStillBackdrop } from "../../viewer/still-backdrop.tsx";
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
import {
  openBlockers,
  opinionQuestions,
  questionBlockers,
  unsureBlockers,
} from "./guided-blockers.ts";
import { coachShown, useGuidedCoach } from "./guided-coach.ts";
import { orderObjects, zoomedCamera } from "./guided-drive.ts";
import { GuidedGate } from "./guided-gate.tsx";
import { CameraBar, CanvasNotice, CoachTip, IssueCard } from "./guided-parts.tsx";
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
import type { ReviewSession } from "./review-data.ts";
import { type Answer, type Answers, answerOf, baseAnswers, countAnswers } from "./review-state.ts";
import { ReviewTop } from "./review-top.tsx";
import { type Camera, homeCamera, SlideStill, type StillView } from "./slide-still.tsx";
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
  behind?: boolean;
  tab: GuidedTab | undefined;
  onTabChange: (tab: GuidedTab) => void;
};

export function GuidedReview(props: GuidedReviewProps) {
  return (
    <GuidedGate taskId={props.taskId} slideId={props.slideId}>
      {(session) => (
        <GuidedBody
          key={`${props.scene ?? "region"}-${props.slideId}`}
          session={session}
          {...props}
        />
      )}
    </GuidedGate>
  );
}

type BodyProps = GuidedReviewProps & { session: ReviewSession };

function GuidedBody({
  session,
  objectId,
  camera: startCamera,
  scene,
  submitted: submittedAtOpen,
  behind = false,
  tab,
  onTabChange,
}: BodyProps) {
  const { t } = useLingui();
  const netOff = t`The connection is lost. It saves when the connection is back.`;
  const { online } = useConnection();
  const sceneSetup = guidedSetup(scene);
  const setup = { ...sceneSetup, connLost: sceneSetup.connLost || !online };
  const navigate = useNavigate();
  const person = usePeople();
  const submitReview = useSubmitSlideReview({
    mutation: { onSuccess: () => markTried("guided-review") },
  });
  const reopenReview = useReopenSlideReview();
  const [reopened, setReopened] = useState(false);
  const submitted = submittedAtOpen && !reopened;
  const threadsWarning = useOpenThreadsWarning(session.taskId, session.slideId);
  const style = setup.style ? { ...session.style, kind: setup.style } : session.style;
  const decisions = useDecisionSaves(session, style);
  const extraLocks: DisplayLock[] = setup.confidenceLock
    ? [{ setting: "confidence", value: "hidden", reason: setup.confidenceLock }]
    : [];
  const labCutoff = useLabDecisionCutoff();
  const choice = useDisplayChoice(session, setup.preset);
  const [savingPreset, setSavingPreset] = useState(false);
  useShiftPresetKeys(session.display, choice);
  const sceneSettings = withOverrides(
    displaySettings(session.display, choice.preset, extraLocks, undefined, labCutoff),
    choice.overrides,
    session.display,
    extraLocks,
  );
  const orderedObjects = useMemo(
    () =>
      orderObjects(session.objects, sceneSettings.order, `${session.taskId}:${session.slideId}`),
    [session.objects, sceneSettings.order, session.taskId, session.slideId],
  );
  const objects = setup.issue === "noresults" ? [] : orderedObjects;
  const noResults = noResultsOn(true, objects);
  const minimapOff = useResolvedSettings()?.minimap === "never";
  const regions = objects.filter((item) => item.kind === "region");
  const cells = objects.filter((item) => item.kind === "cell");
  const base = baseAnswers(
    objects,
    session.decisions,
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
  const coach = useGuidedCoach(scene === undefined && objectId === undefined);
  const coachOn = coachShown(setup.coach || coach.open, objects.length);
  const slideShort = session.slideName.split(" ")[0] ?? "";
  const creatorName = person(session.task?.created_by_user_id)?.name;
  const researcherFirstName = creatorName?.split(" ")[0];
  const withdrawnBy = creatorName ?? t`The researcher`;
  const withdrawnTask = session.task?.code ?? t`the task`;
  const taskCodeOrThe = session.task?.code ?? t`The task`;
  const taskCodeOrThis = session.task?.code ?? t`this task`;
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
  const answerKeyList = answersOf(style, session.classes, current)
    .map((item) => item.key)
    .join(", ")
    .replace(/, ([^,]*)$/, t` or $1`);
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
  const myLayers = okData(useGetMySettingLayers().data);
  const wording =
    scene === undefined
      ? resolveSetting("confidence_wording", {
          lab: myLayers?.lab ?? { values: {}, locked: [] },
          personal: myLayers?.personal ?? {},
          device: {},
        }).value
      : null;
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
    setFailed(false);
    submitReview.mutate(
      { taskId: session.taskId, slideId: session.slideId },
      {
        onSuccess: () => {
          timing.finish();
          void toSubmitted();
        },
        onError: () => setFailed(true),
      },
    );
  };
  const reopen = () =>
    reopenReview.mutate(
      { taskId: session.taskId, slideId: session.slideId },
      { onSuccess: () => setReopened(true) },
    );

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
    session.slideSize,
  );
  const backdrop = useStillBackdrop({
    enabled: engineBehindStill({
      cellView: view.kind === "cell",
      tilesFailed: tileFail,
      noResults,
    }),
    slideId: session.slideId,
    objects: claimShown ? still.objects : null,
    choices: settings,
  });
  const submitReason =
    counts.open > 0
      ? plural(counts.open, {
          one: "# object is still open.",
          other: "# objects are still open.",
        })
      : undefined;
  const openRegions = regions.filter((region) => !answer(region.object));
  const blockers = openBlockers(openRegions, openCells.length, jump);
  const questions = opinionQuestions(session, opinion, setup.dropAnswers);
  const unsureAreas = session.nodeStaging ? unsureBlockers(unsureAreaIds(regionAreas), jump) : [];
  const doneBlockers = counts.open ? blockers : questionBlockers(questions, opinion);
  const nextLabel = !session.neighbours
    ? "Submit"
    : session.neighbours.next === null
      ? "Submit and finish the task"
      : `Submit and open slide ${session.neighbours.position + 1}`;
  const lockedReason = behind
    ? "Submitted. Your review can be changed until sign-off."
    : submitted
      ? "You submitted this slide. Reopen your review to change it."
      : undefined;

  const authorOfNotes = person(session.meId);
  const kept = answer(currentId);
  const underSlideButtons =
    settings.buttons === "bottom" &&
    tabNow === "review" &&
    !showDone &&
    !noResults &&
    !disagreeOpen &&
    redraw === null &&
    !areaMode &&
    !setup.issue;
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
        <Trans>Add a note</Trans>
        <Keycap action={noteAction} size="sm" />
      </button>
    ) : null;

  const coachTips = coachOn ? (
    <div className="grid gap-3">
      <CoachTip n={3}>
        <Trans>Answer with one of the buttons, or press {answerKeyList}.</Trans>
      </CoachTip>
      <CoachTip n={4}>
        <Trans>The next object comes by itself. The dots take you back to any of them.</Trans>
      </CoachTip>
      <Button variant="primary" size="lg" className="w-fit" onClick={startReview}>
        <Trans>Got it, start</Trans>
      </Button>
    </div>
  ) : null;

  const issueCard =
    setup.issue === "withdrawn" ? (
      <IssueCard
        icon="info"
        title={t`${taskCodeOrThe} was withdrawn`}
        body={t`${withdrawnBy} withdrew ${withdrawnTask} on 16 Oct. Your 7 decided slides are kept and show in the report.`}
        action={
          <Button
            variant="primary"
            size="lg"
            className="w-fit"
            onClick={() => void navigate({ to: "/my-work" })}
          >
            <Icon name="back" />
            <Trans>Back to My work</Trans>
          </Button>
        }
      />
    ) : noResults ? (
      <IssueCard
        icon="smart"
        title={t`Nothing to decide here yet.`}
        body={t`${slideShort} has no ${setName} result in ${taskCodeOrThis}. Look at it without AI in the full viewer, or go on to the next slide.`}
        action={
          <Button variant="primary" size="lg" className="w-fit" onClick={() => void toSubmitted()}>
            <Trans>Next slide</Trans>
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
      {...(lockedReason ? { lockedReason } : {})}
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
        answersElsewhere={underSlideButtons}
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
          title={index === 0 ? t`This is the first object` : undefined}
          onClick={() => goTo(index - 1)}
        >
          <Icon name="back" />
          <Trans>Previous</Trans>
          <Keycap action={previousObjectAction} size="sm" />
        </Button>
        <Button variant="ghost" onClick={() => goTo(index + 1)}>
          {kept ? t`Next` : t`Skip for now`}
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
            message: text.includes("@")
              ? t`Comment added on ${currentId}. It shows in the full viewer too, and the people you mention are told.`
              : t`Comment added on ${currentId}. It shows in the full viewer too.`,
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
          {researcherFirstName === undefined ? (
            <Trans>Ask the researcher to amend</Trans>
          ) : (
            <Trans>Ask {researcherFirstName} to amend</Trans>
          )}
        </Button>
      }
    >
      <Trans>
        <b>Signed off.</b> Changes need an amendment.
      </Trans>
    </Banner>
  ) : submitted && !behind ? (
    <Banner
      tone="info"
      actions={
        <Button size="sm" onClick={reopen}>
          <Trans>Reopen my review</Trans>
        </Button>
      }
    >
      <Trans>You submitted this slide. Changes are saved and {otherReviewer} is told.</Trans>
    </Banner>
  ) : null;

  const canvasIssue = tileFail ? (
    <CanvasNotice
      icon="warn"
      title={t`${slideShort} could not be read at 20x and 40x.`}
      actions={
        <>
          <Button variant="primary">
            <Trans>Retry</Trans>
          </Button>
          <Button>
            <Trans>Ask the researcher</Trans>
          </Button>
        </>
      }
    >
      <Trans>
        Tiles are missing on the server. Lower magnifications still show, and your other slides
        work.
      </Trans>
    </CanvasNotice>
  ) : noResults ? (
    <CanvasNotice
      icon="smart"
      title={t`No ${setName} result on ${slideShort} yet.`}
      actions={
        <Button>
          <Trans>Ask the researcher</Trans>
        </Button>
      }
    >
      <Trans>Review the slide without AI, or ask the researcher to run the model.</Trans>
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
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SlideStill
            view={view}
            homeOf={(size, shapes) =>
              view.kind === "whole"
                ? homeCamera(view, size, shapes)
                : zoomedCamera(homeCamera(view, size, shapes), settings.zoom)
            }
            camera={camera}
            onCameraChange={setCamera}
            backdrop={backdrop}
            engineDrawn={claimShown ? still.ids : undefined}
            outlines={still.outlines}
            outlineFrame={still.frame}
            regionDecisions={regionDecisions}
            cellDecisions={cellDecisions}
            ringedCells={confirmRest ? openCells.map((cell) => cell.object) : []}
            claimHidden={!showsClaim(style)}
            drawAs={settings.draw}
            showIds={settings.ids}
            failed={tileFail}
            bare={noResults}
            minimap={!noResults && !minimapOff}
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
                      <Trans>The AI found this. It is outlined in white.</Trans>
                    </CoachTip>
                    <CoachTip n={2} className="absolute bottom-24 left-4 w-85">
                      <Trans>
                        Drag to move around. Scroll or use + and − to zoom. Back to {currentId}{" "}
                        brings you back.
                      </Trans>
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
                      slideId={session.slideId}
                      className="absolute bottom-18 left-1/2 w-fit -translate-x-1/2"
                      cells={cells}
                      current={currentId}
                      answer={answer}
                      answerKeys={answersOf(style, session.classes, current).map(
                        (item) => item.key,
                      )}
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
                  <CameraBar
                    view={view}
                    shown={shown}
                    moved={moved}
                    showDone={showDone}
                    confirmRest={confirmRest}
                    currentId={currentId}
                    onCamera={setCamera}
                    onBack={() => {
                      setCamera(null);
                      setWhole(false);
                    }}
                    onWhole={() => {
                      setCamera(null);
                      setWhole(view.kind !== "whole");
                      if (view.kind === "whole") setShowDone(false);
                    }}
                  />
                )}
              </>
            )}
          />
          {underSlideButtons && current ? (
            <div
              className="flex shrink-0 justify-center border-t border-line bg-chrome p-3"
              data-testid="under-slide-buttons"
            >
              <DecisionButtons
                decisionStyle={style.kind}
                value={kept?.raw}
                onValueChange={answerWith}
                classes={session.classes}
                aiClass={current.class_name}
                range={{ agreeFrom: style.agreeFrom, disagreeTo: style.disagreeTo }}
                disabled={buttonsOff}
                label={t`Your answer on ${currentId}`}
              />
            </div>
          ) : null}
        </div>
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
