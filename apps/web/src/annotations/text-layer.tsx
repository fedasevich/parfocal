import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import { bindClickPress } from "./click-press.ts";
import { type AnnotationDocument, isShapeHidden, updateShape } from "./document.ts";
import {
  addText,
  cleanText,
  maxTextLength,
  type TextDraft,
  textPointOf,
  textsOf,
} from "./marks.ts";
import type { ShapeId } from "./shapes.ts";
import { useStageRect } from "./stage-size.ts";

export type TextControl = {
  readonly restore: () => boolean;
  readonly edit: (id: ShapeId) => boolean;
};

type TextLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  document: AnnotationDocument;
  onApply: (next: AnnotationDocument, label: string) => void;
  control: RefObject<TextControl | null>;
};

export function TextLayer({
  engine,
  stage,
  active,
  document: doc,
  onApply,
  control,
}: TextLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const [draft, setDraftState] = useState<TextDraft | null>(null);
  const draftRef = useRef<TextDraft | null>(null);
  const dropped = useRef<TextDraft | null>(null);
  const latest = useRef({ doc, onApply, engine });
  latest.current = { doc, onApply, engine };

  const setDraft = useCallback((next: TextDraft | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const commit = useCallback(
    (words: TextDraft) => {
      dropped.current = null;
      setDraft(null);
      if (words.id !== undefined) {
        const text = cleanText(words.text);
        const current = latest.current.doc.shapes.get(words.id);
        if (current === undefined || text === "" || text === current.text) return;
        const next = updateShape(latest.current.doc, words.id, { text }).document;
        latest.current.onApply(next, "Edit text");
        return;
      }
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

  const escRegistry = useEscRegistry();
  useEffect(
    () => escRegistry?.add("draft", { open: () => draftRef.current !== null, peel: drop }),
    [escRegistry, drop],
  );

  useEffect(() => {
    control.current = {
      restore: () => {
        const back = dropped.current;
        if (!active || back === null || draftRef.current !== null) return false;
        dropped.current = null;
        setDraft(back);
        return true;
      },
      edit: (id) => {
        const shape = latest.current.doc.shapes.get(id);
        if (shape === undefined || shape.kind !== "text") return false;
        const open = draftRef.current;
        if (open !== null && cleanText(open.text) !== "") commit(open);
        dropped.current = null;
        setDraft({ id, point: textPointOf(shape), text: shape.text ?? "" });
        return true;
      },
    };
    return () => {
      control.current = null;
    };
  }, [active, control, setDraft, commit]);

  useEffect(() => {
    if (!active) {
      dropped.current = null;
      const open = draftRef.current;
      if (open !== null && open.id === undefined) {
        if (cleanText(open.text) !== "") commit(open);
        else setDraft(null);
      }
      return;
    }
    const click = (event: PointerEvent) => {
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
    return bindClickPress(stage, { engine: () => latest.current.engine, onClick: click });
  }, [active, stage, commit, setDraft]);

  const focusOnMount = useCallback((node: HTMLInputElement | null) => node?.focus(), []);

  const onInputBlur = () => {
    const open = draftRef.current;
    if (open === null || open !== draft) return;
    if (cleanText(open.text) === "") drop();
    else commit(open);
  };

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

  const texts = textsOf(doc).filter((shape) => !isShapeHidden(doc, shape));
  const where = draft === null ? null : slideToScreen(camera, rect, draft.point);

  return (
    <div
      data-testid="text-layer"
      data-texts={texts.length}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {texts
        .filter((shape) => shape.id !== draft?.id)
        .map((shape) => {
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
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
          onKeyDown={onInputKey}
          onBlur={onInputBlur}
          className="pointer-events-auto absolute h-7 w-48 -translate-y-1/2 rounded-ctl border border-accent bg-chrome px-2 text-body-sm text-fg outline-none"
          style={{ left: where.x, top: where.y }}
        />
      ) : null}
    </div>
  );
}
