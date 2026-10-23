# Overview

## The product

The product is called Parfocal and its domain is `parfocal.eu`. The working name during planning was pathviewer. The repository is `fedasevich/parfocal` and lives at `/Users/yuriifedas/WebstormProjects/parfocal`.

Parfocal is a multi-tenant cloud platform where researchers evaluate AI results on whole slides and doctors review them. Researchers import results made elsewhere or run a model, hand slides to doctors as review tasks, resolve disagreements and sign off an evaluation report. Doctors judge each AI object, fix it, comment and give an opinion, in a simple guided mode or in the full viewer. It is built to research and pilot grade with production-quality code and makes no regulatory claims in v1. The direction changed from hospital sign-out on 2026-10-17 ([ADR 0053](../adr/0053-ai-results-review-direction.md)), and the hospital workflow is kept as ideas.

## Users

Researchers upload slides and AI results, run models, create review tasks, resolve disagreements and sign off evaluations. Reviewers are doctors or pathologists who check AI objects, fix them, comment and fill in the opinion form. Admin is not a separate person but a right a researcher holds, which opens the admin page for people, models, report templates, sources and security without adding access to project data ([ADR 0096](../adr/0096-researcher-and-reviewer-with-admin-rights.md)). Projects add owner, reviewer and viewer roles (IAM-022). The evaluation report is built from blocks, and study templates preset a review task and its report ([ADR 0097](../adr/0097-report-templates-built-from-blocks.md)). Doctors come first: every screen they touch must be simple on first use without hiding the full viewer.

## Scope of v1

- Whole-slide viewing with Viv as the primary renderer, reading every POC-supported format natively.
- Projects with a de-identified or clinical privacy mode, optional cases, a class taxonomy and analysis templates such as sentinel node staging.
- Upload of slides together with their AI results (Parfocal JSON, GeoJSON and QuPath, CSV, masks and heatmaps), result sets per slide, object IDs carried across sets, and model runs on demand with a jobs tray.
- Review tasks with scope, blinding and an opinion form, guided review and the full viewer with Agree, Disagree and Not sure, a disagreement queue, sign-off as a soft lock and an evaluation report with exports.
- Layers, heatmaps, diff and agreement views and an object table, plus interactive segmentation and learning from corrections.
- Threads pinned to object IDs with mentions and blinding, presence, notifications behind one bell and slide comparison.
- Remote sources read in place, link import, webhooks in and events out.
- Sign-up, setup with a sample project, and an admin page.
- GDPR, HIPAA and ISO 27001 readiness. The pilot itself holds only public slides with seeded fake identities.
- Mouse, keyboard, trackpad, tablet with pen, gamepad and SpaceMouse.

Ideas kept from the hospital direction, not planned: the status board, tumor boards, team rota, clinical sign-out reports, co-sign, second opinions from outside, LIS and FHIR intake and the department dashboard.

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
