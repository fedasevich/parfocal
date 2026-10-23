# Results

One file per measured run, named `YYYY-MM-DD-short-topic.md`. Copy [_template.md](_template.md) to start one. Results are not edited after the fact. A repeat run gets a new file that links the earlier one.

| Date | Result | Backlog | Kind |
|---|---|---|---|
| 2026-10-06 | [Monorepo tooling and Python wheel check](2026-10-06-tooling-spike.md) | STACK-013, STACK-018 | spike |
| 2026-10-08 | [Vite 8 bundles an onnxruntime-web module worker under COOP and COEP](2026-10-08-vite-worker-wasm-spike.md) | STACK-001 | spike |
| 2026-10-08 | [React Compiler on Vite 8 and a WebGL host under StrictMode](2026-10-08-react-compiler-strictmode-spike.md) | STACK-002 | spike |
| 2026-10-08 | [OpenAPI 3.1 from FastAPI and typed clients under TypeScript 7](2026-10-08-api-client-codegen-spike.md) | STACK-008, STACK-019 | spike |
| 2026-10-08 | [Row-level security, a transaction-mode pooler and bulk inserts on local Postgres](2026-10-08-postgres-rls-pooler-spike.md) | STACK-020 | spike |
| 2026-10-08 | [A restrictive scope policy limits a guest to one case and one view](2026-10-08-guest-scope-rls-spike.md) | STACK-023 | spike |
| 2026-10-13 | [Zitadel Cloud login through a FastAPI backend-for-frontend](2026-10-13-zitadel-bff-login-spike.md) | STACK-028 | spike |
| 2026-10-14 | [Envelope encryption with tenant data keys in Python](2026-10-14-envelope-encryption-spike.md) | STACK-037 | spike |
| 2026-10-14 | [fhir.resources 8.3 for R4B and R5 on Python 3.14](2026-10-14-fhir-resources-spike.md) | STACK-040 | spike |
| 2026-10-14 | [Forms and validation: library compile, React Compiler and bundle size](2026-10-14-forms-spike.md) | STACK-009 | spike |
| 2026-10-14 | [A three-step workflow that survives SIGKILL, on Postgres tables and on DBOS](2026-10-14-durable-workflow-spike.md) | STACK-022 | spike |
| 2026-10-15 | [Server slide reading with tifffile, tiffslide, OpenSlide and wsidicom](2026-10-15-server-slide-reading-spike.md) | STACK-026 | spike |
| 2026-10-15 | [Routing with TanStack Router and React Router](2026-10-15-routing-spike.md) | STACK-003 | spike |
| 2026-10-15 | [Server state with TanStack Query, SWR and RTK Query](2026-10-15-server-state-spike.md) | STACK-004 | spike |
| 2026-10-17 | [Class colour separation for the taxonomy templates and the API check](2026-10-17-class-colour-separation.md) | PROJ-004 | baseline |
| 2026-10-18 | [Parsers for imported AI results on Python 3.14](2026-10-18-result-parsers-spike.md) | RSET-000 | spike |
| 2026-10-18 | [Tissue mask on CAMELYON16](2026-10-18-tissue-mask-camelyon.md) | INGEST-012 | ML evaluation |
| 2026-10-18 | [Paging 1.6 million cells from binary chunks in the browser](2026-10-18-cell-chunk-paging-spike.md) | STACK-021 | spike |
| 2026-10-18 | [Bulk annotation insert and listing on local Postgres](2026-10-18-annotation-bulk-latency.md) | ANN-020 | baseline |
| 2026-10-18 | [Typst and WeasyPrint for the evaluation report PDF](2026-10-18-pdf-generation-spike.md) | STACK-035 | spike |
| 2026-10-18 | [The geometric scorer reproduces the POC's TNBC numbers](2026-10-18-geometric-scorer-reproduction.md) | MLEVAL-002 | ML evaluation |
| 2026-10-18 | [TNBC and NuInsSeg load from their verified Zenodo archives](2026-10-18-dataset-loaders.md) | MLEVAL-001 | baseline |
| 2026-10-18 | [The typing and calibration harness reproduces POC doc 29 for HoVer-NeXt](2026-10-18-typing-calibration-reproduction.md) | MLEVAL-004 | ML evaluation |
| 2026-10-18 | [Postgres search over 100,000 cases answers in under 30 ms, and row-level security keeps it off the trigram index](2026-10-18-search-spike.md) | STACK-034 | spike |
| 2026-10-23 | [Viv 0.23 on deck.gl 9.4 opens CMU-1.svs and keeps one Deck over 20 slide switches](2026-10-23-viv-version-spike.md) | STACK-015 | spike |
| 2026-10-23 | [Camera state outside React: 60 fps pans of CMU-1.svs with 0 inspector renders, against 120 to 180 for a whole-camera reader](2026-10-23-hot-path-state-spike.md) | STACK-006 | spike |
| 2026-10-23 | [SwiftShader golden frames are identical across runs, Metal is within 1 level, and a red-blue swap misses by 27 to 42 levels of mean error](2026-10-23-golden-image-tolerances.md) | TEST-005 | baseline |
| 2026-10-23 | [The latency proxy adds the set RTT plus 1 to 2 ms at 0, 50, 100 and 200 ms and holds its bandwidth limit within 3 ms](2026-10-23-latency-proxy.md) | TILES-006 | baseline |
| 2026-10-23 | [The Viv route draws CMU-1.svs identically on every SwiftShader run, and swapped, unconverted or misplaced pixels all fail its goldens](2026-10-23-viv-route-goldens.md) | VIEW-002 | baseline |
| 2026-10-23 | [On SwiftShader, 20 slide switches keep one Deck and the heap 3.9% to 4.0% over baseline, and without canvasContext.destroy every deck stays alive](2026-10-23-memory-teardown-swiftshader.md) | VIEW-030 | baseline |
| 2026-10-23 | [The decode pool pans CMU-1.svs with no byte downloaded twice, and keeping started work turns 160 fetches with no tile into 1 fetch](2026-10-23-decode-pool-pan-fetches.md) | VIEW-004 | benchmark |
