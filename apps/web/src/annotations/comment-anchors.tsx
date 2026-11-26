import { Trans, useLingui } from "@lingui/react/macro";
import type { Thread } from "@parfocal/api-client";
import type { SlideArea } from "@parfocal/viewer-engine";
import { useEffect, useState } from "react";
import { slideToScreen } from "../viewer/viewer-engine.ts";
import { anchorWords } from "./anchor-words.ts";
import { ContextExtra, contextChip } from "./context-extras.tsx";
import type { Point } from "./polygon-draft.ts";
import type { StageRect } from "./stage-size.ts";

type Camera = Parameters<typeof slideToScreen>[0];

export type AnchorMark = { readonly thread: Thread; readonly point: Point };

export function AnchorMarks({
  marks,
  camera,
  rect,
  selecting,
  layerName,
  initials,
  onOpen,
}: {
  marks: readonly AnchorMark[];
  camera: Camera;
  rect: StageRect;
  selecting: boolean;
  layerName: (key: string) => string | undefined;
  initials: (thread: Thread) => string;
  onOpen: (threadId: string) => void;
}) {
  const { t } = useLingui();
  return (
    <>
      {marks.map(({ thread, point }) => {
        const at = slideToScreen(camera, rect, point);
        const words = anchorWords(thread.anchor, layerName);
        const mark = initials(thread);
        return (
          <button
            key={thread.id}
            type="button"
            data-slot="comment-anchor"
            data-thread={thread.id}
            data-kind={thread.anchor.kind}
            data-anchor={words.label}
            aria-label={t`${mark}, comment on ${words.label}: ${thread.title}`}
            title={`${words.label} · ${thread.title}`}
            className={`${selecting ? "pointer-events-none" : "pointer-events-auto"} absolute grid h-6 min-w-6 -translate-y-full cursor-pointer place-items-center rounded-full rounded-bl-none border-2 border-accent-fill bg-chrome px-1 font-semibold text-caption text-accent shadow-md`}
            style={{ left: at.x, top: at.y }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onOpen(thread.id)}
          >
            {mark}
          </button>
        );
      })}
    </>
  );
}

export function AnchorOutline({
  area,
  camera,
  rect,
}: {
  area: SlideArea | null;
  camera: Camera;
  rect: StageRect;
}) {
  if (area === null || (area.width === 0 && area.height === 0)) return null;
  const from = slideToScreen(camera, rect, { x: area.x, y: area.y });
  const to = slideToScreen(camera, rect, {
    x: area.x + area.width,
    y: area.y + area.height,
  });
  return (
    <span
      data-testid="comment-anchor-outline"
      aria-hidden
      className="absolute rounded-sm border-2 border-accent border-dashed bg-accent-soft/20"
      style={{
        left: from.x - 3,
        top: from.y - 3,
        width: to.x - from.x + 6,
        height: to.y - from.y + 6,
      }}
    />
  );
}

export function SelectionComment({
  stage,
  count,
  onComment,
}: {
  stage: HTMLElement;
  count: number;
  onComment: () => void;
}) {
  const { t } = useLingui();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (count === 0) {
      setMenu(null);
      return;
    }
    const open = (event: MouseEvent) => {
      event.preventDefault();
      const box = stage.getBoundingClientRect();
      setMenu({ x: event.clientX - box.left, y: event.clientY - box.top });
    };
    stage.addEventListener("contextmenu", open);
    return () => stage.removeEventListener("contextmenu", open);
  }, [stage, count]);
  useEffect(() => {
    if (menu === null) return;
    const away = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-testid="stage-menu"]')) {
        return;
      }
      setMenu(null);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [menu]);
  if (count === 0) return null;
  const words = count === 1 ? t`Comment on the selected object` : t`Comment on ${count} objects`;
  return (
    <>
      <ContextExtra>
        <button
          type="button"
          data-testid="context-comment"
          onClick={onComment}
          className={`${contextChip} cursor-pointer gap-1 font-sans text-fg hover:bg-chrome-2`}
        >
          <Trans>Comment</Trans>
        </button>
      </ContextExtra>
      {menu === null ? null : (
        <div
          role="menu"
          data-testid="stage-menu"
          className="pointer-events-auto absolute z-20 grid min-w-48 rounded-ctl border border-line bg-chrome p-1 shadow-pop"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(null);
              onComment();
            }}
            className="cursor-pointer rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-body-sm text-fg hover:bg-chrome-2"
          >
            {words}
          </button>
        </div>
      )}
    </>
  );
}
