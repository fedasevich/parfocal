# 0172. Backend messages live in keyed catalogues with a pseudo locale

- Date: 2026-11-03
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: I18N-003 (locale-ready backend messages and report templates)

## Context

Emails and the evaluation report must take a locale before a second language ships. The email templates in `apps/api` held English text inline, and no report template existed yet. [ADR 0083](0083-typst-for-report-pdfs.md) renders report PDFs with Typst in the export worker and passes the locale through `sys_inputs`.

## Decision

- `parfocal_api/locales.py` holds the `Locale` list, number and date styles per locale and the pseudo locale `en-XA`. English is the default and the only shipped language.
- Every message has a stable key. Email keys are `<template>.subject`, `<template>.line.<n>` and `<template>.action`, built from the English templates. Report keys start with `report.`. A locale is a mapping from those keys to text, so a translator works on one flat catalogue per language.
- The pseudo locale is generated from English. It accents every letter and wraps the text in `⟦ ⟧`, keeping `{field}` placeholders. Tests render every email and the report in it and fail on any plain letter that is not a user value, which catches strings that skip the catalogue.
- `render(name, values, locale)` and `render_report(data, locale)` take the locale. The report renderer builds the Typst source in the API with every value quoted as a Typst string, so the export worker (EVAL-003) only compiles it and the API needs no typst wheel. Its `inputs` carry the locale and messages for `sys_inputs`.

## Consequences

- Adding Czech means one catalogue with the same keys and one entry in the style map. A missing key fails loudly.
- Callers still pass English until the recipient's language setting reaches the API.
- EVAL-003 compiles `RenderedReport.source` and can extend the report by adding keys to `REPORT_MESSAGES`.

## Alternatives

- gettext with `.po` files. Rejected for now because it adds a compile step and tooling for one language. The flat keyed catalogues convert to `.po` later if translators want it.
- Translating inside the Typst template with a dictionary there. Rejected because email and report text would then live in two catalogue formats.
