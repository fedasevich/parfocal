# Usability study, round 5: protocol

- Status: written 2026-11-23 for PILOT-012 (the round 5 study protocol and thesis tables against round 4). No session has run. Every result below is to be computed by the analysis script, never typed in.
- Format: moderated by default. Moderated or remote is still an open question in [decisions.md](../decisions.md). The section [If the round runs remote](#if-the-round-runs-remote) lists what changes.
- The app side: EXP-014 (the study runs for the participant in one tab, with the round 4 and nur questions), EXP-016 (each study participant starts from the same fresh seeded project, [ADR 0435](../adr/0435-per-participant-study-projects.md)) and EXP-015 (study sessions and traces reach the server and the results page reads them, still being built).
- The analysis: `python3 scripts/study` ([Analysis](#analysis)), tested by `scripts/test_study_round5.py`.

Rounds 1 to 4 tested a clickable prototype in the POC (`poc/study`). Round 5 is the first round on the application itself, at `app.parfocal.eu`, which is a development environment ([ADR 0390](../adr/0390-app-parfocal-eu-is-a-development-environment.md), the deployed app is dev). It keeps round 4's task ids, success idea, metric names, SEQ and SUS so the two rounds sit side by side, and adds nur's per-task questions and timed moderator log.

## Where it goes in the thesis

The thesis outline lives in the private repository `parfocal-thesis` (`sections.toml`). The assignment review asks for "formative usability testing with non-specialist participants", with 3 to 8 people.

| Thesis place | What goes there | From this round |
|---|---|---|
| Section 3.3 (User-centred design process), 3.3.1 Method and participants | The method shared by all rounds: tasks that state a goal, SEQ after each task, SUS at the end, non-specialist participants | [Method](#method), [Questionnaires](#questionnaires-word-for-word) |
| Section 3.3, the closing part on changes carried into the final design | How round 4 compares with round 5, and SUS across rounds 1, 4 and 5 | `comparison.md`, `sus-by-round.svg` |
| Chapter 4, a new section "Usability test of the application". `sections.toml` does not list it yet. The outline review (`notes/structure/fable-proposal.md`, item 6) says a round on the implemented application belongs there | Research questions, participants, tasks, results per task, SUS, findings, the comparison with round 4 | `tasks.md`, `sus.md`, `comparison.md`, `seq-per-task.svg`, the findings from the session logs |
| Appendix D (`app-d`, Usability test materials and results) | This protocol, the task cards, the questionnaires, every participant's row, the notes grouped by task, the raw attempts and the filled session logs | `per-task-comparison.md`, `notes.md`, `attempts.csv`, `sus.csv`, the session files |

## Research questions

For the moderator and the thesis. Participants never see them.

| ID | Question | Tasks |
|---|---|---|
| RQ5-1 | Can people with no medical training reach a slide that waits for review and its case details in the application, as they did in the round 4 prototype? | open-case, patient-details |
| RQ5-2 | Do the cell findings built from the least sure place still lead people to the right cells, and can they answer and retype cells without help? | unsure-place, check-cells, change-type |
| RQ5-3 | Are the whole-slide view, side by side compare and adding scans as easy to find in the application as in round 4? | whole-slide, compare, add-scans |
| RQ5-4 | Can people finish a review, settle a disagreement and draw an outline, the parts the application added after round 4? | sign-out, queue-decision, annotate-area |
| RQ5-5 | How do completion, SEQ and SUS on the application compare with the round 4 figures on the prototype? | all |

## Method

- Formative usability test, moderated, one participant at a time, think aloud. The moderator sits beside the participant, watches and keeps the timed log. The moderator does not hint, explain the interface, defend the design or say where to click.
- Results are described only: counts, medians, ranges and means. With 3 to 8 people there are no significance tests and no claims beyond these people.
- No time limit. "I can't find it" shows after 20 s (`giveUpAfterMs` in `apps/web/src/study/study-copy.ts`), and the participant picks a reason. The task card can be started 5 s after it shows (`readDelayMs`, the same 5 s as round 4's `READ_DELAY_MS`).
- The participant uses the application as a reviewer in their own fresh study project. Nothing they do reaches another participant's project.

## Participants

- 3 to 8 people with no medical or pathology training, from the owner's network. Never a pathologist, by the owner's rule.
- Prefer people who did not take round 4. A round 4 participant may take part, and the session log says so in its header, because they saw the prototype.
- No screener in the app. The log header records the device, browser and whether the person took an earlier round.

## Consent and anonymous codes

The participant page at `/study` opens on a consent screen. Its cards say, word for word:

- "We test the app, not you. If something is hard to find, that is what we want to learn."
- "11 short tasks. Reach each goal your own way. The moderator watches but does not help."
- "Think aloud. Say what you look for and what you expect to happen."
- "This tab is recorded. Screen, mouse movements, clicks and key presses. No camera, no microphone."
- "You stay anonymous. Your code is P-XXXX."

The participant presses "I agree and start" to give consent. The app makes the code from `P-` and four characters (capital letters without I and O, and the digits 2 to 9) and stores only that code. Session files use P-01, P-02 and so on in session order, with the app code in the header, as nur does. The pairing of a code and a real person is never written down. TODO: agree how long recordings are kept after the thesis is submitted.

## Setup per participant

Once per study day:

1. Sign the study browser in to `app.parfocal.eu` as the shared study seat account (the lead's call under the moderated default, in ADR 0435 on per-participant study projects). Turn off ad blockers for the site, because they stop the recorder.
2. Open `/study/console` in a second tab. Check that the current round holds the 11 tasks below.

Before each participant:

1. Open `/study` and keep this one tab for the whole session. The code lives in the tab's session storage (`participant-run.ts`), so a new tab makes a new code that no seeded project matches. If the thank-you screen of the last participant shows, press "Start the next participant". Read the new code on the consent screen, for example `P-7KQ2`.
2. Seed that participant's fresh project, from the repository root with the Neon, Cloudflare and R2 settings in the environment (`NEON_API_KEY`, `NEON_PROJECT_ID`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`):

   ```
   uv run --package parfocal-deploy python -m parfocal_deploy.study seed P-7KQ2 --seat "$STUDY_SEAT_EMAIL"
   ```

   It makes the project "Study P-7KQ2" in the workspace `cvut-study` with the review slides, the disagreement queue, the annotate slide and the 12-cell typing task, all in one fixed order (the log entry of EXP-016 on fresh participant projects, and ADR 0435 on per-participant study projects). Locally it took 1.32 to 1.73 s ([results/2026-11-23-participant-seed-time.md](../results/2026-11-23-participant-seed-time.md)). The deployed time is TODO in that result.
3. In the second tab, open Projects and check that the list shows "Study P-7KQ2". Then reload the `/study` tab, the same tab, so the page finds the project. Without the project the task card's "Start task" does nothing, because its start link cannot be filled.
4. Fill the log header and hand the laptop over.

After each participant:

1. On `/study/console`, press "Download results". Rename the file `study-round-1.json` to `YYYY-MM-DD-P-XXXX.json` and keep it outside the repository. The console's round number is its own counter and starts at 1, so the file name says nothing about study round 5.
2. Remove the project, because the shared seat sees every live study project (ADR 0435, per-participant study projects): `uv run --package parfocal-deploy python -m parfocal_deploy.study remove P-7KQ2`. It is a soft delete, so the rows stay until a full reset.
3. Copy the replay times into the session log while the session is fresh.

## Tasks

Round 5 has 11 tasks (`round5Tasks` in `apps/web/src/study/study-model.ts`). The backlog line for PILOT-012 (this protocol) says 13, but the code on main and the log entry of EXP-014 (the participant study page) both have 11, and this protocol follows the code. Nine keep a round 4 task id, two are new, and round 4's task 9, upload-problems, has no round 5 task.

"Goal" is the text the participant reads in the task bar. "Against round 4" says whether that text is the same as round 4's goal in `poc/study/public/study.js`. "Ends by" says how the app closes the task: an automatic check of the page, or the participant pressing "I'm done". Round 4 checked every task automatically, so round 5's success for an "I'm done" task is what the participant claims until the moderator scores it ([Analysis](#analysis)).

| # | Id | Goal as the participant reads it | Round 4 task | Against round 4 | Success rule, scored by the moderator | Ends by |
|---|---|---|---|---|---|---|
| 1 | open-case | Find the slide that is waiting for your review in this project and open it. | 1, open-case: "Find the urgent case for the patient Marie Nováková and open it." | Reworded. The application has slides in a project, not a named patient's case | The slide "Study review 1" of the review task is open | Automatic, the address is that slide |
| 2 | patient-details | Open the case information and find the name of the doctor who sent this case in. | 2, patient-details | Same text | The case information is open and the participant says the sending doctor's name aloud. The moderator compares it with the screen | I'm done |
| 3 | unsure-place | The AI is unsure about some cells on this slide. Go to the place where it is the least sure. | 3, unsure-place | Same text | The place the cell findings list first as least sure is open, or one of its cells is selected. The pilot fixes which place that is | I'm done |
| 4 | check-cells | The AI was unsure about some of the cells in this place. Give your answer for at least 4 of them. Any answer is fine. | 4, check-cells | Same text | At least 4 unsure cells have an answer | I'm done |
| 5 | change-type | Find a cell the AI calls a tumor cell that you think is an immune cell. Change its type to immune. | 5, change-type: "Look at the selected cell. It is an immune cell, not a tumor cell. Change its type to immune." | Reworded. Round 4 preselected the cell, round 5 asks the participant to find one | A cell's type is set to immune. The app's check passes on any changed type, so the moderator checks it was immune | Automatic, any type other than keep is chosen |
| 6 | whole-slide | Quickly bring up a view of the entire tissue scan, then get back to the close-up you were looking at. | 6, whole-slide | Same text | The whole slide was visible, then the participant is back at the close-up. Round 4 also required at least 1 s of peek, which the app does not measure | I'm done |
| 7 | compare | This case has a second slide. Show it next to the slide you are reading. | 7, compare: "This case has a second H&E slide, A2. Show it next to the slide you are reading." | Reworded. Round 5 does not name the slide | The case's second slide is shown beside the first. The app's check passes on any second slide, so the moderator checks which one | Automatic, the address has `with=` |
| 8 | add-scans | New scans for this patient have just arrived on your computer. Start adding them to this case. | 8, add-scans | Same text | The upload page is open | Automatic, the address is the upload page |
| 9 | sign-out | You have finished reviewing this slide. Submit your review. | 10, sign-out: "You have finished reviewing this case. Sign it out." | Reworded. The application submits a slide review instead of signing out a case | The review of the slide is submitted | I'm done |
| 10 | queue-decision | Two reviewers disagree about some slides. Open the first one and give your decision. | none | New | The first slide in the disagreement queue is open and a decision is recorded on one of its disagreements | I'm done |
| 11 | annotate-area | Draw an outline around one area of tumor on this slide and save it. | none | New | A closed outline is saved on the annotate slide. Participants are not specialists, so any area counts, and the moderator notes whether it sits on tissue | I'm done |

Round 4's task 9, upload-problems ("Some of the files you are uploading have a problem. Deal with every file that needs your attention."), has no round 5 task, so the per-task comparison shows it with round 4's figures only.

## Metrics

Each task record in the export keeps round 4's field names (`TaskRecord` in `study-model.ts`).

| Field | Meaning in round 5 | Against round 4 |
|---|---|---|
| `success` | true when the automatic check passed or the participant pressed "I'm done", false after "I can't find it" | Round 4 had no give-up and ended every task by a check |
| `durationMs` | From "Start task" to the end of the task | Same idea, after the same 5 s read delay |
| `clicks` | Every pointer press in the application, not on the study's own bar, drag starts included | Same rule: round 4 counted every `pointerdown` inside the app frame (`study.js`, line 216) |
| `deadClicks` | A click in the application, not on the study's own bar and not a drag of 5 px or more, on no control (`clickableSelector` in `apps/web/src/study/task-metrics.ts`), after which neither the page nor the slide camera changed from the press to 800 ms after the release (`deadClickWindowMs`) | Round 4's rule, below. Round 5 judges "reacts" by a page or camera change because the app has no list of clickable attributes |
| `silentControlClicks` | The earlier round 5 rule: a press on a control after which nothing on the page changed within 800 ms | Round 4 did not measure it. Kept beside the round 4 rule. Sessions recorded before EXP-019 (round 5 measures dead clicks and time to first action as round 4 did) hold this earlier rule in `deadClicks` and the first press, key or wheel in `timeToFirstActionMs`, and they have no `silentControlClicks`, which is how to tell them apart |
| `timeToFirstActionMs` | From the task start to the first click that is not dead, or the first key outside a text field after which the page changed within 800 ms | Round 4's rule, below. Round 4 knew which keys ran an action, round 5 needs the page change |
| `timeToFirstInputMs` | The earlier round 5 rule: from the task start to the first press, key or wheel | Round 4 did not measure it |
| `blocked` | Times the task guard stopped the participant leaving the task's screen | Same idea, different screens |
| `keys`, `wheels` | Key presses outside text fields, and wheel gestures at most one per 100 ms | Same names |
| `seq` | The SEQ answer, 1 to 7 | Same question and scale |
| `notes` | Like, dislike and recommend after the task, optional | New, from nur |
| `reason` | The give-up reason | New |

The export also holds `firstClickCorrect` and `pathStraightness`. Not in the export: round 4's expert time per task.

### Round 4's dead click and time to first action

Read from `poc/study` (never modified) and the round 4 deck, which `poc/study` does not contain.

- Dead click. `poc/study/public/proto.js`, lines 2484 to 2498: a `click` listener on the app frame `#app`. A click first closes an open popover (`ui.pop`) or compare picker (`ui.cmpPick`) when it lands outside them, and that click is not dead. Otherwise it is an action when its target is inside `[data-itab]`, `[data-tool]`, `[data-cell]`, `[data-act]` or `[data-go]`. Every other click calls `studyHook('deadclick')` at line 2498, and `poc/study/public/study.js`, lines 337 to 339, logs it as `dead` and adds one to the task's `deadClicks`. There is no time window: a control that did nothing is never dead, a click on empty space always is.
- The dead click share. Its denominator is `clicks`, every `pointerdown` inside `#app` during a task (`study.js`, lines 216 to 220). The deck's 42 of 277 (slide 05) is the sum of `deadClicks` over the sum of `clicks`, and its speaker notes say "clicks inside the app on something that does nothing". 13 were on zone outlines and 15 on magnification numbers that the mock drew as pictures (slide 07 notes).
- Time to first action. No code in `poc/study` computes it, and `public/results.js` shows only success, time, SEQ, clicks, dead clicks and screens. The only definition is the deck's, slide 05 speaker notes: "the first real action of a task", timed "from the task appearing to that action". How the deck mapped that onto the event log is not written down. Our reading: the task appears at `task-start` (`study.js`, line 469, when the participant presses Start task). The task card shows 5 s before that (`READ_DELAY_MS`, `study.js`, line 8) and is not logged, and a 4.8 s median could not start at the card. A real action is a click or key the mock handled: most write an `act` entry (`study.js`, line 335, from `act()` in `proto.js`, line 2267, for `data-act`, `data-go` and `data-cell` clicks and most shortcuts), while tool and tab clicks and some keys (`proto.js`, lines 736 to 743) only show as a `state` or `screen` entry. Dead clicks and wheel turns are not actions, and the mock had no wheel zoom. This reading is an open question for the owner.

Round 5 follows both on the real app in `scoreTask` in `apps/web/src/study/task-metrics.ts`. What still differs, one sentence each:

- Dead clicks: round 5 decides whether a click on no control reacted by any page change or slide camera move from the press to 800 ms after the release, which also covers an overlay closing, but a click that changes only the WebGL drawing and nothing else on the page counts as dead, and leaves out drags of 5 px or more, because on the real slide a drag pans or draws, where round 4 counted any press and release on the same element as a click.
- Time to first action: round 5 counts a key as the first action only when the page changed within 800 ms after it, where round 4's mock knew which keys ran an action.

## Questionnaires, word for word

From `apps/web/src/study/study-copy.ts`. The SEQ and the SUS items are the same as round 4's (`poc/study/public/study.js`, lines 78 to 90).

After each task:

- SEQ, required: "Overall, how difficult or easy was this task to complete?" from 1, "Very difficult", to 7, "Very easy".
- Optional, from nur's decision 0013 (likes, dislikes and recommendations after each task): "What did you like in this task?", "What did you dislike?", "What would you recommend?"
- After "I can't find it", one reason: "I did not know where to look", "I looked in several places and found nothing", "I was not sure what the task asked for", "Something did not work as I expected" or "Another reason".

At the end, the SUS, each item from 1, "Strongly disagree", to 5, "Strongly agree", scored as in round 4 (odd items minus 1, 5 minus even items, the sum times 2.5):

1. I think that I would like to use this system frequently.
2. I found the system unnecessarily complex.
3. I thought the system was easy to use.
4. I think that I would need the support of a technical person to be able to use this system.
5. I found the various functions in this system were well integrated.
6. I thought there was too much inconsistency in this system.
7. I would imagine that most people would learn to use this system very quickly.
8. I found the system very cumbersome to use.
9. I felt very confident using the system.
10. I needed to learn a lot of things before I could get going with this system.

Then four optional open questions, with Back and Next inside this block only:

1. "What did you like?"
2. "What did you dislike?"
3. "Was there anything you expected to find but could not?"
4. "What would you recommend?"

Round 4 asked three open questions: "What was the most confusing or frustrating moment?", "What, if anything, did you like?" and "Was there anything you expected to find but could not?" (`study.js`, lines 91 to 95). Only the third is the same in both rounds.

## Moderator script

Say this, and nothing else about the application.

1. Before consent: "Thank you for coming. We are testing an application, not you. If something is hard, that is exactly what we want to find. Please say aloud what you look for and what you expect to happen. I will watch and take notes, but I cannot help you during the tasks. Read the screen and start when you are ready."
2. During tasks, only non-leading prompts: "What are you looking for now?", "What do you expect to happen?", "What would you try?" If asked "where is X?", answer "What would you try?"
3. When the participant goes quiet for a while: "What are you thinking?"
4. Do not end a task yourself. The participant decides when to press "I'm done" or "I can't find it". There is no moderator cut-off for a task without progress (decision 177, option B, 2026-11-25).
5. After task 11, before the last questions: go through the log lines marked `ASK`, in order, and ask open questions about them ("At this moment you stopped. What were you looking for?"). Write the answers word for word.
6. After the last questions: "Thank you, that is all." Ask nothing more.

## Timed log template

Copy this block to `YYYY-MM-DD-P-XXXX.md` outside the repository for each session. It follows nur's `docs/testing/sessions/_template.md`. Fill it from what the moderator saw and heard and from the replay of the session. Never fill a gap from memory. Write `TODO` where something is unknown.

```
# Session P-NN

| Field | Value |
|---|---|
| Date and start time | YYYY-MM-DD HH:MM (Prague time) |
| Place and format | moderated, beside the participant |
| Moderator | name |
| Participant | P-NN. No name |
| App code | P-XXXX, from the consent screen |
| Device and screen | laptop, browser, system, window size |
| Earlier rounds | none, or the round they took |
| Project | Study P-XXXX, seeded at HH:MM, removed at HH:MM |
| Recording | replay of P-XXXX, or "none" and why |
| Pilot or dry run | no, or yes (then the analysis excludes it) |

## Timed log

00:00 is the start of the replay. One line for every task start and end, and for anything odd: a pause, a wrong turn, going back, a workaround, a question, a comment, a click that does nothing, a bug. Mark lines to ask about at the end with ASK.

| Time | Task | What happened | Type | ASK |
|---|---|---|---|---|
| 00:00 | | Replay starts after consent | start | |
| mm:ss | open-case | Pressed "Start task" | start | |
| mm:ss | open-case | ... | action | |
| mm:ss | open-case | Task ended | end | |

Types: start, end, action, hesitation, wrong turn, back, workaround, stuck, asked for help, comment, bug, dead click, gave up.

## Per task (one block per task)

### open-case

| Field | Notes |
|---|---|
| Result in the app | done, or gave up with the reason |
| Scored success | yes or no against the success rule in the protocol, and why |
| Time | mm:ss to mm:ss |
| Path taken | screens and controls in order |
| Hesitation, errors, backtracking, workarounds | |
| Comments (word for word) | |
| SEQ | |
| Liked / Disliked / Recommends | as typed, or - |

patient-details only: the doctor's name said aloud, correct or wrong.
change-type only: the type chosen.
compare only: which slide was shown beside.

## Open questions at the end

| Time in log | Question asked | Answer (word for word) |
|---|---|---|

## Problems seen in this session

| Evidence (time, task, what happened) | Usability problem | Impact on this participant | Severity guess (0 to 4) |
|---|---|---|---|
```

## Pilot run

Before the first real participant, run the whole session once with someone who will not be a participant, on the deployed app, with the same browser and the same steps.

- Seed a code, run all 11 tasks, the questions and the download, then remove the project.
- Check every start link opens, every automatic check fires, the guard blocks only wrong turns, and the replay plays.
- Fix the expected screen for each moderator-scored rule, chiefly which place is least sure in unsure-place and what a submitted review and a recorded queue decision look like.
- Check that the case information of "Study review 1" names a doctor who sent the case in. The participant seed (`workers/ingest/src/parfocal_ingest/study_seed.py`) does not mention one, so if the screen has none, patient-details cannot succeed and must change before the first session.
- Time the seed on the deployed app and record it in the seed time result.
- Time the whole session. TODO: write the measured length here after the pilot.
- Write down the pilot code. Its session is excluded from the analysis with `--exclude`, like any dry run.
- The pilot session itself freezes the console round's tasks, because a round with a session cannot change. If the pilot changes a task, press the console's button for the next round, edit that round's task set there before any real session, also change `round5Tasks` in the code so the two agree, and analyse with `--round` set to the new round's number.

## If the round runs remote

Decision 176 chose remote and moderated. Before the call, the moderator opens `/study/console` in the study workspace, types or leaves empty the code, presses "Make a join link" and sends the link. It works once, for one day, and signs the participant into a seat of their own on their project with no account (EXP-020, a prepared participant joins by one link). "Remote participants" on the console shows whether the link was opened and how many tasks are done. If the owner answers "remote" in decisions.md:

- Each participant needs their own seat on their project, which the join link gives, because a shared seat would let one participant see another's project.
- With a moderator on the call, the consent cards, the think-aloud, the timed log and the `ASK` questions stay. Only an unmoderated round would drop them and score the seven "I'm done" tasks from the replay.
- The setup steps move before the link is sent, and the export is taken from the server results of EXP-015 (study sessions reach the server) instead of one browser's console.
- Everything else stays: tasks, questionnaires, metrics and the analysis.

## Analysis

Standard library Python, in `scripts/study/`:

```
python3 scripts/study round5/*.json --exclude P-PILT --scored round5/scored.csv --out round5/tables
```

- Input: the console's "Download results" JSON (the whole study state), a list of sessions, or a CSV with the same field names and one row per task attempt (`participant`, `session`, `round`, `id`, `idx`, `title`, `success`, `durationMs`, `clicks`, `deadClicks`, `blocked`, `keys`, `wheels`, `seq`, `like`, `dislike`, `recommend`, `reason`, and optionally `silentControlClicks`, `timeToFirstActionMs`, `timeToFirstInputMs`, `sus1` to `sus10`, `susScore` and `final.like` and so on). Several files merge by session id.
- Excluded: sessions marked `dryRun`, `dry` or `pilot`, every code given with `--exclude`, and sessions with no task records. When two files hold the same session, the finished or fuller copy wins.
- `--scored` takes a CSV with `participant`, `task` and `success`, the moderator's scoring against the success rules above. The tables say how many attempts it scored, and a row that matches no included attempt is listed as a warning. Without it, the success column is what the app recorded, and every table says which source it used.
- `--round` keeps one console round only.
- SUS is recomputed from the ten answers. A session with an unanswered item is shown but not scored. Numbers are rounded half up.

Outputs in the `--out` folder, each with its thesis place written in the folder's `README.md`:

| File | What it holds |
|---|---|
| `tasks.md`, `tasks.csv` | Per task: success, gave up, median and range of time for successful attempts, median and range of clicks, dead clicks, SEQ mean, median and range, SEQ 6 or 7, blocked |
| `sus.md`, `sus.csv` | SUS per participant and the mean |
| `comparison.md`, `comparison.csv` | Round 4 against round 5, each figure labelled with its source and a note saying in one sentence what still differs. The earlier round 5 rules for dead clicks and first action sit in their own rows |
| `per-task-comparison.md`, `.csv` | Round 4's median time and SEQ per task from the deck beside round 5's, with a comparability note per task: reworded goals, and round 5 times that include pressing "I'm done" |
| `notes.md` | The per-task notes, give-up reasons and final answers, grouped by task and quoted |
| `attempts.csv` | One row per included attempt, in the CSV input format |
| `seq-per-task.svg` | SEQ per task, round 5's mean as a bar with round 4's figure as a mark |
| `sus-by-round.svg` | SUS per participant in rounds 1, 4 and 5 |

The tables of a real round are a result. When they exist, they go into `docs/results/` with a result file. The tables from the test fixture are never committed.

## Where every number comes from

Round 4 and round 1 numbers are quoted from the round 4 deck, "Viewer Usability Study, Round 4" (an HTML file kept by the owner outside the repository, dated 2026-10-13), and never recomputed. The script holds them in `scripts/study/round4.py`, and each table cell names its slide.

| Figure | Value | Source |
|---|---|---|
| Round 4 participants and tasks | 4 friends, 10 tasks, unmoderated, no hints, no timer | Deck, slide 03 (Study · method) |
| Round 4 tasks completed | 40 / 40 | Deck, slide 04 (Study · results) |
| Round 4 mean SEQ | 6.4 / 7 | Deck, slide 04 |
| Round 4 tasks rated 6 or 7 | 35 of 40, none below 4 | Deck, slide 04 |
| Round 4 mean SUS | 83.8 | Deck, slide 04 |
| Round 4 SUS per participant | P1 100, P2 95, P3 80, P4 60 | Deck, slide 04 |
| Round 4 dead clicks | 15% of clicks hit nothing (42 of 277), 29 of 40 tasks had none | Deck, slide 05 (Study · movement metrics) |
| Round 4 median time to first action | 4.8 s | Deck, slide 05, defined in its speaker notes |
| Round 1 SUS | 52.5, one participant | Deck, slide 06 (Study · before and after) |
| Round 4 median time and SEQ per task | 5.9 s and 7.0 for open a case, and so on for all ten tasks | Deck, slide 07 (Study · per task) |
| Round 4 task texts, success rules and metric names | | `poc/study/README.md` and `poc/study/public/study.js` |
| Round 5 tasks, checks and questions | | `apps/web/src/study/study-model.ts` and `study-copy.ts` |
| Round 5 figures | | Computed by `python3 scripts/study` from the export, never typed |
| Seed time | 1.32 to 1.73 s locally, 29 s on the deployed app through the console and 36.3 s with a cold seed function ([results/2026-11-24-study-prepare-dry-run.md](../results/2026-11-24-study-prepare-dry-run.md)) | [results/2026-11-23-participant-seed-time.md](../results/2026-11-23-participant-seed-time.md) |

## Open items

- Remote and moderated (decision 176, 2026-11-25): the participant opens a prepared link in their own browser while the moderator watches over a call, built by EXP-020 (a prepared participant joins a remote moderated session by one link).
- No moderator cut-off for a task without progress (decision 177, option B).
- Raw traces and answers are kept until the thesis is defended and backed up to R2 meanwhile, then the traces are deleted and only the anonymous tables and notes stay (decision 180, option A with a backup, built by EXP-022, study recordings are backed up to R2 and deleted after the defence).
- TODO: the session length, from the pilot.
- The server marks dry runs. The console's Dry run tick sets `dry_run` on a session, the results page leaves those out, and the EXP-018 dry run sessions were marked so on 2026-11-24.
