import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import type { AnnotationDocument } from "./document.ts";
import {
  addText,
  cleanText,
  maxTextLength,
  type TextDraft,
  textPointOf,
  textsOf,
} from "./marks.ts";

export type TextControl = { readonly restore: () => boolean };

type TextLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  document: AnnotationDocument;
  onApply: (next: AnnotationDocument, label: string) => void;
  onLeave: () => void;
  control: RefObject<TextControl | null>;
};

const clickSlopScreenPixels = 3;

export function TextLayer({
  engine,
  stage,
  active,
  document: doc,
  onApply,
  onLeave,
  control,
}: TextLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const [draft, setDraftState] = useState<TextDraft | null>(null);
  const draftRef = useRef<TextDraft | null>(null);
  const dropped = useRef<TextDraft | null>(null);
  const latest = useRef({ doc, onApply, onLeave, engine });
  latest.current = { doc, onApply, onLeave, engine };

  const setDraft = useCallback((next: TextDraft | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const commit = useCallback(
    (words: TextDraft) => {
      dropped.current = null;
      setDraft(null);
      const next = addText(latest.current.doc, words);
      if (next !== latest.current.doc) latest.current.onApply(next, "Add text");
    },
    [setDraft],
  );

  const drop = useCallback(() => {
    const open = draftRef.current;
    if (open !== null && cleanText(open.text) !== "") dropped.current = open;
    setDraft(null);
  }, [setDraft]);

  useEffect(() => {
    control.current = {
      restore: () => {
        const back = dropped.current;
        if (!active || back === null || draftRef.current !== null) return false;
        dropped.current = null;
        setDraft(back);
        return true;
      },
    };
    return () => {
      control.current = null;
    };
  }, [active, control, setDraft]);

  useEffect(() => {
    if (!active) {
      dropped.current = null;
      setDraft(null);
      return;
    }
    let pressed: { id: number; x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pressed = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const up = (event: PointerEvent) => {
      if (pressed === null || event.pointerId !== pressed.id || event.button !== 0) return;
      const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
      pressed = null;
      if (moved > clickSlopScreenPixels) return;
      event.stopImmediatePropagation();
      const open = draftRef.current;
      if (open !== null) commit(open);
      dropped.current = null;
      setDraft({
        point: screenToSlide(
          latest.current.engine.getCamera(),
          stage.getBoundingClientRect(),
          event.clientX,
          event.clientY,
        ),
        text: "",
      });
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && draftRef.current === null) latest.current.onLeave();
    };
    stage.addEventListener("pointerdown", down, true);
    stage.addEventListener("pointerup", up, true);
    window.addEventListener("keydown", key);
    return () => {
      stage.removeEventListener("pointerdown", down, true);
      stage.removeEventListener("pointerup", up, true);
      window.removeEventListener("keydown", key);
    };
  }, [active, stage, commit, setDraft]);

  const focusOnMount = useCallback((node: HTMLInputElement | null) => node?.focus(), []);

  const onInputKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const open = draftRef.current;
      if (open === null) return;
      if (cleanText(open.text) === "") drop();
      else commit(open);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      drop();
    }
  };

  const rect = { left: 0, top: 0, width: stage.clientWidth, height: stage.clientHeight };
  const texts = textsOf(doc);
  const where = draft === null ? null : slideToScreen(camera, rect, draft.point);

  return (
    <div
      data-testid="text-layer"
      data-texts={texts.length}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {texts.map((shape) => {
        const at = slideToScreen(camera, rect, textPointOf(shape));
        return (
          <span
            key={shape.id}
            data-testid="text-shape"
            className="absolute whitespace-pre font-semibold text-body-sm text-fg [text-shadow:0_0_3px_#fff,0_0_3px_#fff,0_0_6px_#fff]"
            style={{ left: at.x, top: at.y, transform: "translateY(-50%)" }}
          >
            {shape.text}
          </span>
        );
      })}
      {draft !== null && where !== null ? (
        <input
          key={`${draft.point.x},${draft.point.y}`}
          ref={focusOnMount}
          data-testid="text-draft"
          aria-label="Text label"
          value={draft.text}
          maxLength={maxTextLength}
          onChange={(event) => setDraft({ point: draft.point, text: event.target.value })}
          onKeyDown={onInputKey}
          className="pointer-events-auto absolute h-7 w-48 -translate-y-1/2 rounded-ctl border border-accent bg-chrome px-2 text-body-sm text-fg outline-none"
          style={{ left: where.x, top: where.y }}
        />
      ) : null}
    </div>
  );
}
