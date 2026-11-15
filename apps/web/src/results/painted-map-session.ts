import {
  ApiError,
  createPaintedMap,
  getExportPaintedMapUrl,
  getPaintedMapVersion,
  listPaintedMaps,
  listPaintedMapVersions,
  type PaintedMap,
  type PaintedMapVersion,
  savePaintedMap,
} from "@parfocal/api-client";
import {
  createViewMap,
  decodePaintedMap,
  encodePaintedMap,
  type HeatmapGrid,
  type PaintedMapStroke,
  paintedCellCount,
  paintViewMap,
  type ViewMap,
  viewMapGrid,
  viewMapLayout,
} from "@parfocal/viewer-engine";

export type PaintedMapPhase = "idle" | "working" | "changed" | "failed";

export interface PaintedMapState {
  readonly phase: PaintedMapPhase;
  readonly map: ViewMap;
  readonly grid: HeatmapGrid | null;
  readonly painted: number;
  readonly current: PaintedMap | null;
  readonly opened: number | null;
  readonly dirty: boolean;
  readonly maps: readonly PaintedMap[];
  readonly versions: readonly PaintedMapVersion[];
}

export interface PaintedMapStore {
  readonly list: () => Promise<PaintedMap[]>;
  readonly create: (name: string, content: Uint8Array) => Promise<PaintedMap>;
  readonly save: (
    id: string,
    version: number,
    content: Uint8Array,
    name?: string,
  ) => Promise<PaintedMap>;
  readonly versions: (id: string) => Promise<PaintedMapVersion[]>;
  readonly read: (id: string, version: number) => Promise<Uint8Array>;
  readonly exportFile: (id: string, version: number) => Promise<Uint8Array>;
}

export interface PaintedMapExport {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export interface PaintedMapSession {
  readonly getState: () => PaintedMapState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly paint: (stroke: PaintedMapStroke) => void;
  readonly refresh: () => Promise<void>;
  readonly save: (name: string) => Promise<void>;
  readonly saveAsNew: (name: string) => Promise<void>;
  readonly open: (id: string, version?: number) => Promise<void>;
  readonly startNew: () => void;
  readonly exportFile: () => Promise<PaintedMapExport | null>;
}

export interface PaintedMapSessionOptions {
  readonly slide: { readonly width: number; readonly height: number };
  readonly store: PaintedMapStore;
  readonly cell?: number;
}

const toBase64 = (bytes: Uint8Array): string => {
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(text);
};

function dataOf<Response extends { status: number; data: unknown }>(
  response: Response,
): Extract<Response, { status: 200 | 201 }>["data"] {
  if (response.status !== 200 && response.status !== 201) {
    throw new Error("The painted map request did not succeed");
  }
  return response.data;
}

const fromBase64 = (content: string): Uint8Array =>
  Uint8Array.from(atob(content), (character) => character.charCodeAt(0));

const isChanged = (error: unknown): boolean =>
  error instanceof ApiError && error.problem?.code === "painted-map-changed";

export function paintedMapStoreFor(slideId: string): PaintedMapStore {
  return {
    list: async () => dataOf(await listPaintedMaps(slideId)),
    create: async (name, content) =>
      dataOf(await createPaintedMap(slideId, { name, content: toBase64(content) })),
    save: async (id, version, content, name) =>
      dataOf(
        await savePaintedMap(slideId, id, {
          version,
          content: toBase64(content),
          ...(name === undefined ? {} : { name }),
        }),
      ),
    versions: async (id) => dataOf(await listPaintedMapVersions(slideId, id)),
    read: async (id, version) =>
      fromBase64(dataOf(await getPaintedMapVersion(slideId, id, version)).content),
    exportFile: async (id, version) => {
      const response = await fetch(getExportPaintedMapUrl(slideId, id, version), {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("The painted map file could not be downloaded");
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

export function createPaintedMapSession(options: PaintedMapSessionOptions): PaintedMapSession {
  const { store } = options;
  const layout = viewMapLayout(options.slide, options.cell);
  const listeners = new Set<() => void>();
  const blank = createViewMap(layout);
  let state: PaintedMapState = {
    phase: "idle",
    map: blank,
    grid: null,
    painted: 0,
    current: null,
    opened: null,
    dirty: false,
    maps: [],
    versions: [],
  };
  const set = (next: Partial<PaintedMapState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const withMap = (map: ViewMap): Partial<PaintedMapState> => ({
    map,
    grid: viewMapGrid(map),
    painted: paintedCellCount(map),
  });
  const guarded = async (work: () => Promise<void>) => {
    if (state.phase === "working") return;
    set({ phase: "working" });
    try {
      await work();
    } catch (error) {
      set({ phase: isChanged(error) ? "changed" : "failed" });
    }
  };
  const settleSaved = async (saved: PaintedMap) => {
    const [maps, versions] = await Promise.all([store.list(), store.versions(saved.id)]);
    set({
      phase: "idle",
      current: saved,
      opened: saved.version,
      dirty: false,
      maps,
      versions,
    });
  };
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    paint: (stroke) => {
      const next = paintViewMap(state.map, stroke);
      if (next === state.map) return;
      set({ ...withMap(next), dirty: true });
    },
    refresh: () =>
      guarded(async () => {
        set({ phase: "idle", maps: await store.list() });
      }),
    save: (name) =>
      guarded(async () => {
        const content = encodePaintedMap(state.map);
        const current = state.current;
        const saved =
          current === null
            ? await store.create(name, content)
            : await store.save(current.id, current.version, content, name);
        await settleSaved(saved);
      }),
    saveAsNew: (name) =>
      guarded(async () => {
        await settleSaved(await store.create(name, encodePaintedMap(state.map)));
      }),
    open: (id, version) =>
      guarded(async () => {
        const maps = await store.list();
        const found = maps.find((item) => item.id === id);
        if (found === undefined) throw new Error("There is no such painted map");
        const target = version ?? found.version;
        const [bytes, versions] = await Promise.all([store.read(id, target), store.versions(id)]);
        set({
          phase: "idle",
          ...withMap(decodePaintedMap(bytes)),
          current: found,
          opened: target,
          dirty: false,
          maps,
          versions,
        });
      }),
    startNew: () => {
      set({
        phase: "idle",
        ...withMap(blank),
        current: null,
        opened: null,
        dirty: false,
        versions: [],
      });
    },
    exportFile: async () => {
      const { current, opened } = state;
      if (current === null || opened === null) return null;
      try {
        const bytes = await store.exportFile(current.id, opened);
        return { fileName: `${current.name}-v${opened}.pfmap`, bytes };
      } catch {
        set({ phase: "failed" });
        return null;
      }
    },
  };
}
