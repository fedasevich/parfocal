import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@parfocal/ui/components/dropdown-menu";
import { Icon } from "@parfocal/ui/components/icon";
import { ObjectIdTag } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  memo,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLengthUnits } from "../measure/length-units.ts";
import { formatArea, formatPerimeter, measureShape } from "../measure/shape-measure.ts";
import { useStageMicronsPerPixel } from "../viewer/stage-measurements.tsx";
import {
  publishLayerNames,
  requestLayerComment,
  requestRowThread,
  useThreadCounts,
} from "./comment-bus.ts";
import { type AnnotationDocument, removeGroup, updateGroup } from "./document.ts";
import { drawnObjectIds, useSavedCodes } from "./drawn-object-ids.ts";
import {
  deleteGroupWithShapes,
  type LayerContext,
  renameGroup,
  rgbOfHex,
  toggleHidden,
  toggleLocked,
} from "./layers.ts";
import {
  type DropPlace,
  type DropTarget,
  dropRows,
  groupKey,
  groupPickLimit,
  itemNameLimit,
  materialiseClass,
  membersOf,
  openKeysFor,
  parseKey,
  rangeOf,
  renameShape,
  shapeKey,
  type TreeRow,
  toggleShapeHidden,
  toggleShapeLocked,
  treeRowPx,
  treeRows,
  unionBounds,
} from "./layers-tree.ts";
import type { Extent, GroupId, Shape, ShapeId } from "./shapes.ts";

const dragThresholdPx = 4;
const edgeScrollPx = 24;
const treeHeightPx = 320;

type LayersTreeProps = {
  document: AnnotationDocument;
  context: LayerContext;
  onApply: (next: AnnotationDocument, label: string) => void;
  selected: readonly ShapeId[];
  onPick: (ids: readonly ShapeId[], bounds: Extent | null) => void;
  storageKey: string;
  target: GroupId | null;
  onTarget: (id: GroupId | null) => void;
};

type Pending = {
  readonly keys: readonly string[];
  readonly x: number;
  readonly y: number;
  active: boolean;
};

type Actions = {
  click: (row: TreeRow, event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
  toggleOpen: (row: TreeRow) => void;
  hide: (row: TreeRow) => void;
  lock: (row: TreeRow) => void;
  startRename: (row: TreeRow) => void;
  finishRename: (row: TreeRow, name: string | null) => void;
  colour: (row: TreeRow, hex: string) => void;
  ungroup: (row: TreeRow) => void;
  remove: (row: TreeRow) => void;
  aim: (row: TreeRow) => void;
  press: (row: TreeRow, event: ReactPointerEvent) => void;
  comment: (row: TreeRow) => void;
};

function readOpen(key: string): Set<string> {
  try {
    const stored = window.localStorage.getItem(key);
    const parsed: unknown = stored === null ? [] : JSON.parse(stored);
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function writeOpen(key: string, open: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...open]));
  } catch {
    return;
  }
}

const shownName = (row: TreeRow) => (row.kind === "group" ? row.name : (row.name ?? row.label));

const kindWords: Record<Shape["kind"], string> = {
  polygon: "Polygon",
  freehand: "Freehand",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  brush: "Brush",
  point: "Cell",
  ruler: "Ruler",
  arrow: "Arrow",
  text: "Text",
};

const iconButton =
  "grid size-6 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-fg-faint hover:bg-chrome-2 hover:text-fg";

