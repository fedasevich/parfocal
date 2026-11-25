import {
  getLayerGroups,
  getSharedLayerGroups,
  type LayerGroups,
  setLayerGroups,
  setSharedLayerGroups,
} from "@parfocal/api-client";
import type { AnnotationDocument, Group, LayerItem } from "./document.ts";
import type { GroupId, ShapeId } from "./shapes.ts";

export type SavedRemotes = ReadonlyMap<ShapeId, { readonly id: string | null }>;

const colourOf = (color: Group["color"]): number[] | null => (color === null ? null : [...color]);

const triple = (channels: readonly number[] | null | undefined): Group["color"] =>
  channels !== null && channels !== undefined && channels.length === 3
    ? [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0]
    : null;

export const readLayerGroups = (slideId: string, taskId: string | null) =>
  taskId === null ? getLayerGroups(slideId) : getSharedLayerGroups(taskId, slideId);

export const writeLayerGroups = (slideId: string, taskId: string | null, body: LayerGroups) =>
  taskId === null ? setLayerGroups(slideId, body) : setSharedLayerGroups(taskId, slideId, body);

export function layerGroupsOf(doc: AnnotationDocument, remotes: SavedRemotes): LayerGroups {
  const groups = [...doc.groups.values()]
    .sort((a, b) => a.id - b.id)
    .map((group) => ({
      id: group.id,
      name: group.name,
      parent_id: group.parentId,
      color: colourOf(group.color),
      hidden: group.hidden,
      locked: group.locked,
      rank: group.rank ?? null,
    }));
  const members: LayerGroups["members"] = [];
  for (const shape of doc.shapes.values()) {
    const remote = remotes.get(shape.id)?.id;
    if (shape.groupId !== null && doc.groups.has(shape.groupId) && remote) {
      members.push({ annotation_id: remote, group_id: shape.groupId });
    }
  }
  members.sort((a, b) => a.annotation_id.localeCompare(b.annotation_id));
  const items: NonNullable<LayerGroups["items"]> = [];
  for (const [shapeId, item] of doc.items ?? []) {
    const remote = remotes.get(shapeId)?.id;
    if (!remote || !doc.shapes.has(shapeId) || isPlain(item)) continue;
    items.push({
      annotation_id: remote,
      name: item.name,
      hidden: item.hidden,
      locked: item.locked,
      rank: item.rank,
    });
  }
  items.sort((a, b) => a.annotation_id.localeCompare(b.annotation_id));
  return { groups, members, items };
}

const isPlain = (item: LayerItem): boolean =>
  item.name === null && !item.hidden && !item.locked && item.rank === null;

function savedItems(
  saved: LayerGroups,
  remotes: SavedRemotes,
): ReadonlyMap<number, LayerItem> | undefined {
  const entries = saved.items ?? [];
  if (entries.length === 0) return undefined;
  const byRemote = new Map(entries.map((item) => [item.annotation_id, item]));
  const items = new Map<number, LayerItem>();
  for (const [shapeId, remote] of remotes) {
    const found = remote.id === null ? undefined : byRemote.get(remote.id);
    if (found === undefined) continue;
    items.set(shapeId, {
      name: found.name ?? null,
      hidden: found.hidden ?? false,
      locked: found.locked ?? false,
      rank: found.rank ?? null,
    });
  }
  return items.size === 0 ? undefined : items;
}

export function withSavedGroups(
  doc: AnnotationDocument,
  saved: LayerGroups,
  remotes: SavedRemotes,
): AnnotationDocument {
  const entries = saved.groups ?? [];
  const items = savedItems(saved, remotes);
  const withItems = items === undefined ? doc : { ...doc, items };
  if (entries.length === 0) return withItems;
  const known = new Set(entries.map((group) => group.id));
  const groups = new Map<GroupId, Group>();
  for (const group of entries) {
    groups.set(group.id, {
      id: group.id,
      name: group.name,
      parentId:
        group.parent_id !== null && known.has(group.parent_id ?? -1)
          ? (group.parent_id ?? null)
          : null,
      color: triple(group.color),
      hidden: group.hidden ?? false,
      locked: group.locked ?? false,
      ...(group.rank === null || group.rank === undefined ? {} : { rank: group.rank }),
    });
  }
  const home = new Map<string, GroupId>();
  for (const member of saved.members ?? []) home.set(member.annotation_id, member.group_id);
  const shapes = new Map(doc.shapes);
  for (const [shapeId, remote] of remotes) {
    const shape = shapes.get(shapeId);
    const target = remote.id === null ? undefined : home.get(remote.id);
    if (shape && target !== undefined && groups.has(target)) {
      shapes.set(shapeId, { ...shape, groupId: target });
    }
  }
  const nextGroupId = Math.max(doc.nextGroupId, ...entries.map((group) => group.id + 1));
  return { ...withItems, groups, shapes, nextGroupId };
}
