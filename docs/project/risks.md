# Risks

Likelihood and impact are `Low`, `Medium` or `High`. The initial ratings are planning estimates, not measurements. Review this list at every consolidation.

| ID | Risk | Likelihood | Impact | Mitigation | Backlog | Status |
|---|---|---|---|---|---|---|
| R1 | Key AI weights (HoVer-NeXt, VISTA-2D) are non-commercial and PanNuke-derived calibration may be too, which could block AI features in commercial tenants | High | High | The owner said on 2026-10-15 that Parfocal will not really be commercial, so STACK-031 is on hold. Revisit the licence matrix in ADR 0042 before any paying tenant | STACK-031, AIP-002 | Open |
| R2 | JPEG 2000 SVS decodes too slowly in the browser | Medium | Medium | Measure against the viewer budgets and convert J2K only if the trigger fires | INGEST-014 | Open |
| R3 | Browser readers give confident wrong answers on some files (big-endian BigTIFF offsets, YCbCr, NDPI over 4 GB) | Medium | High | Per-file validation at ingest, sidecar indexes, golden-image tests per format | INGEST-016, STACK-016 | Open |
| R4 | GPU memory leaks in luma.gl and deck.gl across slide switches | Medium | High | Apply the doc 24 fixes and run the 20-slide memory test in CI | STACK-015, VIEW-031 | Open |
| R5 | Viv is GLSL-only, so the primary renderer stays on WebGL2 while browsers move to WebGPU | Low | Medium | Keep the renderer interface and the WebGPU alternates passing the same golden tests | STACK-015 | Open |
| R6 | Scope is large (600 tasks) for the team size | High | High | Walking skeleton first and milestone gates, and cut by epic at each consolidation if needed | All | Open |
| R7 | Compliance readiness (GDPR, HIPAA, ISO 27001) in v1 adds work across every epic | Medium | High | Definition of Done covers tenant isolation, audit and PHI-free logs on every task | SEC | Open |
| R8 | Vendor lock-in and spend at the edge (Workers, Durable Objects) and for GPU work (Modal) | Medium | Medium | The API package has no Modal imports, every service sits behind an interface with a local implementation, and spend is checked against the STACK-029 estimate | STACK-019, STACK-029, OPS-009 | Open |
| R9 | Modal places unpinned containers far from Neon, so API requests that make several queries get slow | Medium | Medium | Measure in the STACK-019 and STACK-020 spikes, put Neon where Modal runs, and move FastAPI to a fixed host if the budget is missed | STACK-019, STACK-020 | Open |
| R10 | The step from public pilot data to real PHI needs plan upgrades (Modal Team, Neon and Cloudflare BAAs), region pinning with an R2 data copy and a KMS, all at once | Medium | High | The triggers are listed in ADR 0003, region is a tenant attribute from day one and envelope encryption is built during the pilot | SEC-005, STACK-037 | Open |
| R11 | Cloud access is paused, so nothing has run on staging, and M0 and M1 gates that need Modal, Neon or staging cannot close | High | Medium | Build and test everything locally against the same interfaces, and keep the cloud-only steps listed as TODOs in their tasks | STACK-019, STACK-020, SKEL | Open |
| R12 | Agents accept ADRs under the owner's standing approval faster than the owner reviews them, and later work builds on a Proposed ADR (0023) | Medium | Medium | Next up lists the ADRs to review, and each accepted ADR names what it changed so it can be superseded cleanly | All | Open |
