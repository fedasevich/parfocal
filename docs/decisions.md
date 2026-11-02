# Decisions waiting for the owner

Last updated: 2026-11-02

Each decision lists its options, with the recommended one marked. Write your letter after "Your choice:", or leave it empty to take the recommended option. A short note is welcome where you pick "Other".

To take every recommendation at once, write "all recommended" here: 

## What your answers of 2026-11-02 changed

| Answer | What changed |
|---|---|
| 10b, reviewers see labels on their task slides | `see-labels` is now "In their tasks" for a project reviewer, and ADR 0124 (labels and macros) says so |
| 5b, largest upload | 100 GiB, which is 6,400 parts of 16 MiB |
| 14a, ingest memory | The worker requests 2 GiB with a 4 GiB hard limit |
| 4d, cell sample size | Already a setting: 200 is only the template's preset, and a task takes any count from 1 to 10,000 |
| 4a, built-ins | The five built-ins stay defined in code and seeded into every workspace, so they come from one place and a workspace can still add its own |
| 7a, summary of older records | [One page](project/standing-approval-records.md) for ADR 0054 to ADR 0091 |
| Follow-ups | New tasks for a cap of 3 claims per job, first read questions, a task scope as a list, the two missing forms and the shared test slides bucket |

Every other answer took the recommended option, and ADR 0117 (review order), 0118 (blinding), 0120 (study templates), 0121 (S3 client), 0122 (slide row when ready), 0123 (model runs), 0124 (labels), 0125 (result pairing), 0126 (cell chunks), 0127 (imported cell numbers) and 0128 (streamed result files) are accepted. The blank 12a, 13b and 14b took the recommended option.

## 3. Inbox mutes, ADR 0119 (inbox mutes)

### 3a. Keep or remove mutes

You asked why mutes are needed and said to show all notifications. Mutes are built, and a muted notification is still shown in the inbox under a "muted" filter. A mute only stops its push, its email and its count on the bell's badge, for one project, task or case a person no longer follows.

- A. Remove mutes, so every notification pushes and emails by the person's preferences alone. **Recommended**, because it matches your note, nothing is in production yet, and every notification kind then needs no "gets through a mute" rule
- B. Keep mutes as built
- C. Other

Your choice:

## 4. Study templates

### 4c. Questions of the "Reader study form" and the "Outline quality form"

You asked for drafts. EVAL-011 (reader study and outline quality forms) writes them here for your review.

Your choice:

## 6. Real infrastructure

### 6a. `tofu apply` on the R2 dev bucket `parfocal-dev` for INGEST-028 (upload protocol check on R2)

You wrote yes here. The rules count only a yes in chat for the exact plan, so the plan diff and its cost will be shown in chat first and applied after your yes there.

### 6c. One shared bucket for your test slides, INGEST-029 (shared test slides bucket)

Your public test slides go once into a new R2 bucket `parfocal-fixtures`. Dev, CI and production read it with read-only keys, and only your key writes, so nothing is copied around and a mistake in dev cannot delete them. R2 bills stored GB, not buckets, so this costs the same as one copy: free under 10 GB, then about $0.015 per GB a month. The empty `parfocal-prod` stays and costs nothing.

- A. Create `parfocal-fixtures` with read-only keys after INGEST-028, plan shown in chat first. **Recommended**
- B. Put the slides in `parfocal-dev` and let production read it
- C. Other

Your choice:

## Notes, no decision needed

- The local stack now has a MinIO `storage` service on port 9000. Run `pnpm db:up` once after pulling. Nothing creates the local bucket `parfocal-local` yet, so `pnpm api:dev` fails its first upload until it exists. The command is in `docs/knowledge/uploads.md`.
- The migration chain on `main` is `0039` (admin rights), `0040` (review order), `0041` (inbox mutes), `0042` (first reads), `0043` (muted notifications), `0044` (study templates), `0045` (uploads), `0046` (model runs), `0047` (slide ingest) from INGEST-017 (publish step and slide status), and `0048` (result uploads) from RSET-004 (pairing results with slides).
- Migration `0044` (study templates) imports the built-in template content from `parfocal_api.study_templates`, so replaying it later seeds whatever the content is then. TODO: freeze the seed data inside the migration before the first production database.
- The upload spike broke one browser test on `main` because the latency proxy gained an upload byte counter. It was fixed the same hour.
