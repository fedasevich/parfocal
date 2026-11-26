export const resultSuffixes = [
  ".geojson",
  ".json",
  ".csv",
  ".tsv",
  ".png",
  ".tif",
  ".tiff",
] as const;

export type ResultSuffix = (typeof resultSuffixes)[number];

export type ResultFileKind = "shapes" | "table" | "image" | "raster";

export const resultAccept = resultSuffixes.join(",");

const kinds: Record<ResultSuffix, ResultFileKind> = {
  ".geojson": "shapes",
  ".json": "shapes",
  ".csv": "table",
  ".tsv": "table",
  ".png": "image",
  ".tif": "raster",
  ".tiff": "raster",
};

export const suffixOf = (name: string) => {
  const base = name.slice(name.replaceAll("\\", "/").lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
};

const isResultSuffix = (suffix: string): suffix is ResultSuffix =>
  (resultSuffixes as readonly string[]).includes(suffix);

export const resultFileKindOf = (name: string): ResultFileKind | null => {
  const suffix = suffixOf(name);
  return isResultSuffix(suffix) ? kinds[suffix] : null;
};
