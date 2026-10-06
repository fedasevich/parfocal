# Overview

## The product

The product is called Parfocal and its domain is `parfocal.eu`. The working name during planning was pathviewer. The repository is `fedasevich/parfocal` and lives at `/Users/yuriifedas/WebstormProjects/parfocal`.

Parfocal is a multi-tenant cloud platform for pathologists to view whole-slide images, review AI pre-reads, annotate, discuss cases and sign out reports. It is built to research and pilot grade with production-quality code and makes no regulatory claims in v1.

## Users

The roles come from IAM-006 in the backlog. They are org admin, lab admin, lab lead, consultant pathologist, resident, annotator, guest consultant, secretary and read-only clinician. Consultant pathologists signing out cases are the primary user, and the design is sign-out first.

## Scope of v1

- Whole-slide viewing with Viv as the primary renderer, reading every POC-supported format natively.
- Worklists, cases, navigation aids, the Review and Annotate workspaces and measurements.
- AI pre-read on slide arrival, interactive segmentation, whole-slide nuclei and typing, tumor maps and learning from corrections.
- Realtime threads, presence, follow-my-view, guest second opinions and slide comparison.
- Cases with CSV and FHIR import, templated synoptic reports, PDF with AI disclosure and sign-out.
- GDPR, HIPAA and ISO 27001 readiness. The pilot itself holds only public slides with seeded fake identities.
- Every home and worklist variant behind feature flags for A/B experiments.
- Mouse, keyboard, trackpad, tablet with pen, gamepad and SpaceMouse.

The full scope and the "Later epics" list are in [BACKLOG.md](../BACKLOG.md). The decisions behind this scope are in [ADR 0002](../adr/0002-planning-baseline.md).

## Platform

The web app and edge run on Cloudflare (Pages, Workers, Durable Objects, R2), Python runs on Modal and the database is Neon Postgres. See [ADR 0003](../adr/0003-pilot-platform-architecture.md).

## Design sources

- UX kit: https://claude.ai/artifact/WKq3HJJWYL15oY4nXNBweC (offline copy `/Users/yuriifedas/WebstormProjects/poc/docs/ux-kit/index.html`, [GitHub](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/ux-kit/index.html))
- Hi-fi mock: https://claude.ai/artifact/3axrsHDKG5EqDyxu3nZYoJ (offline copy `/Users/yuriifedas/WebstormProjects/poc/docs/ux-mock/index.html`, [GitHub](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/ux-mock/index.html))

## The POC

The archived POC at `/Users/yuriifedas/WebstormProjects/poc` (https://github.com/fedasevich/pathlogy-poc) proved the technology with a vanilla TypeScript viewer, three renderers, a MONAI Label server and 35 research docs. It is reference only. The backlog's source map says which POC doc or file is the spec for each area, and [poc-reference.md](poc-reference.md) has full links to all of it.

## Team

| Person | Role |
|---|---|
| Yurii Fedas | Owner |
