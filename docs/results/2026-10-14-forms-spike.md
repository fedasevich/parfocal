# Result: forms and validation spike

- Date: 2026-10-14
- Backlog: STACK-009 (forms and validation)
- Kind: spike
- Commit: c8e03ee (the spike code lived in a temporary directory outside the repository and was not committed)
- Environment: MacBook, macOS Darwin 24.6.0, Node 26.9.0, npm registry as of 2026-10-14. No browser was used, so there are no runtime or render timings.
- Data: a synthetic synoptic-style form for a sentinel lymph node report. No PHI and no real report values.

## Question

Do the candidate form libraries and schema libraries compile under TypeScript 7 with the repository's strict flags, compile under React Compiler, and what do they cost in bundle size, for a form with one conditional field group? The conditional group is the one that appears only when lymph nodes were examined. There is no POC number to compare against and no bundle budget for forms yet (TODO: STACK-009 does not set one).

## Method

All work ran in a directory made with `mktemp -d`. Nothing was installed in the repository.

1. Installed exact versions: react 19.3.0, react-dom 19.3.0, @types/react 19.3.0, react-hook-form 7.90.0, @hookform/resolvers 5.9.1, @tanstack/react-form 1.33.5, @conform-to/react and @conform-to/zod 1.21.2, zod 4.6.7, valibot 1.5.0, arktype 2.2.8, typescript 7.0.2, esbuild 0.28.2, rolldown 1.2.14, babel-plugin-react-compiler 1.0.0 with @babel/core 8.0.7.
2. Copied the repository's strict flags from `packages/typescript-config/base.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `isolatedModules`, `moduleResolution: nodenext`) and added `jsx: react-jsx`. Ran `tsc -p .` with TypeScript 7.0.2. A deliberate type error in a scratch file confirmed that tsc reports errors in this setup.
3. Wrote one schema in Zod 4 (discriminated union on `nodesExamined`: when `yes`, the fields total nodes, nodes with metastasis, largest deposit in mm and extranodal extension, with a rule that positive nodes cannot exceed nodes examined and that the deposit size is required when positive nodes are above zero. When `no`, a reason). The same schema was written in `zod/mini`, Valibot and ArkType. Form components were written with React Hook Form plus the Zod resolver, TanStack Form, Conform and a plain `useReducer`.
4. Ran the Zod schema on four inputs with Node and read the issues and the parsed output.
5. Wrote a template-driven version, where the form is generated from template data with a `visibleWhen` condition tree, a cross-field limit and one Zod schema per field kind. It was checked by 7 `node --test` cases and a TanStack Form component that uses it as a form-level validator.
6. Ran babel-plugin-react-compiler 1.0.0 over every form component with a logger, and counted `CompileSuccess` events against other events.
7. Bundle sizes: minified with rolldown 1.2.14 (the bundler behind Vite 8) for the schema libraries and for the full form bundles, with react and react-dom external. The form libraries alone (Zod and the schema file external) were measured with esbuild 0.28.2 `--minify`. Gzip is `gzip -9`. An early esbuild run of the Zod schema gave 92.8 KB gzip because esbuild kept more of Zod than rolldown, so the Zod number below comes from rolldown.

## Results

TypeScript 7.0.2 with the repository flags, exit code 0 for all files: the four form components, the template-driven form, all four schema files, the template module and its test.

React Compiler 1.0.0.

| Component | Result |
|---|---|
| React Hook Form form (uses `useWatch`, not `watch`) | compiled |
| TanStack Form form | compiled |
| Conform form | compiled |
| Reducer form | compiled |
| Template-driven TanStack Form | compiled |

Zod run on four inputs.

| Input | Outcome |
|---|---|
| Examined, 3 nodes, 4 positive, no deposit size | two issues, `nodesWithMetastasis: Cannot exceed nodes examined` and `largestDepositMm: Required when nodes have metastasis` |
| Examined, 3 nodes, 1 positive, deposit 2.5, plus an unknown key | typed output with numbers, unknown key dropped |
| Not examined, reason given, plus a leftover `totalNodes` | output holds only `nodesExamined` and `reason` |
| Examined, 3 nodes, 1 positive, no deposit size | one issue, `largestDepositMm: Required when nodes have metastasis` |

