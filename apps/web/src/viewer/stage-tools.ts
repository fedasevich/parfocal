const stageNameOfRail: Readonly<Record<string, string>> = {
  poly: "polygon",
  free: "freehand",
  rect: "rectangle",
  marker: "marker",
  ellipse: "ellipse",
};

export const stageToolOf = (railTool: string): string => stageNameOfRail[railTool] ?? railTool;

export const railToolOf = (stageTool: string): string =>
  Object.entries(stageNameOfRail).find(([, stage]) => stage === stageTool)?.[0] ?? stageTool;
