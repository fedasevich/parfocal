# Pilot data onboarding

The runbook for bringing a pilot lab's slides and AI results into Parfocal, written for PILOT-004 (pilot data onboarding). The tool is `parfocal_api.bulk_import`, described in [uploads.md](uploads.md#bulk-import-from-a-folder). The rehearsal with public slides is in [the result file](../results/2026-11-15-pilot-import-rehearsal.md).

File names and folder names can hold patient data. Never paste the command's output, a file list or a screenshot of the folder into `docs/`, a commit, an issue or a chat. Log counts only.

## Before the day

- The lab's workspace and project exist through the normal setup flow ([ADR 0267](../adr/0267-sign-up-and-setup-flow.md), the sign-up and setup flow). Note the project id from its URL.
- The pilot's data processing agreement is signed ([compliance/dpa-template.md](../compliance/dpa-template.md)) and the project's privacy mode is the one the agreement names.
- Uploading to production is an additive write under [ADR 0151](../adr/0151-standing-approval-for-production-within-30-dollars.md) (standing approval within $30 a month). Check that the sample's size keeps R2 inside the month's budget in [platform.md](platform.md), and ask the owner first if it does not.
- A workspace admin creates a service account with the scopes `see-slides`, `create-cases` and `upload-slides` and issues a token that expires in a few days. Keep the token only in the shell's environment, never in a file.

## Prepare the folder

The command takes cases from names, with the same rules as a browser drop (`parfocal_common.sorting`).

- A folder below the top folder names the case of every slide in it, so one folder per case, named with the case number, is the safest layout.
- Otherwise a slide's file name names its case when its first part, before `_` or a space, looks like a case number: 1 to 8 letters, up to 4 digits, a dash and 2 to 12 digits, such as `S26-04812`.
- An AI result pairs with its slide when it sits next to it with the same name, such as `A1_HE.svs` and `A1_HE.geojson`, when its name starts with the slide's name, or when the file names its slide inside ([reference/parfocal-results-v1.md](../reference/parfocal-results-v1.md)).
- Remove notes, spreadsheets and anything else that is neither a slide nor a result. Hidden files and a top-level `manifest.csv` are skipped.
- When the names carry no case numbers, or patient details should come along, write a `manifest.csv` instead and run without `--cases-from-names`. That mode sends slides only, so add results afterwards in the app.

## Run it

From the repository root, with `PARFOCAL_API_TOKEN` set:

```sh
uv run --package parfocal-api python -m parfocal_api.bulk_import FOLDER --project PROJECT_ID --api https://app.parfocal.eu --cases-from-names --dry-run
```

The API is reached through the edge Worker, which applies rate limits and a bot check ([deploy.md](deploy.md)). TODO: no command-line client has gone through that path yet, so try the dry run with a tiny folder first and read any 403 or 429 before the real batch.

1. Read every line of the dry run. Each slide shows its case and each result its slide. A slide with no case number, a result that matches no slide or several, or any other file stops the run before anything is created. Rename or move files until the dry run ends with `0 failed` and the case count you expect.
2. Run the same command without `--dry-run` and with `--wait 3600`. Large slides take a while, and the command can be stopped and started again: it resumes open uploads and skips slides already in their case and results already imported.
3. A result whose classes or values need a choice ends `waiting needs-choices`. Make the choices in the app's upload page, or run once more with `--import-as-is` when the defaults are fine for the pilot, which imports the objects that passed the check.
4. Run the command a last time. It must send nothing and end with exit code 0.

## Check and close

- In the app, compare the project's case count, slides per case and AI results per slide with the lab's list.
- Revoke the token, and disable the service account if no second batch is planned.
- Add a log entry with `board.py note` that holds the counts, the time taken and the storage added, with no file names.

## Rehearse without the pilot's data

`PARFOCAL_PILOT_REHEARSAL=1 uv run --package parfocal-api pytest tests/test_pilot_rehearsal.py -m db -q` from `apps/api` runs the whole flow on the local stack with four public slides from the fixture cache, through `main()` with a real service account token, and deletes its objects afterwards. It needs `pnpm db:up` and the slides in `~/.cache/parfocal/fixtures`.
