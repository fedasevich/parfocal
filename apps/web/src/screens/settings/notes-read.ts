type NoteStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const notesReadKey = "parfocal.setting-notes-read";

const browserStorage = (): NoteStorage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export function readNotesRead(storage: NoteStorage | undefined = browserStorage()): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(notesReadKey) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

export function rememberNotesRead(
  ids: readonly string[],
  storage: NoteStorage | undefined = browserStorage(),
): Set<string> {
  const read = readNotesRead(storage);
  if (ids.every((id) => read.has(id))) return read;
  for (const id of ids) read.add(id);
  try {
    storage?.setItem(notesReadKey, JSON.stringify([...read]));
  } catch {}
  return read;
}

export function forgetNotesRead(storage: NoteStorage | undefined = browserStorage()): void {
  try {
    storage?.removeItem(notesReadKey);
  } catch {}
}