Template-driven validation, 7 of 7 `node --test` cases passed. They cover which fields are visible for not examined, examined with zero positive nodes and examined with positive nodes. They also cover hidden leftovers staying out of the payload, a newly revealed required field blocking, the cross-field limit and a fully valid typed payload.

Schema library bundle for the same schema, minified with rolldown, application code and library included.

| Schema library | Minified bytes | Gzip bytes |
|---|---|---|
| Zod 4.6.7 classic | 92,529 | 25,049 |
| Zod 4.6.7 mini | 22,599 | 7,068 |
| Valibot 1.5.0 | 7,622 | 2,503 |
| ArkType 2.2.8 | 154,642 | 46,235 |

Form library alone, minified with esbuild, with react, react-dom, zod and the schema file external. The resolver is included for React Hook Form and the Zod parser for Conform.

| Form approach | Minified bytes | Gzip bytes |
|---|---|---|
| React Hook Form 7.90.0 with @hookform/resolvers 5.9.1 | 37,733 | 13,684 |
| TanStack Form 1.33.5 | 67,757 | 17,993 |
| Conform 1.21.2 (react and zod packages) | 37,321 | 12,060 |
| Plain `useReducer` | 1,273 | 607 |

Full form bundle including Zod, minified with rolldown, react external.

| Form | Minified bytes | Gzip bytes |
|---|---|---|
| React Hook Form with Zod | 130,828 | 37,685 |
| TanStack Form with Zod | 159,617 | 41,456 |
| Conform with Zod | 129,005 | 35,902 |
| Reducer with Zod | 93,897 | 25,424 |
| Template-driven TanStack Form with Zod | 137,769 | 35,917 |

Peer ranges read from the npm registry on 2026-10-14.

| Package | react peer range |
|---|---|
| react-hook-form 7.90.0 | `^16.8.0 \|\| ^17 \|\| ^18 \|\| ^19` |
| @tanstack/react-form 1.33.5 | `^17.0.0 \|\| ^18.0.0 \|\| ^19.0.0` |
| @conform-to/react 1.21.2 | `>=18` |

Things noticed while writing the forms, as facts about this spike only.

- With React Hook Form, the discriminated union needed a cast on `defaultValues` and an `in` check before reading `errors.totalNodes`, because the error type is the union of both branches.
- With TanStack Form, `field.state.value` for a field that exists in only one branch typed as possibly undefined, so the inputs needed a `?? ""`.

## Interpretation

- Every candidate compiles under TypeScript 7 with the strict flags and under React Compiler 1.0.0, so neither is a differentiator. This is a compile result only. Nothing was rendered, so runtime behaviour under the compiler is unverified.
- Between the form libraries the gzip difference is about 4 KB (TanStack Form against React Hook Form). Zod's own size is larger than any form library's, so the schema library choice moves the total more than the form library choice. The Zod classic number depends on the bundler, as the esbuild run showed. The size of a real app build will differ.
- The Conform, TanStack Form and React Hook Form components cover only the first fields of the form. The Conform and React Hook Form components are partial, so their sizes do not include extra features a full form would pull in (for example array fields). Assumption: this changes the sizes by a small amount for React Hook Form and Conform.
- The template-driven validator is a pure function on a plain record, so it does not depend on the form library. The same function drove the TanStack Form component and could drive the others.
- The test cases show the rule the ADR relies on. A hidden field's leftover value never reaches the payload.

## Follow-ups

- ADR written: [0045 forms and validation](../adr/0045-forms-and-validation.md).
- TODO: render the chosen form in a browser test (REPORT-005, report tab and editor) to check that fields show and hide without losing focus, and measure re-renders on a form with about 40 fields.
- TODO: generate Zod schemas from `openapi.json` with Orval 8.43 (`client: "zod"`) and confirm the output compiles with the repository flags. This spike did not run Orval.
- TODO: confirm that a Python implementation of the condition tree gives the same answers as the TypeScript one on shared fixtures (REPORT-002, template engine).
- TODO: no bundle budget exists for forms. Set one when the web app's overall budget is set.
