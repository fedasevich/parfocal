import { HttpResponse, http, type RequestHandler } from "msw";
import type {
  PaintedMap,
  PaintedMapContent,
  PaintedMapDraft,
  PaintedMapSave,
  PaintedMapVersion,
} from "../generated/api.ts";

const storageKey = "parfocal.fake.painted-maps";
const magic = "PFPM";
const headerBytes = 24;
const tileHeaderBytes = 4;
const mediaType = "application/vnd.parfocal.painted-map";

interface StoredVersion extends PaintedMapVersion {
  content: string;
}

interface StoredMap {
  map: PaintedMap;
  versions: StoredVersion[];
}

type Store = Record<string, StoredMap[]>;

interface ReadFile {
  cell: number;
  tileCells: number;
  painted: number;
}

let memory: Store = {};

function session(): Storage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

function readStore(): Store {
  const stored = session()?.getItem(storageKey);
  if (stored === null || stored === undefined) return memory;
  return JSON.parse(stored) as Store;
}

function writeStore(store: Store): void {
  memory = store;
  session()?.setItem(storageKey, JSON.stringify(store));
}

export function resetFakePaintedMaps(): void {
  memory = {};
  session()?.removeItem(storageKey);
}

const bytesOf = (content: string): Uint8Array =>
  Uint8Array.from(atob(content), (character) => character.charCodeAt(0));

function readFile(content: string): ReadFile | null {
  let bytes: Uint8Array;
  try {
    bytes = bytesOf(content);
  } catch {
    return null;
  }
  if (bytes.length < headerBytes) return null;
  if (String.fromCharCode(...bytes.subarray(0, magic.length)) !== magic) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tileCells = view.getUint16(6, true);
  const cell = view.getUint32(8, true);
  const width = view.getUint32(12, true);
  const height = view.getUint32(16, true);
  const count = view.getUint32(20, true);
  if (tileCells === 0 || cell === 0 || width === 0 || height === 0) return null;
  const columns = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(height / cell));
  let offset = headerBytes;
  let painted = 0;
  for (let index = 0; index < count; index++) {
    if (offset + tileHeaderBytes > bytes.length) return null;
    const column = view.getUint16(offset, true);
    const row = view.getUint16(offset + 2, true);
    const tileWidth = Math.min(tileCells, columns - column * tileCells);
    const tileHeight = Math.min(tileCells, rows - row * tileCells);
    if (tileWidth <= 0 || tileHeight <= 0) return null;
    const start = offset + tileHeaderBytes;
    const end = start + tileWidth * tileHeight;
    if (end > bytes.length) return null;
    for (let at = start; at < end; at++) if (bytes[at] !== 0) painted++;
    offset = end;
  }
  if (offset !== bytes.length) return null;
  return { cell, tileCells, painted };
}

const problem = (status: number, code: string, title: string) =>
  HttpResponse.json(
    { type: `https://parfocal.eu/problems/${code}`, title, status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const fileProblem = () => problem(400, "painted-map-file", "The painted map file cannot be read");

const notFound = () => problem(404, "not-found", "Painted map not found");

const summary = ({ content: _content, ...version }: StoredVersion): PaintedMapVersion => version;

export const paintedMapHandlers = (): RequestHandler[] => [
  http.get<{ slideId: string }>("*/api/slides/:slideId/painted-maps", ({ params }) =>
    HttpResponse.json((readStore()[params.slideId] ?? []).map((stored) => stored.map)),
  ),
  http.post<{ slideId: string }>(
    "*/api/slides/:slideId/painted-maps",
    async ({ params, request }) => {
      const draft = (await request.json()) as PaintedMapDraft;
      const file = readFile(draft.content);
      if (file === null) return fileProblem();
      const store = readStore();
      const now = new Date().toISOString();
      const map: PaintedMap = {
        id: crypto.randomUUID(),
        slide_id: params.slideId,
        name: draft.name.trim(),
        version: 1,
        cell: file.cell,
        tile_cells: file.tileCells,
        painted_cells: file.painted,
        created_by_user_id: null,
        created_at: now,
        updated_at: now,
      };
      const version: StoredVersion = {
        version: 1,
        painted_cells: file.painted,
        saved_by_user_id: null,
        saved_at: now,
        content: draft.content,
      };
      writeStore({
        ...store,
        [params.slideId]: [...(store[params.slideId] ?? []), { map, versions: [version] }],
      });
      return HttpResponse.json(map, { status: 201 });
    },
  ),
  http.put<{ slideId: string; mapId: string }>(
    "*/api/slides/:slideId/painted-maps/:mapId",
    async ({ params, request }) => {
      const save = (await request.json()) as PaintedMapSave;
      const store = readStore();
      const existing = store[params.slideId] ?? [];
      const found = existing.find((stored) => stored.map.id === params.mapId);
      if (found === undefined) return notFound();
      const file = readFile(save.content);
      if (file === null) return fileProblem();
      if (file.cell !== found.map.cell || file.tileCells !== found.map.tile_cells) {
        return problem(
          409,
          "painted-map-grid-changed",
          "A painted map keeps its cell size, save a new map instead",
        );
      }
      if (save.version !== found.map.version) {
        return problem(409, "painted-map-changed", "This painted map changed since you loaded it");
      }
      const now = new Date().toISOString();
      const map: PaintedMap = {
        ...found.map,
        name: save.name?.trim() ?? found.map.name,
        version: found.map.version + 1,
        painted_cells: file.painted,
        updated_at: now,
      };
      const version: StoredVersion = {
        version: map.version,
        painted_cells: file.painted,
        saved_by_user_id: null,
        saved_at: now,
        content: save.content,
      };
      writeStore({
        ...store,
        [params.slideId]: existing.map((stored) =>
          stored === found ? { map, versions: [...stored.versions, version] } : stored,
        ),
      });
      return HttpResponse.json(map);
    },
  ),
  http.get<{ slideId: string; mapId: string }>(
    "*/api/slides/:slideId/painted-maps/:mapId/versions",
    ({ params }) => {
      const found = (readStore()[params.slideId] ?? []).find(
        (stored) => stored.map.id === params.mapId,
      );
      return found === undefined ? notFound() : HttpResponse.json(found.versions.map(summary));
    },
  ),
  http.get<{ slideId: string; mapId: string; version: string }>(
    "*/api/slides/:slideId/painted-maps/:mapId/versions/:version",
    ({ params }) => {
      const found = (readStore()[params.slideId] ?? []).find(
        (stored) => stored.map.id === params.mapId,
      );
      const version = found?.versions.find((item) => item.version === Number(params.version));
      if (found === undefined || version === undefined) return notFound();
      const body: PaintedMapContent = { ...version, painted_map_id: found.map.id };
      return HttpResponse.json(body);
    },
  ),
  http.get<{ slideId: string; mapId: string; version: string }>(
    "*/api/slides/:slideId/painted-maps/:mapId/versions/:version/file",
    ({ params }) => {
      const found = (readStore()[params.slideId] ?? []).find(
        (stored) => stored.map.id === params.mapId,
      );
      const version = found?.versions.find((item) => item.version === Number(params.version));
      if (found === undefined || version === undefined) return notFound();
      return new HttpResponse(bytesOf(version.content), {
        headers: {
          "content-type": mediaType,
          "content-disposition": `attachment; filename="painted-map-${found.map.id}-v${version.version}.pfmap"`,
        },
      });
    },
  ),
];