const Row = memo(function Row({
  row,
  top,
  selected,
  picked,
  aimed,
  renaming,
  drop,
  measure,
  comments,
  actions,
}: {
  row: TreeRow;
  comments: number;
  measure: string | null;
  top: number;
  selected: boolean;
  picked: boolean;
  aimed: boolean;
  renaming: boolean;
  drop: DropPlace | null;
  actions: Actions;
}) {
  const { t } = useLingui();
  const name = shownName(row);
  const group = row.kind === "group";
  const saved = group && row.groupId !== null;
  const off = row.hidden;
  const [draft, setDraft] = useState(name);
  const [menuOpen, setMenuOpen] = useState(false);
  const chooseAll = useCallback((node: HTMLInputElement | null) => {
    node?.focus();
    node?.select();
  }, []);
  useEffect(() => {
    if (renaming) setDraft(name);
  }, [renaming, name]);
  return (
    <li
      data-testid="layers-row"
      data-key={row.key}
      data-kind={row.kind}
      data-depth={row.depth}
      data-selected={selected || picked || undefined}
      data-target={aimed || undefined}
      data-hidden={off || undefined}
      data-locked={row.locked || undefined}
      data-expanded={group ? row.expanded : undefined}
      data-drop={drop ?? undefined}
      data-comments={comments || undefined}
      onPointerDown={(event) => actions.press(row, event)}
      onContextMenu={(event) => {
        if (!group) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "F2" && !renaming) {
          event.preventDefault();
          actions.startRename(row);
        }
        const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
        if (group && !renaming && plain && event.key.toLowerCase() === "c") {
          event.preventDefault();
          event.stopPropagation();
          actions.comment(row);
        }
      }}
      className={cn(
        "absolute inset-x-0 grid grid-cols-[16px_10px_minmax(0,1fr)_minmax(0,max-content)_24px_24px_24px] items-center gap-1.5 rounded-md pr-1 text-body-sm text-fg-dim select-none",
        (selected || picked) && "bg-accent-soft text-fg",
        aimed && "ring-1 ring-accent ring-inset",
        (row.hiddenAbove || off) && "italic",
        drop === "into" && "bg-accent-soft ring-1 ring-accent",
        drop === "before" && "shadow-[inset_0_2px_0_var(--accent)]",
        drop === "after" && "shadow-[inset_0_-2px_0_var(--accent)]",
      )}
      style={{ top, height: treeRowPx, paddingLeft: row.depth * 14 + 4 }}
    >
      {group ? (
        <button
          type="button"
          aria-expanded={row.expanded}
          aria-label={row.expanded ? t`Collapse ${name}` : t`Expand ${name}`}
          onClick={() => actions.toggleOpen(row)}
          className="grid size-4 cursor-pointer place-items-center border-0 bg-transparent p-0 text-fg-faint"
        >
          <Icon name="caret" className={cn("transition-transform", row.expanded && "rotate-90")} />
        </button>
      ) : (
        <span />
      )}
      {saved ? (
        <label className="relative grid size-2.5 cursor-pointer place-items-center">
          <i
            aria-hidden="true"
            className="size-2.5 rounded-[3px]"
            style={{ background: row.colour }}
          />
          <input
            type="color"
            aria-label={t`Colour of ${name}`}
            value={row.kind === "group" ? row.hex : "#888888"}
            onChange={(event) => actions.colour(row, event.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      ) : (
        <i
          aria-hidden="true"
          className={cn("size-2.5", group ? "rounded-[3px]" : "rounded-full")}
          style={{ background: row.colour }}
        />
      )}
      {renaming ? (
        <input
          type="text"
          aria-label={t`Name of ${name}`}
          value={draft}
          maxLength={itemNameLimit}
          ref={chooseAll}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => actions.finishRename(row, draft)}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") actions.finishRename(row, draft);
            if (event.key === "Escape") actions.finishRename(row, null);
          }}
          className="min-w-0 rounded-sm border border-line bg-chrome px-1 text-body-sm text-fg"
        />
      ) : (
        <button
          type="button"
          data-testid="layers-row-name"
          aria-pressed={selected || picked}
          title={group ? t`Select the group and show it` : t`Select and show it`}
          onClick={(event) => actions.click(row, event)}
          onDoubleClick={() => actions.startRename(row)}
          className="flex min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-inherit"
        >
          {row.kind === "shape" ? <ObjectIdTag>{row.label}</ObjectIdTag> : null}
          {row.kind === "shape" && row.name === null ? null : (
            <span className="truncate">{name}</span>
          )}
        </button>
      )}
      <span className="flex min-w-0 items-center justify-end gap-1">
        {comments > 0 ? (
          <button
            type="button"
            data-testid="layers-row-comments"
            aria-label={plural(comments, { one: "# comment on it", other: "# comments on it" })}
            title={t`Open the comments on it`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => requestRowThread(row.key)}
            className="inline-flex h-6 min-w-6 shrink-0 cursor-pointer items-center justify-center gap-0.5 rounded-full border-0 bg-accent-soft px-1.5 font-mono text-caption text-accent"
          >
            <Icon name="comment" size="xs" />
            {comments}
          </button>
        ) : null}
        {group ? (
          <span className="font-mono text-caption text-fg-faint">{row.count}</span>
        ) : (
          <span
            data-testid="layers-row-measure"
            title={measure ?? undefined}
            className="truncate font-mono text-caption text-fg-dim"
          >
            {measure ?? ""}
          </span>
        )}
      </span>
      <button
        type="button"
        aria-pressed={!off}
        aria-label={off ? t`Show ${name}` : t`Hide ${name}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => actions.hide(row)}
        className={iconButton}
      >
        <Icon name={off ? "eye-off" : "eye"} />
      </button>
      <button
        type="button"
        aria-pressed={row.locked}
        aria-label={row.locked ? t`Unlock ${name}` : t`Lock ${name}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => actions.lock(row)}
        className={iconButton}
      >
        <Icon name={row.locked ? "lock" : "unlock"} />
      </button>
      {group ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={t`More actions for ${name}`}
                title={t`More`}
                onPointerDown={(event) => event.stopPropagation()}
                className={iconButton}
              >
                <Icon name="more" />
              </button>
            }
          />
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => actions.comment(row)}>
              <Trans>Comment on this layer</Trans>
            </DropdownMenuItem>
            {saved ? (
              <>
                <DropdownMenuItem onClick={() => actions.startRename(row)}>
                  <Trans>Rename</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.aim(row)}>
                  {aimed ? (
                    <Trans>Stop sending new shapes here</Trans>
                  ) : (
                    <Trans>New shapes go here</Trans>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.ungroup(row)}>
                  <Trans>Ungroup</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.remove(row)}>
                  <Trans>Delete group</Trans>
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span />
      )}
    </li>
  );
});

