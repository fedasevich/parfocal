# Decisions waiting for the owner

Last updated: 2026-11-02

Each decision lists its options, with the recommended one marked. Write your letter after "Your choice:", or leave it empty to take the recommended option. A short note is welcome where you pick "Other".

To take every recommendation at once, write "all recommended" here: 

## What your answers of 2026-11-02 changed

| Answer | What changed |
|---|---|
| 16a, names inside slide files | SEC-028 (identifying text in de-identified originals) blanks the identifying byte ranges with spaces when serving, and the stored original keeps its SHA-256 |
| 17a, barcodes in file headers | SEC-028 also blanks barcode header fields for readers without label rights, SKEL-006 (open the slide in Viv) reads those slides' geometry from `levels.json`, and ADR 0137 (capability tokens for slide bytes) says so |
| 19c, style of a hidden first read | Only the screen switches, and ADR 0131 (decision styles) records that the API will refuse the clashing style once the New review task warning exists |
| 20b, who may delete a project | Any owner, behind a typed confirmation, and on your note it is a soft delete that keeps every review and evaluation and can be restored. Real erasure happens only through the GDPR path. New task PROJ-010 (delete a project) builds it |
| 6a, tofu apply on `parfocal-dev` | Already applied at your yes in chat earlier today, dev only. Staging and production still lack the upload CORS and unfinished-upload rules, which a later plan will show you |
| 22, client state | ADR 0143 (one home per kind of client state) is accepted, with XState only for selected flows where a machine plainly helps |
| 23, charts | ADR 0144 (hand-made SVG charts with visx) is accepted. A chart library comes in only when our own charts break down |
| 24, tables | ADR 0145 (TanStack Table plus Virtual) is accepted |
| 25, frontend testing | ADR 0146 (frontend testing stack on node:test, Storybook and Playwright) is accepted |
| 21d, CAMELYON16 tumor maps | AITUM-003 (areas from the tumor map) stays in review until MLEVAL-005 (tumor map evaluation) makes the maps on Modal dev with a cost cap |

Every other answer took the recommended option, and what was already built stays as built. That covers 18a (site validation sets), 19a and 19b (decision styles), 20a and 20c (sample project), and 21a, 21b, 21c and 21e (case numbers, missing scores, reassigned reviewers and the CI bypass).

## 26. Pilot spend, from STACK-029 (cloud provider, regions and GPU availability)

ADR 0147 (cloud provider, regions and pilot cost) keeps ADR 0003 (pilot platform architecture) and estimates three tenants with 5,000 slides a month at about $140 in the first month when every AI result is imported. Two lines decide the real bill. Keeping every 1 GB original adds $75 of R2 storage each month, so $450 by month 6. Running a built-in model on every slide adds $372 a month for `camelyon-tumor` or $1,581 for `pathosam-hovernext` on an L4. The model minutes are the mock's, not measured. Today Modal stops at its $30 of free credits, which the API container alone uses up within the month, so nothing changes until you choose.

How long are uploaded originals kept?

- a. Keep them while the project exists, and alert at a monthly budget. (recommended, because reviews need the slide)
- b. Delete originals 90 days after upload, which caps storage near $225 a month.
- c. Something else, say what.

Your choice:

What Modal spend limit should the pilot run under, once real pilot work starts?

- d. Keep $0 until the first lab is ready, then raise it to cover the API and ingest only, about $60 of compute a month (the $30 of credits plus a $30 spend limit), with GPU runs off. (recommended)
- e. Raise it to about $500 a month so a few model runs can happen.
- f. Something else, say what.

Your choice:

## 27. Palette, drag and drop and hotkeys, from STACK-014 (command palette, drag and drop, hotkeys)

ADR 0149 (command palette, drag and drop and hotkey registry) keeps the palette the prototype screens already built instead of switching to cmdk, picks Pragmatic drag and drop for the first in-app drag and installs nothing yet, and adds a custom hotkey registry. The registry handles chords such as G then 2 with a 1,000 ms wait, a tap on Z against a hold at the kit's 350 ms, and stays quiet while you type in a field except for keys marked for fields. The dev page `/spikes/hotkeys` shows it working, and the existing screens move onto it one at a time.

Do you accept ADR 0149?

- a. Yes, accept it as written. (recommended, because the spike passes and nothing new is installed)
- b. Accept it, but switch the palette to cmdk now for fuzzy matching.
- c. Something else, say what.

Your choice:

## 28. The lock screen's password field, from IAM-021 (lock screen that returns to the same view)

The kit's lock card asks for a password, but ADR 0031 (idle lock unlocked by signing in again) unlocks through Zitadel with `prompt=login`, and Zitadel asks for the password on its own page. Today the card's Unlock button opens that page and whatever was typed in the card is thrown away, so a person types the password twice.

What should the lock card show?

- a. Drop the password field and keep one Unlock button that opens the sign-in page, with the passkey button kept for IAM-023 (sign in and unlock with a passkey). (recommended, because Parfocal never sees passwords)
- b. Keep the field as drawn and accept the second password prompt.
- c. Something else, say what.

Your choice:

## Notes, no decision needed

- Follow-ups from the parallel backend tasks of 2026-11-02, not questions. OBJ-003 (split, merge and added objects) splits and merges only regions, not cells, takes the merged outline from the client and does not yet refuse a decision that retypes a retired object. AIP-011 (job progress streaming) leaves the tier empty until AIP-003 (tiers Best, Good, Fast), and time a stage waits inside a running step still counts toward its throughput. COLLAB-001 (realtime infrastructure) tested the rooms with a fake Durable Object, so the WebSocket upgrade is untested until a Workers test pool or staging runs it. RSET-005 (import checks and fixes) leaves heatmap storage, the share on tissue for each guess, a cleanup of uploads left waiting in quarantine and a clean refusal of an unreadable `.png` heatmap. CASES-024 does not yet replace a duplicate slide while keeping its reviews.
- The local stack now has a MinIO `storage` service on port 9000. Run `pnpm db:up` once after pulling. Nothing creates the local bucket `parfocal-local` yet, so `pnpm api:dev` fails its first upload until it exists. The command is in `docs/knowledge/uploads.md`.
- The migration chain on `main` is `0039` (admin rights), `0040` (review order), `0041` (inbox mutes), `0042` (first reads), `0043` (muted notifications), `0044` (study templates), `0045` (uploads), `0046` (model runs), `0047` (slide ingest) from INGEST-017 (publish step and slide status), and `0048` (result uploads) from RSET-004 (pairing results with slides), and `0049` (job tries) from AIP-018 (claim cap for failing jobs).
- Migration `0044` (study templates) imports the built-in template content from `parfocal_api.study_templates`, so replaying it later seeds whatever the content is then. TODO: freeze the seed data inside the migration before the first production database.
- The upload spike broke one browser test on `main` because the latency proxy gained an upload byte counter. It was fixed the same hour.
