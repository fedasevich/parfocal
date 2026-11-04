# 0173. Lingui for the web app's strings

- Date: 2026-11-03
- Status: Accepted
- Deciders: Parfocal agents, owner (accepted 2026-11-04)
- Backlog: I18N-000 (research check for i18n libraries), I18N-001 (string externalisation in the web app)

## Context

I18N-001 moves every UI string in `apps/web` and `packages/ui` behind an i18n layer, extracts an English catalogue and adds a lint rule against raw strings in JSX. Only English ships, Czech is the next language the settings already offer. The build is Vite 8 with `@rolldown/plugin-babel` 0.2 and Babel 8 (for the React compiler), React 19, TypeScript 7 and Node 26. Lint is Biome plus oxlint, with no ESLint. Numbers, dates and lengths already go through the native `Intl` module of [ADR 0168](0168-one-formatting-module.md), and backend messages use keyed catalogues with the pseudo locale `en-XA` ([ADR 0172](0172-backend-message-catalogues-and-pseudo-locale.md)).

Versions checked on the npm registry on 2026-11-03.

## Options considered

| Option | Latest | Messages | Extraction | Fit with this build |
| --- | --- | --- | --- | --- |
| Lingui | `@lingui/core`, `react`, `cli`, `vite-plugin` 6.11.0 (2026-10-29) | ICU MessageFormat, written in source through the `t` and `<Trans>` macros | `lingui extract` finds macro calls, writes PO or JSON catalogues, and `lingui compile` turns them into functions, so no ICU parser ships to the browser | The Vite plugin declares Vite 8, rolldown, `@rolldown/plugin-babel` 0.2 and Babel 8 as peers, and the macro is a Babel plugin, so it joins the existing Babel pass. Built-in pseudo locale. React 19 is a declared peer |
| FormatJS (`react-intl`) | `react-intl` 12.1.6 (2026-10-27), `@formatjs/cli` 6.18.0 | ICU MessageFormat, the reference implementation | `formatjs extract` reads `defineMessages` and `<FormattedMessage>`. Ids are explicit or hashed. Precompiling to AST is an extra step, otherwise the parser ships | Works with any build. Messages carry a `defaultMessage` and an id next to every string, which is more to write and review |
| i18next with ICU | `i18next` 26.7.1, `react-i18next` 17.1.11, `i18next-icu` 2.6.1 | Its own interpolation format by default, ICU only through the `i18next-icu` plugin | Keys are written by hand into JSON, extraction needs a separate scanner | Large ecosystem, but ICU is a plugin on top of a different native format, and keys drift from the text |

## Decision

Use Lingui 6 with ICU messages and extraction, the backlog default.

- Strings are written in English in the source with the `t` macro and `<Trans>`, and the macro generates the message ids, so a screen reads like the mock and nobody invents keys.
- `@lingui/vite-plugin` and `@lingui/babel-plugin-lingui-macro` join the Babel pass that already runs the React compiler. No second transform tool enters the build.
- Catalogues are PO files under `apps/web/src/locales/`, one per locale, extracted by `lingui extract` and compiled at build time. PO is what translators and their tools read, and the ICU text inside is the same syntax as the backend catalogues use for plural and select.
- The pseudo locale is `en-XA`, as in ADR 0172, so the web and the backend are checked the same way.
- Formatting stays in the `Intl` module of ADR 0168. Lingui only translates text, and messages pass already formatted values in.
- The raw string lint rule runs in oxlint. I18N-001 first tries `eslint-plugin-lingui` 0.16.0 and its `no-unlocalized-strings` rule as an oxlint JS plugin. That support is still alpha, and the plugin declares TypeScript 5 or 6 as a peer while the repo uses 7, so if the rule does not load cleanly I18N-001 writes a small local oxlint JS plugin that flags JSX text and string literals in text props.

## Consequences

- I18N-001 adds `@lingui/core`, `@lingui/react`, `@lingui/cli`, `@lingui/vite-plugin` and `@lingui/babel-plugin-lingui-macro` at 6.11.0, a `lingui.config.ts` in `apps/web`, an `I18nProvider` at the root that reads the language setting through the same query as `useFormat()`, and a test that renders a screen in `en-XA` and fails on plain letters.
- Lingui requires Node 22.19 or later, which the repo's Node 26 meets.
- Moving to FormatJS later is possible because both use ICU, but the macro call sites would all change, so the choice is costly to undo.
- `packages/ui` components take text as props or use the same macros, decided per component in I18N-001.
