# 0067. Each project has up to nine classes on keys 1 to 9, checked by CIEDE2000 under three colour-vision deficiencies, with remembered import mappings

- Date: 2026-10-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: PROJ-004 (class taxonomy per project), touches DS-002 (colour measurement scripts in CI), RSET-005 (import checks and fixes), PROJ-007 (new project and new case) and PROJ-008 (project settings)

## Context

POC [doc 37](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/37-ai-results-review-rework.md) gives each project a class taxonomy with names, colours and keys 1 to 9, started from a template such as PanNuke or sentinel node. An import that uses other class names, such as "Neoplastic" or "tumour_cell", maps them to the project's classes once and remembers the mapping. People pick colours for their own classes, so the API has to refuse colours that cannot be told apart. [Doc 35](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/35-ui-ux-for-pathologists.md) measured the kit's classes with CIEDE2000 after Machado simulation, and DS-002 plans the same check in CI for the design tokens. That check is JavaScript, but the API needs it in Python.

## Options considered

### Where the colour check runs

1. Only in the web form. It is fast feedback, but an API client or a later screen could store colours that clash.
2. In the API, with a Python port of the POC script, and the same limits later in DS-002 for the tokens. The port matches the POC to the last digits ([result](../results/2026-10-17-class-colour-separation.md)).

### How a taxonomy changes

1. One route per class (add, rename, recolour, delete). Each step would have to pass the colour check against the classes left, so swapping two keys or two colours needs an order the user does not care about.
2. Replace the whole list in one request. Classes keep their IDs when the request names them, so remembered mappings survive a rename or a recolour, and the check runs once on the final list.

## Decision

Option 2 in both cases.

- `project_classes` holds `id`, `project_id`, `key` (1 to 9, unique in the project, checked at commit so keys can be swapped), `name` (up to 60 characters, unique in the project ignoring case) and `colour` (`#rrggbb`, stored in lower case), in migration `0021`.
- `class_mappings` holds a source name, trimmed and case-folded, and the class it maps to, keyed on the project and the name. Removing a class removes its mappings.
- Two classes must be at least 15 apart in CIEDE2000 under normal vision and under simulated protanopia, deuteranopia and tritanopia. Every class must also be at least 13 from white (unsure zones on the slide), 40 from the AI proposal black and 15 from both unsure panel colours. A refusal is 400 `colours-too-close`, with a detail that names the classes, the vision and the distance.
- Templates live in code (`parfocal_api.class_templates`). Sentinel node is Tumor, Stroma, Immune and Other in the kit's colours. PanNuke is Neoplastic, Inflammatory, Connective and Dead in the same colours, plus Epithelial in #43999d.

| Operation | Path | Rule |
|---|---|---|
| `listTaxonomyTemplates` | `GET /api/taxonomy-templates` | Any workspace member |
| `createProject` | `POST /api/projects` | Takes an optional `taxonomy` template that fills the classes |
| `listProjectClasses` | `GET /api/projects/{id}/classes` | Any project role, or emergency access |
| `setProjectClasses` | `PUT /api/projects/{id}/classes` | Owner only, not while archived. Replaces the list |
| `listClassMappings` | `GET /api/projects/{id}/class-mappings` | Any project role |
| `rememberClassMappings` | `PUT /api/projects/{id}/class-mappings` | Owner only. Adds or changes mappings, and the class must be in the project |
| `resolveClassNames` | `GET /api/projects/{id}/class-mappings/resolve?name=...` | Any project role. A remembered mapping wins, then a class with the same name, otherwise none |

Each change is audited as `project.taxonomy-changed` (with the class, added and removed counts) or `project.mappings-changed`.

## Consequences

- PROJ-004 no longer waits for DS-002, because the API carries its own port. DS-002 should use these limits for the tokens.
- RSET-005 (import checks and fixes) calls `taxonomy.resolve_names` for the class names it finds and offers the rest for mapping.
- Removing a class that result sets use must be handled once result objects exist. TODO: RSET-001 (result set model) decides whether a class in use can be removed.
- TODO: the design owner should confirm #43999d for Epithelial in the UX kit.
