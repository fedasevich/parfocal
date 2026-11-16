status: review
by: claude parallel run
since: 2026-11-15
note: The images job is green in ci runs 43861106388, 43863632654 and 43868930254 (locks match, API image built, Trivy found no critical, SBOM uploaded, container migrated and answered /api/health). Still missing: the Done line says the Modal images build in CI, and they build only in deploy.yml, which decision 96 pauses. The owner can accept the locks resolving for linux/amd64 as the proof (ADR 0339), or a Modal build step has to be added.
