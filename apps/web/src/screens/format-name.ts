export function formatNameOf(file: string): string {
  const dot = file.lastIndexOf(".");
  if (dot <= 0 || dot === file.length - 1) return "";
  return file.slice(dot + 1).toUpperCase();
}
