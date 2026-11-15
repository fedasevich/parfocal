import { useLingui } from "@lingui/react/macro";
import type { Blocker } from "@parfocal/ui/components/before-you-list";
import type { OpinionQuestion } from "@parfocal/ui/components/slide-done-card";
import { ClassVisibility } from "@parfocal/ui/components/visualize";
import { useEffect, useRef } from "react";
import { provideDebug } from "../../debug-handle.ts";
import { engineBehindStill, noResultsOn, useStillBackdrop } from "../../viewer/still-backdrop.tsx";
import { useStillObjects } from "../../viewer/use-still-objects.ts";
import { useRememberResume } from "../home/remember-resume.ts";
import { type CameraSearch, cameraFromSearch, cameraToSearch } from "../review/camera-search.ts";
import { showsClaim } from "../review/decision-style.ts";
import { imageOf, magnificationOf, type StillView } from "../review/slide-still.tsx";
import { recallSlideCamera, rememberSlideCamera } from "../review/slide-switch.ts";
import { areaOrder, areaRoleText, areaRows } from "./area-nav.ts";
import { layerDrawing, setColours } from "./layer-views.tsx";
import { objectStyle } from "./object-draw.ts";
import { tableRows } from "./object-table-rows.ts";
import { useAreaNav } from "./use-area-nav.ts";
import type { useViewerState } from "./use-viewer-state.tsx";
import type { BodyProps } from "./viewer-model-types.ts";
import { addedSize } from "./viewer-model-types.ts";
import { viewerModelWarnings } from "./viewer-model-warnings.ts";

const cameraWriteDelayMs = 250;

export function useViewerScene(props: BodyProps, model: ReturnType<typeof useViewerState>) {
  const { t } = useLingui();
  const { onSearch, search, session, slideId } = props;
  const {
    added,
    addedCurrent,
    answer,
    areas,
    camera,
    cells,
    confidence,
    counts,
    current,
    failed,
    firstReadOpen,
    format,
    hiddenClasses,
    navigate,
    navigator,
    noTumor,
    objects,
    openCells,
    opinion,
    otherSetsOn,
    paged,
    peekOpen,
    people,
    personalSettings,
    pick,
    preset,
    regions,
    reviewedOn,
    running,
    scan,
    scanStep,
    scene,
    selected,
    setA,
    setB,
    setCamera,
    setFailed,
    setHiddenClasses,
    setPeekHeld,
    setSwipeAt,
    settings,
    setup,
    stats,
    style,
    submitReview,
    swipeAt,
    timing,
    typer,
    view,
  } = model;
  const stillView: StillView = current
    ? current.kind === "cell"
      ? { kind: "cell", object: current.object }
      : { kind: "region", object: current.object }
    : addedCurrent
      ? { kind: "region", object: addedCurrent.object }
      : { kind: "whole" };
  const cameraImage = imageOf(stillView);
  const shownCamera = camera ?? cameraFromSearch(cameraImage, search);
  const pagedFollow = paged?.follow;
  const pagedHere = stillView.kind === "cell" ? paged?.positionOf(stillView.object) : undefined;
  const pagedAt = (axis: "x" | "y") => {
    const at = shownCamera ?? pagedHere;
    return stillView.kind === "cell" && at ? Math.round(at[axis] / 150) * 150 : null;
  };
  const pagedX = pagedAt("x");
  const pagedY = pagedAt("y");
  useEffect(() => {
    pagedFollow?.(pagedX === null || pagedY === null ? null : { x: pagedX, y: pagedY });
  }, [pagedFollow, pagedX, pagedY]);
  const pagedPin = paged?.pin;
  const decidedKey = cells
    .filter((cell) => answer(cell.object))
    .map((cell) => cell.object)
    .join(",");
  useEffect(() => {
    if (decidedKey !== "") pagedPin?.(decidedKey.split(","));
  }, [pagedPin, decidedKey]);
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
    [setCamera],
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
    split: swipeAt,
    onSplit: setSwipeAt,
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
  const objectTableRows = tableRows(
    objects,
    added.map((item) => ({
      object: item.object,
      size: addedSize(item.note),
      note: item.note,
    })),
    answer,
    format,
    preset ?? "",
  );
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
          text: t`${region.object} is still open`,
          goTo: t`Go to ${region.object}`,
          onGoTo: () => {
            pick(region.object);
            onSearch({ object: region.object, tab: "objects" });
          },
        })),
        ...(openCells.length
          ? [
              {
                id: "cells",
                text: t`${openCells.length} cell${openCells.length === 1 ? "" : "s"} in the sample ${openCells.length === 1 ? "is" : "are"} still open`,
                goTo: t`Go to the cells`,
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
          text: t`Question ${position + 1} is not answered`,
          goTo: t`Answer it`,
        }));
  const submit = () => {
    if (failed) {
      setFailed(false);
      return;
    }
    submitReview.mutate({ taskId: session.taskId, slideId: session.slideId });
    timing.finish();
    void navigate({
      to: "/tasks/$taskId/submitted",
      params: { taskId: session.taskId },
      search: { slide: session.slideId },
    });
  };

  const noTask = search.task === undefined && session.objects.length === 0;
  const nothing =
    firstReadOpen || noTask || setup.issue === "noresults" || setup.issue === "withdrawn";
  const plainObjects = (view === "panel" || view === "table") && !nothing && !running;
  const still = useStillObjects(
    objects,
    (object) => answer(object)?.value,
    stillView.kind === "region" ? stillView.object : null,
    session.slideSize,
  );
  const backdrop = useStillBackdrop({
    enabled: engineBehindStill({
      cellView: stillView.kind === "cell",
      tilesFailed: setup.tiles !== "sharp" || setup.issue === "slidefail",
      noResults: noResultsOn(search.task !== undefined, objects),
      ownLayers: drawing.second !== undefined,
    }),
    slideId,
    objects: plainObjects && showsClaim(style) ? still.objects : null,
    choices: settings,
    hiddenClasses,
  });
  const modelWarnings = viewerModelWarnings(
    typer,
    objects,
    personalSettings?.model_warnings ?? true,
  );
  const taskCodeOrThis = session.task?.code ?? t`this task`;
  const taskCodeOrThe = session.task?.code ?? t`The task`;
  return {
    stillView,
    shownCamera,
    ranked,
    areaNav,
    areaRole,
    meId,
    drawing,
    showScore,
    objectTableRows,
    classColour,
    styleOfObject,
    classVisibility,
    openRegions,
    blockers,
    questions,
    doneBlockers,
    submit,
    noTask,
    nothing,
    plainObjects,
    still,
    backdrop,
    modelWarnings,
    taskCodeOrThis,
    taskCodeOrThe,
  };
}
