# XXXX. One formatting module that reads the user's settings

- Date: 2026-11-03
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: I18N-002 (locale-aware formatting)

## Context

Screens formatted numbers, dates and sizes by hand with `toFixed`, `toLocaleDateString("en-GB")` and `toLocaleString("en-US")`. The settings catalogue already has a language (English or Czech) and a lengths choice (automatic, or always µm), but nothing read them.

## Decision

- The pure module is `createFormat(settings)` in `packages/ui/src/lib/format.ts`. It has no React and no API dependency, so the viewer, the reports and the tests share it. English maps to the locale en-GB and Czech to cs-CZ.
- `apps/web/src/format.ts` holds the settings-aware part. `useFormat()` reads the personal settings and falls back to English with automatic lengths until they load, and `formatFor` caches one formatter per setting pair.
- Two length formatters stay separate on purpose. `length(microns)` is for scale bars and rulers and switches to mm from 1000 µm in automatic mode. `size(mm)` is for object sizes and keeps the mock's rule of two decimals under 1 mm and one above. With "always µm", both give whole µm.
- Measurements never group digits and use plain digits. The exported `tabularFigures` class (`tabular-nums`) is what screens put on any element that shows a measurement.
- Duration units (ms, s, min, h) are the same in English and Czech, so they are not translated yet.
- The engine's own `formatLength` for scale-bar labels stays until the scale bar reads the lengths setting.

## Consequences

Moving a call site onto the module is a one-line change. A new language adds one entry to the locale map. Report pages and the signed evaluation keep fixed English dates until the report templates take a locale (I18N-003, locale-ready backend messages and report templates).

## Alternatives

- A formatting library such as FormatJS. Rejected for now because the native `Intl` covers every format needed, and the i18n library choice (I18N-000) is a separate decision.
- A React context provider instead of a hook on the settings query. Rejected because the query cache already is the shared store.
