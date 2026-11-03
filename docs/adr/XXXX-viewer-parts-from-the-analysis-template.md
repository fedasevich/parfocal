# XXXX. Viewer parts from the analysis template

- Date: 2026-11-03
- Status: Accepted
- Deciders: Yurii Fedas, agent
- Backlog: PROJ-005 (analysis templates)

## Context

[ADR 0064](0064-project-api.md) (the project API) stores an analysis template per project, `none`, `sentinel-node` or `cell-review`, and left it as a label until PROJ-005. Doc 37 "Viewer" says the sentinel node template adds its Category card on top of the inspector tabs. The backlog adds the staging hero, the area list and the measure step for sentinel node staging, unsure zones and cell typing for cell review, and only objects, layers, decisions and the opinion form for no template.

Two ways let the viewer know what to show. Each client switches on the template name itself, or the API derives the list of viewer parts from the template and every client reads that list.

## Decision

The `Project` response carries `viewer_parts`, a list of `ViewerPart` values derived on the server from the template by `parfocal_api.analysis_templates.viewer_parts`. Every template gets `objects`, `layers`, `decisions` and `opinion`. `sentinel-node` adds `staging-hero`, `area-list` and `measure-step`. `cell-review` adds `unsure-zones` and `cell-typing`. Nothing is stored, so no migration is needed and changing the template changes the parts at once.

The web app renders the staging cards in a new head slot of the side panel, above the tabs, only when `staging-hero` is in the list, and the area list only when `area-list` is.

## Consequences

- One mapping on the server decides what each template turns on. The web app, the fake API and later clients read a list instead of copying the mapping. The fake API keeps a copy of the mapping, which its tests pin.
- A new template or a part moved between templates is a server change only, as long as the part already exists in the clients.
- `ViewerPart` is part of the API contract. Renaming a value means a client release.
- The measure step, unsure zones and cell typing are listed but not yet gated in the viewer. MEAS-006 (measure as a step of the area) and the cell typing tasks read their part when they are built. REVIEW-004 (staging hero and size scale) and CASE-004 (pre-read ready state) replace the simple Category card.
