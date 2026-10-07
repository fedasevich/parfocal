# Risks

Likelihood and impact are `Low`, `Medium` or `High`. The initial ratings are planning estimates, not measurements. Review this list at every consolidation.

| ID | Risk | Likelihood | Impact | Mitigation | Backlog | Status |
|---|---|---|---|---|---|---|
| R1 | Key AI weights (HoVer-NeXt, VISTA-2D) are non-commercial and PanNuke-derived calibration may be too, which could block AI features in commercial tenants | High | High | Licence matrix enforced by the model registry, and permissive alternatives ranked in the AI research checks | STACK-031, AIP-002 | Open |
| R2 | JPEG 2000 SVS decodes too slowly in the browser | Medium | Medium | Measure against the viewer budgets and convert J2K only if the trigger fires | INGEST-014 | Open |
| R3 | Browser readers give confident wrong answers on some files (big-endian BigTIFF offsets, YCbCr, NDPI over 4 GB) | Medium | High | Per-file validation at ingest, sidecar indexes, golden-image tests per format | INGEST-016, STACK-016 | Open |
| R4 | GPU memory leaks in luma.gl and deck.gl across slide switches | Medium | High | Apply the doc 24 fixes and run the 20-slide memory test in CI | STACK-015, VIEW-031 | Open |
| R5 | Viv is GLSL-only, so the primary renderer stays on WebGL2 while browsers move to WebGPU | Low | Medium | Keep the renderer interface and the WebGPU alternates passing the same golden tests | STACK-015 | Open |
| R6 | Scope is large (531 tasks) for the team size | High | High | Walking skeleton first and milestone gates, and cut by epic at each consolidation if needed | All | Open |
| R7 | Compliance readiness (GDPR, HIPAA, ISO 27001) in v1 adds work across every epic | Medium | High | Definition of Done covers tenant isolation, audit and PHI-free logs on every task | SEC | Open |
| R8 | Vendor lock-in and spend at the edge (Workers, Durable Objects) and for GPU work (Modal) | Medium | Medium | The API package has no Modal imports, every service sits behind an interface with a local implementation, and spend is checked against the STACK-029 estimate | STACK-019, STACK-029, OPS-009 | Open |
| R9 | Modal places unpinned containers far from Neon, so API requests that make several queries get slow | Medium | Medium | Measure in the STACK-019 and STACK-020 spikes, put Neon where Modal runs, and move FastAPI to a fixed host if the budget is missed | STACK-019, STACK-020 | Open |
| R10 | The step from public pilot data to real PHI needs plan upgrades (Modal Team, Neon and Cloudflare BAAs), region pinning with an R2 data copy and a KMS, all at once | Medium | High | The triggers are listed in ADR 0003, region is a tenant attribute from day one and envelope encryption is built during the pilot | SEC-005, STACK-037 | Open |
