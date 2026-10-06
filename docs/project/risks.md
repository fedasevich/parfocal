# Risks

Likelihood and impact are `Low`, `Medium` or `High`. The initial ratings are planning estimates, not measurements. Review this list at every consolidation.

| ID | Risk | Likelihood | Impact | Mitigation | Backlog | Status |
|---|---|---|---|---|---|---|
| R1 | Key AI weights (HoVer-NeXt, VISTA-2D) are non-commercial and PanNuke-derived calibration may be too, which could block AI features in commercial tenants | High | High | Licence matrix enforced by the model registry, and permissive alternatives ranked in the AI research checks | STACK-031, AIP-002 | Open |
| R2 | JPEG 2000 SVS decodes too slowly in the browser | Medium | Medium | Measure against the viewer budgets and convert J2K only if the trigger fires | INGEST-014 | Open |
| R3 | Browser readers give confident wrong answers on some files (big-endian BigTIFF offsets, YCbCr, NDPI over 4 GB) | Medium | High | Per-file validation at ingest, sidecar indexes, golden-image tests per format | INGEST-016, STACK-016 | Open |
| R4 | GPU memory leaks in luma.gl and deck.gl across slide switches | Medium | High | Apply the doc 24 fixes and run the 20-slide memory test in CI | STACK-015, VIEW-031 | Open |
| R5 | Viv is GLSL-only, so the primary renderer stays on WebGL2 while browsers move to WebGPU | Low | Medium | Keep the renderer interface and the WebGPU alternates passing the same golden tests | STACK-015 | Open |
| R6 | Scope is large (520 tasks) for the team size | High | High | Walking skeleton first and milestone gates, and cut by epic at each consolidation if needed | All | Open |
| R7 | Compliance readiness (GDPR, HIPAA, ISO 27001) in v1 adds work across every epic | Medium | High | Definition of Done covers tenant isolation, audit and PHI-free logs on every task | SEC | Open |
