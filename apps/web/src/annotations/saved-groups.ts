import type { LayerGroups } from "@parfocal/api-client";
import type { AnnotationDocument, Group } from "./document.ts";
import type { GroupId, ShapeId } from "./shapes.ts";

export type SavedRemotes = ReadonlyMap<ShapeId, { readonly id: string | null }>;

const colourOf = (color: Group["color"]): number[] | null => (color === null ? null : [...color]);

const triple = (channels: readonly number[] | null | undefined): Group["color"] =>
  channels !== null && channels !== undefined && channels.length === 3
    ? [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0]
    : null;

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
    }));
  const members: LayerGroups["members"] = [];
  for (const shape of doc.shapes.values()) {
    const remote = remotes.get(shape.id)?.id;
    if (shape.groupId !== null && doc.groups.has(shape.groupId) && remote) {
      members.push({ annotation_id: remote, group_id: shape.groupId });
    }
  }
  members.sort((a, b) => a.annotation_id.localeCompare(b.annotation_id));
  return { groups, members };
}

export function withSavedGroups(
  doc: AnnotationDocument,
  saved: LayerGroups,
  remotes: SavedRemotes,
): AnnotationDocument {
  const entries = saved.groups ?? [];
  if (entries.length === 0) return doc;
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
  return { ...doc, groups, shapes, nextGroupId };
}