export function LayersTree({
  document: doc,
  context,
  onApply,
  selected,
  onPick,
  storageKey,
  target,
  onTarget,
}: LayersTreeProps) {
  const { t } = useLingui();
  const codes = useSavedCodes();
  const micronsPerPixel = useStageMicronsPerPixel();
  const units = useLengthUnits();
  const measureOf = (row: TreeRow): string | null => {
    if (row.kind !== "shape") return null;
    const shape = doc.shapes.get(row.shapeId);
    const found = shape === undefined ? null : measureShape(shape, micronsPerPixel);
    return found === null ? null : `${formatArea(found, units)} · ${formatPerimeter(found, units)}`;
  };
  const [open, setOpen] = useState<ReadonlySet<string>>(() => readOpen(storageKey));
  const [anchor, setAnchor] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const pending = useRef<Pending | null>(null);
  const justDragged = useRef(false);
  const scrollTo = useRef<string | null>(null);
  const knownGroups = useRef(doc.nextGroupId);

  useEffect(() => setOpen(readOpen(storageKey)), [storageKey]);

  const changeOpen = useCallback(
    (edit: (current: Set<string>) => void) => {
      setOpen((current) => {
        const next = new Set(current);
        edit(next);
        writeOpen(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const ids = useMemo(() => drawnObjectIds(doc, codes), [doc, codes]);
  const labelOf = useCallback(
    (shape: Shape) => ids.get(shape.id)?.shown ?? shape.text ?? kindWords[shape.kind],
    [ids],
  );
  const tree = useMemo(() => treeRows(doc, context, open, labelOf), [doc, context, open, labelOf]);
  const { rows } = tree;
  const chosen = useMemo(() => new Set(selected), [selected]);
  const commentCounts = useThreadCounts();
  useEffect(() => {
    const groups = [...doc.groups.values()].map((group) => ({
      key: groupKey(group.id),
      name: group.name,
    }));
    const classes = rows.flatMap((row) =>
      row.kind === "group" && row.groupId === null ? [{ key: row.key, name: row.name }] : [],
    );
    publishLayerNames([...groups, ...classes]);
  }, [doc.groups, rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => treeRowPx,
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 8,
  });

  const only = selected.length === 1 ? selected[0] : undefined;
  useEffect(() => {
    if (only === undefined) return;
    setPicked(null);
    const keys = openKeysFor(doc, only);
    scrollTo.current = shapeKey(only);
    if (keys.every((key) => open.has(key))) return;
    changeOpen((next) => {
      for (const key of keys) next.add(key);
    });
  }, [only, doc, open, changeOpen]);

  useEffect(() => {
    const wanted = scrollTo.current;
    if (wanted === null) return;
    const index = rows.findIndex((row) => row.key === wanted);
    if (index < 0) return;
    scrollTo.current = null;
    virtualizer.scrollToIndex(index, { align: "auto" });
  }, [rows, virtualizer]);

  useEffect(() => {
    const from = knownGroups.current;
    knownGroups.current = doc.nextGroupId;
    if (doc.nextGroupId <= from || selected.length === 0) return;
    const fresh: string[] = [];
    for (let id = from; id < doc.nextGroupId; id++) {
      if (!doc.groups.has(id)) continue;
      if (selected.some((shape) => doc.shapes.get(shape)?.groupId === id)) {
        fresh.push(groupKey(id));
      }
    }
    if (fresh.length === 0) return;
    changeOpen((next) => {
      for (const key of fresh) next.add(key);
    });
  }, [doc, selected, changeOpen]);

  const latest = useRef({ doc, rows, chosen, context, onApply, onPick, anchor, target, onTarget });
  latest.current = { doc, rows, chosen, context, onApply, onPick, anchor, target, onTarget };

  const onClassGroup = useCallback(
    (row: TreeRow, edit: (next: AnnotationDocument, id: GroupId) => AnnotationDocument) => {
      const { doc: current, context: here } = latest.current;
      if (row.kind !== "group") return null;
      if (row.groupId !== null) return edit(current, row.groupId);
      const made = materialiseClass(current, row.classKey, here);
      if (made === null) return null;
      return edit(made.document, made.groupId);
    },
    [],
  );

  const dropAt = useCallback((clientX: number, clientY: number): DropTarget | null => {
    const node = list.current;
    if (node === null) return null;
    const box = node.getBoundingClientRect();
    if (clientX < box.left || clientX > box.right) return null;
    const offset = clientY - box.top;
    const index = Math.floor(offset / treeRowPx);
    const row = latest.current.rows[Math.max(0, Math.min(index, latest.current.rows.length - 1))];
    if (row === undefined) return null;
    if (offset < 0) return { key: row.key, place: "before" };
    if (index >= latest.current.rows.length) return { key: row.key, place: "after" };
    const within = (offset - index * treeRowPx) / treeRowPx;
    if (row.kind === "group") {
      if (within < 0.25) return { key: row.key, place: "before" };
      if (within > 0.75) return { key: row.key, place: "after" };
      return { key: row.key, place: "into" };
    }
    return { key: row.key, place: within < 0.5 ? "before" : "after" };
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = pending.current;
      if (drag === null) return;
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < dragThresholdPx) return;
        drag.active = true;
      }
      const box = scroller.current?.getBoundingClientRect();
      if (box && scroller.current) {
        if (event.clientY < box.top + edgeScrollPx) scroller.current.scrollTop -= treeRowPx / 2;
        if (event.clientY > box.bottom - edgeScrollPx) scroller.current.scrollTop += treeRowPx / 2;
      }
      setDrop(dropAt(event.clientX, event.clientY));
    };
    const up = (event: PointerEvent) => {
      const drag = pending.current;
      pending.current = null;
      if (drag === null || !drag.active) return;
      justDragged.current = true;
      window.setTimeout(() => {
        justDragged.current = false;
      }, 0);
      setDrop(null);
      const place = dropAt(event.clientX, event.clientY);
      if (place === null) return;
      const { doc: current, context: here, onApply: apply } = latest.current;
      const next = dropRows(current, drag.keys, place, here);
      if (next !== current) apply(next, "Move in layers");
    };
    const cancel = () => {
      pending.current = null;
      setDrop(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [dropAt]);

  const actions = useMemo<Actions>(
    () => ({
      click: (row, event) => {
        if (justDragged.current) return;
        const {
          doc: current,
          rows: shown,
          chosen: now,
          anchor: from,
          onPick: pick,
        } = latest.current;
        if (row.kind === "group") {
          const members = membersOf(current, row.key);
          setPicked(row.key);
          setAnchor(null);
          pick(members.length <= groupPickLimit ? members : [], unionBounds(current, members));
          return;
        }
        setPicked(null);
        if (event.shiftKey && from !== null) {
          pick(rangeOf(shown, from, row.key), null);
          return;
        }
        setAnchor(row.key);
        if (event.metaKey || event.ctrlKey) {
          const next = now.has(row.shapeId)
            ? [...now].filter((id) => id !== row.shapeId)
            : [...now, row.shapeId];
          pick(next, null);
          return;
        }
        pick([row.shapeId], unionBounds(current, [row.shapeId]));
      },
      toggleOpen: (row) =>
        changeOpen((next) => {
          if (next.has(row.key)) next.delete(row.key);
          else next.add(row.key);
        }),
      hide: (row) => {
        const { doc: current, onApply: apply } = latest.current;
        if (row.kind === "shape") {
          apply(toggleShapeHidden(current, row.shapeId), "Show or hide object");
          return;
        }
        const next = onClassGroup(row, (base, id) => toggleHidden(base, id));
        if (next !== null) apply(next, "Show or hide layer");
      },
      lock: (row) => {
        const { doc: current, onApply: apply } = latest.current;
        if (row.kind === "shape") {
          apply(toggleShapeLocked(current, row.shapeId), "Lock or unlock object");
          return;
        }
        const next = onClassGroup(row, (base, id) => toggleLocked(base, id));
        if (next !== null) apply(next, "Lock or unlock layer");
      },
      startRename: (row) => setRenaming(row.key),
      finishRename: (row, name) => {
        setRenaming(null);
        if (name === null) return;
        const { doc: current, onApply: apply } = latest.current;
        if (row.kind === "shape") {
          const next = renameShape(current, row.shapeId, name);
          if (next !== current) apply(next, "Rename object");
          return;
        }
        if (name.trim() === "" || name.trim() === row.name) return;
        const next = onClassGroup(row, (base, id) => renameGroup(base, id, name));
        if (next !== null) apply(next, "Rename layer");
      },
      colour: (row, hex) => {
        const color = rgbOfHex(hex);
        const { doc: current, onApply: apply } = latest.current;
        if (color === null || row.kind !== "group" || row.groupId === null) return;
        apply(updateGroup(current, row.groupId, { color }).document, "Layer colour");
      },
      ungroup: (row) => {
        const { doc: current, onApply: apply } = latest.current;
        if (row.kind === "group" && row.groupId !== null) {
          apply(removeGroup(current, row.groupId), "Ungroup layer");
        }
      },
      remove: (row) => {
        const { doc: current, onApply: apply } = latest.current;
        if (row.kind === "group" && row.groupId !== null) {
          apply(deleteGroupWithShapes(current, row.groupId), "Delete layer and its shapes");
        }
      },
      aim: (row) => {
        const { target: aimedAt, onTarget: aim } = latest.current;
        if (row.kind !== "group" || row.groupId === null) return;
        aim(row.groupId === aimedAt ? null : row.groupId);
      },
      press: (row, event) => {
        if (event.button !== 0) return;
        const { chosen: now } = latest.current;
        const keys =
          row.kind === "shape" && now.has(row.shapeId)
            ? [...now].map((id) => shapeKey(id))
            : [row.key];
        pending.current = { keys, x: event.clientX, y: event.clientY, active: false };
      },
      comment: (row) => {
        if (row.kind === "group") window.setTimeout(() => requestLayerComment(row.key), 0);
      },
    }),
    [changeOpen, onClassGroup],
  );

  if (rows.length === 0) {
    return (
      <p className="m-0 text-body-sm text-fg-dim">
        <Trans>Nothing drawn yet. Select shapes and press ⌘G to group them.</Trans>
      </p>
    );
  }

  const items = virtualizer.getVirtualItems();
  const height = Math.min(rows.length * treeRowPx, treeHeightPx);
  return (
    <div className="grid gap-1">
      <div
        ref={scroller}
        data-testid="layers-tree"
        data-rows={rows.length}
        className="overflow-y-auto overscroll-contain"
        style={{ height }}
      >
        <ul
          ref={list}
          aria-label={t`Layers`}
          className="relative m-0 list-none p-0"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {items.map((item) => {
            const row = rows[item.index];
            if (row === undefined) return null;
            const parsed = parseKey(row.key);
            return (
              <Row
                key={row.key}
                row={row}
                top={item.start}
                selected={row.kind === "shape" && chosen.has(row.shapeId)}
                picked={row.key === picked}
                aimed={parsed?.kind === "group" && parsed.id === target}
                renaming={row.key === renaming}
                drop={drop?.key === row.key ? drop.place : null}
                measure={measureOf(row)}
                comments={commentCounts.get(row.key) ?? 0}
                actions={actions}
              />
            );
          })}
        </ul>
      </div>
      {tree.hiddenObjects > 0 ? (
        <p data-testid="layers-hidden-count" className="m-0 text-caption text-fg-dim">
          {plural(tree.hiddenObjects, {
            one: "# object in hidden layers",
            other: "# objects in hidden layers",
          })}
        </p>
      ) : null}
    </div>
  );
}
