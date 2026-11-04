export type DropKind = "slide" | "result" | "other";

export type DropRecord = { path: string; size: number };

export type DroppedItem = DropRecord & { file: File };

export type PairMode = "auto" | "name" | "id";

export type PairResult = { slide: number | null; how: string };

const slideExtensions = new Set([
  "svs",
  "ndpi",
  "scn",
  "mrxs",
  "vms",
  "vmu",
  "bif",
  "tif",
  "tiff",
  "czi",
  "vsi",
  "qptiff",
  "isyntax",
  "dcm",
]);

const resultExtensions = new Set([
  "geojson",
  "json",
  "csv",
  "tsv",
  "png",
  "jpg",
  "jpeg",
  "parquet",
  "npy",
  "npz",
]);

export const extensionOf = (path: string) => {
  const name = nameOf(path);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
};

export const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export const stemOf = (path: string) => {
  const name = nameOf(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
};

export const dirOf = (path: string) => {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
};

export function kindOf(path: string): DropKind {
  const extension = extensionOf(path);
  if (slideExtensions.has(extension)) return "slide";
  if (resultExtensions.has(extension)) return "result";
  return "other";
}

const sameStem = (resultStem: string, slideStem: string) => {
  const result = resultStem.toLowerCase();
  const slide = slideStem.toLowerCase();
  if (result === slide) return true;
  if (!result.startsWith(slide)) return false;
  return /[^a-z0-9]/.test(result.charAt(slide.length));
};

function longestMatch(candidates: number[], slides: DropRecord[]) {
  let best: number | null = null;
  for (const index of candidates) {
    const slide = slides[index];
    if (slide === undefined) continue;
    const current = best === null ? undefined : slides[best];
    if (current === undefined || stemOf(slide.path).length > stemOf(current.path).length) {
      best = index;
    }
  }
  return best;
}

export function pairResult(result: DropRecord, slides: DropRecord[], mode: PairMode): PairResult {
  if (mode === "id") return { slide: null, how: "No slide ID could be read from this file" };
  const all = slides.map((_, index) => index);
  const stem = stemOf(result.path);
  const dir = dirOf(result.path);
  if (mode === "auto") {
    const beside = longestMatch(
      all.filter((index) => {
        const slide = slides[index];
        return (
          slide !== undefined && dirOf(slide.path) === dir && sameStem(stem, stemOf(slide.path))
        );
      }),
      slides,
    );
    if (beside !== null) return { slide: beside, how: "Same folder, same name" };
    const folder = nameOf(dir).toLowerCase();
    const parent = dirOf(dir);
    const inFolder = all.filter((index) => {
      const slide = slides[index];
      return (
        slide !== undefined &&
        folder !== "" &&
        dirOf(slide.path) === parent &&
        stemOf(slide.path).toLowerCase() === folder
      );
    });
    if (inFolder[0] !== undefined)
      return { slide: inFolder[0], how: "In a folder named like the slide" };
  }
  const named = longestMatch(
    all.filter((index) => {
      const slide = slides[index];
      return slide !== undefined && sameStem(stem, stemOf(slide.path));
    }),
    slides,
  );
  if (named !== null) return { slide: named, how: "Same name, other folder" };
  return { slide: null, how: "No slide with this name" };
}

export type DropBatch = {
  slides: DropRecord[];
  results: DropRecord[];
  others: DropRecord[];
  caseOf: (string | null)[];
};

export function sortDrop<T extends DropRecord>(items: T[]) {
  const slides = items.filter((item) => kindOf(item.path) === "slide");
  const results = items.filter((item) => kindOf(item.path) === "result");
  const others = items.filter((item) => kindOf(item.path) === "other");
  const root = commonRoot(items.map((item) => item.path));
  const slideDirs = new Set(slides.map((slide) => dirOf(slide.path)));
  const deeper = [...slideDirs].some((dir) => dir !== "" && dir !== root);
  const caseOf = slides.map((slide) => {
    const dir = dirOf(slide.path);
    if (dir === "") return null;
    if (dir === root && deeper) return null;
    return nameOf(dir);
  });
  return { slides, results, others, caseOf };
}

function commonRoot(paths: string[]) {
  const first = paths[0]?.split("/")[0];
  if (first === undefined || first === "") return "";
  return paths.every((path) => path.includes("/") && path.split("/")[0] === first) ? first : "";
}

export function totalBytes(records: DropRecord[]) {
  return records.reduce((sum, record) => sum + record.size, 0);
}

type EntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (done: (file: File) => void, fail?: (error: unknown) => void) => void;
  createReader?: () => {
    readEntries: (done: (entries: EntryLike[]) => void, fail?: (error: unknown) => void) => void;
  };
};

async function readAll(entry: EntryLike) {
  const reader = entry.createReader?.();
  const found: EntryLike[] = [];
  if (reader === undefined) return found;
  for (;;) {
    const page = await new Promise<EntryLike[]>((done, fail) => reader.readEntries(done, fail));
    if (page.length === 0) return found;
    found.push(...page);
  }
}

async function walk(entry: EntryLike, base: string, into: DroppedItem[]): Promise<void> {
  const path = base === "" ? entry.name : `${base}/${entry.name}`;
  if (entry.isFile && entry.file) {
    const read = entry.file;
    const file = await new Promise<File>((done, fail) => read.call(entry, done, fail));
    into.push({ path, size: file.size, file });
    return;
  }
  if (entry.isDirectory) {
    for (const child of await readAll(entry)) await walk(child, path, into);
  }
}

export async function readDropped(transfer: DataTransfer): Promise<DroppedItem[]> {
  const items: DroppedItem[] = [];
  const entries: EntryLike[] = [];
  const loose: File[] = [];
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== "file") continue;
    const getter = (item as DataTransferItem & { webkitGetAsEntry?: () => EntryLike | null })
      .webkitGetAsEntry;
    const entry = getter ? getter.call(item) : null;
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) loose.push(file);
    }
  }
  if (entries.length === 0 && loose.length === 0) loose.push(...Array.from(transfer.files));
  for (const entry of entries) await walk(entry, "", items);
  for (const file of loose) items.push(fromFile(file));
  return items;
}

export function fromFile(file: File): DroppedItem {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  const path = relative ? relative : file.name;
  return { path, size: file.size, file };
}

export function fromFileList(files: FileList | null): DroppedItem[] {
  return files ? Array.from(files).map(fromFile) : [];
}
