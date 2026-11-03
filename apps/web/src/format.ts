import { useGetMySettings } from "@parfocal/api-client";
import { createFormat, defaultFormatSettings, type Format } from "@parfocal/ui/lib/format";

const formats = new Map<string, Format>();

export function formatFor(language: "en" | "cs", lengths: "auto" | "um"): Format {
  const key = `${language}|${lengths}`;
  let found = formats.get(key);
  if (found === undefined) {
    found = createFormat({ language, lengths });
    formats.set(key, found);
  }
  return found;
}

export const defaultFormat = formatFor(
  defaultFormatSettings.language,
  defaultFormatSettings.lengths,
);

export function useFormat(): Format {
  const personal = useGetMySettings().data?.data.personal;
  if (personal === undefined) return defaultFormat;
  return formatFor(personal.language, personal.lengths);
}
