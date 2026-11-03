export type FormatSettings = {
  language: "en" | "cs";
  lengths: "auto" | "um";
};

export const defaultFormatSettings: FormatSettings = { language: "en", lengths: "auto" };

export const tabularFigures = "tabular-nums";

const localeOfLanguage = { en: "en-GB", cs: "cs-CZ" } as const;

export type NumberOptions = { decimals?: number; grouping?: boolean };

export type Format = {
  locale: string;
  number: (value: number, options?: NumberOptions) => string;
  integer: (value: number) => string;
  percent: (fraction: number, decimals?: number) => string;
  percentPoints: (points: number, decimals?: number) => string;
  percentOf: (part: number, whole: number) => string;
  date: (at: Date) => string;
  dateShort: (at: Date) => string;
  dateLong: (at: Date) => string;
  weekday: (at: Date) => string;
  time: (at: Date) => string;
  dateTime: (at: Date) => string;
  duration: (milliseconds: number) => string;
  length: (microns: number) => string;
  size: (millimetres: number) => string;
};

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = numberFormats.get(key);
  if (found === undefined) {
    found = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, found);
  }
  return found;
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = dateFormats.get(key);
  if (found === undefined) {
    found = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(key, found);
  }
  return found;
}

const dayParts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
const clockParts: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};

const fixedDigits = (decimals: number): Intl.NumberFormatOptions => ({
  minimumFractionDigits: decimals,
  maximumFractionDigits: decimals,
});

export function createFormat(settings: FormatSettings = defaultFormatSettings): Format {
  const locale = localeOfLanguage[settings.language];

  const number = (value: number, options: NumberOptions = {}) =>
    numberFormat(locale, {
      useGrouping: options.grouping ?? true,
      ...(options.decimals === undefined ? {} : fixedDigits(options.decimals)),
    }).format(value);

  const significant = (value: number) =>
    numberFormat(locale, { useGrouping: false, maximumSignificantDigits: 6 }).format(value);

  const percent = (fraction: number, decimals = 0) =>
    numberFormat(locale, { style: "percent", ...fixedDigits(decimals) }).format(fraction);

  return {
    locale,
    number,
    integer: (value) => number(value, { decimals: 0 }),
    percent,
    percentPoints: (points, decimals) => percent(points / 100, decimals),
    percentOf: (part, whole) => percent(whole > 0 ? part / whole : 0),
    date: (at) => dateFormat(locale, dayParts).format(at),
    dateShort: (at) => dateFormat(locale, { day: "numeric", month: "short" }).format(at),
    dateLong: (at) => dateFormat(locale, { ...dayParts, month: "long" }).format(at),
    weekday: (at) => dateFormat(locale, { weekday: "long" }).format(at),
    time: (at) => dateFormat(locale, clockParts).format(at),
    dateTime: (at) =>
      `${dateFormat(locale, dayParts).format(at)}, ${dateFormat(locale, clockParts).format(at)}`,
    duration: (milliseconds) => durationText(milliseconds, number),
    length: (microns) =>
      settings.lengths === "um" || Math.abs(microns) < 1000
        ? `${significant(microns)} µm`
        : `${significant(microns / 1000)} mm`,
    size: (millimetres) =>
      settings.lengths === "um"
        ? `${number(Math.round(millimetres * 1000), { decimals: 0, grouping: false })} µm`
        : `${number(millimetres, { decimals: Math.abs(millimetres) < 1 ? 2 : 1, grouping: false })} mm`,
  };
}

function durationText(
  milliseconds: number,
  number: (value: number, options?: NumberOptions) => string,
): string {
  const clamped = Math.max(0, milliseconds);
  if (clamped < 1000) return `${number(Math.round(clamped), { decimals: 0 })} ms`;
  if (clamped < 60_000) {
    const seconds = Math.round(clamped / 100) / 10;
    return `${number(seconds, { decimals: Number.isInteger(seconds) ? 0 : 1 })} s`;
  }
  const totalSeconds = Math.round(clamped / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}
