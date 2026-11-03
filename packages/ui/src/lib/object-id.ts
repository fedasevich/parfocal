export const looseSlideCase = "~";

export type ObjectIdParts = {
  project: string;
  caseLabel: string | null | undefined;
  slide: string;
  object: string;
};

export type ClipboardWriter = { writeText: (text: string) => Promise<void> };

export function asciiObjectId(shown: string): string {
  return shown.replaceAll("·", ".").replaceAll("⁺", "+");
}

export function objectIdPath({ project, caseLabel, slide, object }: ObjectIdParts): string {
  const caseSegment =
    caseLabel === null || caseLabel === undefined || caseLabel === ""
      ? looseSlideCase
      : encodeURIComponent(caseLabel);
  return [
    encodeURIComponent(project),
    caseSegment,
    encodeURIComponent(slide),
    asciiObjectId(object),
  ].join("/");
}

export async function copyObjectId(
  text: string,
  clipboard: ClipboardWriter | undefined,
): Promise<boolean> {
  if (clipboard === undefined) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
