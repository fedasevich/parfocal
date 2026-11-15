status: in-progress
by: claude parallel run
since: 2026-11-15
note: Prompt-pass fallback built in apps/web/src/aiseg/prompt-pass.ts and prompt-fallback.ts with the POC constants (stain seeds strongest first, batches, stability 0.8, overlap 0.3, residual pass in best quality) and wired into runRegionPass and the auto layer, which falls back for the rest of the pass once segmentAll fails. Unit tests in aiseg-prompt-pass and aiseg-prompt-fallback. Left: the TNBC weights test against the POC stain-seed row (doc 26 gives 0.752 on TNBC, the contour stain-seed row 0.514 is on dev), the 96 px tile overlap (the pass still uses the 64 px halo cores) and the five-prompt ensemble. Decodes run one prompt at a time until a batched decoder graph exists.
