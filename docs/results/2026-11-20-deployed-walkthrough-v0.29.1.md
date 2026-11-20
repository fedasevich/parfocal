# Deployed walkthrough of app.parfocal.eu on v0.29.1

Walked on 2026-11-20 between 21:15 and 22:30 on app.parfocal.eu after release v0.29.1 and its reseed, in the workspace ČVUT Biomedical Engineering, which holds the seeded cases. This is the second round of backlog task TEST-056 (a walkthrough artifact of the whole deployed app). The first round is [2026-11-20-deployed-walkthrough.md](2026-11-20-deployed-walkthrough.md), on v0.28.1.

Only one account could be signed in, the agent test account agent-walk, by the script scripts/agent_session.py. It is a researcher with admin rights and an owner of all three projects, and the seed now also makes it the adjudicator of RT-3 (Disagreement queue example), a reviewer of one review task, an expert on one annotate task and the receiver of one co-sign request. The reviewer and viewer sides of other people were seen only as the read only state. No account was created and the owner's account was not used.

Of the 27 steps that were broken in round one, 22 are fixed, 3 are partly fixed and 2 are still broken.

This round walked 128 steps. 95 work and 33 are broken. It found 22 new issues: 1 high, 9 medium and 12 low.

The app itself does not say which release it runs. /api/status names none, so v0.29.1 is taken from the release tag and the log of VIEW-076 (slides that arrive as a MIRAX or DICOM zip open in the viewer).

GPU and model calls: Best was clicked twice in Smart select. The first click sent two POST /embeddings/view calls, so at least two GPU calls were asked for. Whether the second click sent more was not recorded. Two accepted outlines each sent one POST /outline-types call. Cost of these calls: TODO, not measured. No model run was started.

What the walk changed and left: RT-3 (Disagreement queue example) is adjudicated and signed off, the report of Showcase draft report is signed, the report of Showcase co-sign is co-signed, the first slide of RT-1 (Showcase case review) has six decisions and an opinion, the slide of RT-6 (Annotation example) is marked checked, and three notices are read. A reseed brings all of it back. The shapes drawn on two gallery slides were deleted and the share link was revoked. Export on the annotate task was clicked once and changed nothing on the page. Whether a file came down was not recorded.

Five screenshots were saved and two were opened. Three are in the HTML page. The checks that a slide draws counted colours in captures that were never saved.

## Recheck of the 27 broken steps of round one

| # | Area | Step | Now | What happened |
|---|---|---|---|---|
| 1 | Release | Wait for the release, /api/status names it | still broken | The status still answers {"status":"ok","maintenance":null} and names no release. No fix targeted it. |
| 2 | Notifications | Open on a notice on /notifications | fixed | All three notices open their slide through /go/{id}. An unknown id shows a clear page with See all notifications and Go home. |
| 3 | Notifications | Bell, then Open | fixed | The first notice in the bell opens the guided slide of its task. |
| 4 | Projects | Old tab names in the address | partly fixed | ?tab=results and ?tab=report now rewrite the address to ?tab=slides, and ?tab=people to ?tab=settings. There is still no notice. |
| 5 | Slides tab | Click a case header | fixed | The first click folds the open case. |
| 6 | Format gallery | Open the MIRAX zip slide | fixed | CMU-1-Saved-1_16 (MIRAX) draws. tile-access names original.tiff, the thumbnail answers 200, the slide has no result set. |
| 7 | Format gallery | Open the DICOM zip slide | fixed | CMU-1-JP2K-33005-v2 (DICOM) draws with its tumour and cell result sets. |
| 8 | Format gallery | Open Missing file.svs | fixed | The top bar says Could not open, the rail and the tabs are gone. The Select hint card and the Look and Annotate switch are still drawn. |
| 9 | Viewer | Open a slide and watch for writes | partly fixed | A plain open sends no write in 9 seconds. PUT /api/me/setting-layers still goes out on H, on V, on V again, on O, on L, on the Objects tab and on Clear all, so the same hint is written more than once. Each click on a section of Preferences sends the same write. |
| 10 | Drawing | Objects tab after drawing | fixed | The shapes sit under the class name Tumor. They are still under the heading Measurements. |
| 11 | Drawing | Reload and compare IDs | fixed | M1, M2 and M3 keep their numbers after a reload. |
| 12 | Drawing | Clear all | fixed | A window asks "Delete all 4 shapes on this slide?" and ⌘Z brings them back. |
| 13 | Smart select | Arm with S | fixed | The bar has Good and Best, Good is the start, and arming sends no server call. |
| 14 | Smart select | Accept with Enter | fixed | Enter saves the outline. The first Good outline took 12 seconds in headless Chrome with no GPU. |
| 15 | Guided | Guided on a task assigned to someone else | fixed | The coach is gone and only the Read only notice shows. |
| 16 | Cells | Type a cell | still broken | The only cell task still belongs to the owner account, and now the cells address falls back to Review for it. See new issue 2. |
| 17 | Cells | mode=cells on a task with no sample | fixed | The viewer says "This slide has no cell sample, so it opened in Review" and the address becomes mode=review. |
| 18 | Annotate task | My work, Start on Annotation example | fixed | The address is mode=annotate. |
| 19 | Disagreements | A queue that can be worked | fixed | RT-3 (Disagreement queue example) is open with two objects. RT-1 (Every state review) stays locked, as the seed intends. |
| 20 | Adjudication | Adjudicate | fixed | My work, Start opens /tasks/{id}/adjudicate with T1 on Case queue 2. The decision saves and Ada is told. |
| 21 | Evaluation | Close the preview with Esc | fixed | Esc closes the PDF preview. Browser back from ?view=pdf closes it too. |
| 22 | Evaluation | Compare with RT-1 (Every state review) | fixed | Compare and share, then Compare with RT-1 (Every state review), adds a Comparison block with a table, in view without scrolling. Its text is wrong, see new issue 8. |
| 23 | Evaluation | Team says RT-2 (Signed-off review) is signed off | fixed | Team, the report and the sign-off window all say Evaluation v1, signed 20 Nov, by Ada Admin, with a checksum. |
| 24 | Cases | Draft report, Findings to Staging | fixed | Staging passes with no deposit once Examined and Extranodal extension are answered. The report was signed as pN0(sn). |
| 25 | Cases | Co-sign | fixed | Co-sign and sign out is on. The report now reads "Reported by Ada Admin, verified and signed by Agent Tester". |
| 26 | Jobs | Click the finished job | partly fixed | The row has an Open button that opens the slide Philips-4.tiff. The tray still says "click one for its steps", and no steps are shown. |
| 27 | Other routes | /tasks/{id}/submitted | fixed | It goes to the first slide of the task in Review. An annotate task goes to Annotate. |

Round one also ranked five things that had no broken step of their own.

- Console and network noise is partly fixed. Home, the clinical project and My work still ask for the thumbnail of Missing file.svs and get 404. The annotate task asks for decisions and gets 409 only when mode=guided is in the address.
- The browser tab name is partly fixed. Slides, tasks and most pages have their own name. The project page is always "Project", and reports, co-sign, the task wizards, New case, /setup, /sign-up, /invite and /popout are plain "Parfocal".
- Dead ends in addresses is partly fixed. /kpi and /study now sit inside the shell with the menu. /projects/new opens the New project window. /sign-in still shows the form to a person who is signed in.
- A page stuck on Loading Parfocal during a rollout is not rechecked. No rollout happened during this walk.
- Wording and data slips is partly fixed. "Pick who takes the slides." and the numbers in the seeded signed report are right now. "1 slides", "10 reviews not submitted", "1 disagreements not resolved", "Decide 1 objects" and "What he gets back" for Ada are still there.

## New issues

Ranked by how much each confuses or blocks a pathologist.

### 1. A reviewed slide cannot be submitted in the viewer

- Severity is high.
- Route is `/projects/{clinical}/slides/{id}?task={id}&mode=guided and &mode=review`.
- Steps. My work, Start on RT-1 (Showcase case review) in Breast surgery sentinel nodes. Answer all six objects with K, X and U. Answer the opinion questions.
- What happened. Every answer saves, but neither Guided nor Review has a Submit button. The top bar offers only Open report. The API still counts 0 of 3 slides submitted, My work says 0 of 3 slides, and the checklist item "Submit your first opinion form" stays open. The older screen at /tasks/{id}/comments does draw a Submit button. The case of this slide already has a signed report, and the agent account has no review task in a project without cases, so Submit could not be seen working anywhere. Likely cause: apps/web/src/viewer/live-top-bar.tsx line 339 draws Submit only when it does not draw Open report, so a review task on a slide that belongs to a case never gets Submit.
- What should happen. A Submit button after the last answer, as the task flow promises, and the slide counted as submitted.

### 2. Cells mode does not open, and says there is no cell sample next to 12 sampled cells

- Severity is medium.
- Route is `/tasks/{id}/cells and /projects/{gallery}/slides/{id}?task={id}&mode=cells`.
- Steps. Open RT-2 (Cell typing tour) in Scanner format comparison on test_065, CMU-1-Small-Region.svs or the DICOM slide.
- What happened. The viewer opens in Review with "This slide has no cell sample, so it opened in Review". The same screen says "12 sampled cells, 0 decided, 12 open", and Show the cells lists the twelve cells in a strip inside Review. In round one this address opened cells mode read only. The task belongs to the owner account, so no agent account can type a cell and the cells mode itself could not be seen.
- What should happen. Cells mode opens, read only for a person who is not assigned. The seed gives an agent account a cell task of its own.

### 3. "Sign with single sign-on" signs at once, with no sign-in step

- Severity is medium.
- Route is `/tasks/{id}/sign-off, /projects/{clinical}/cases/{id}/report?step=sign, /projects/{clinical}/cases/{id}/co-sign`.
- Steps. Click Sign with single sign-on in the task sign-off window, in the clinical Sign out window and in the Co-sign window.
- What happened. Each click signed and locked the document in one step. Nothing asked who is signing. Admin, Security says single sign-on is not connected.
- What should happen. Either a real confirmation of the person before a signature, or a button that says Sign.

### 4. Best never answered in Smart select

- Severity is medium.
- Route is `/projects/{gallery}/slides/{id}`.
- Steps. Arm Smart select with S, click Best, click a nucleus. Repeat once.
- What happened. The first click sent two POST /embeddings/view calls that had no answer after 10 seconds, and the bar said "Best is not answering yet, Good outlined this view". The second try got no answer either and said the same. Whether it sent a new call was not recorded. GET /embeddings answers 404 each time.
- What should happen. A Best outline, or a visible wait for the GPU as OPS-038 (a GPU call waiting for an EU GPU shows the wait) describes, and a way to ask again.

### 5. "Cells 18,240" is the same on every slide

- Severity is medium.
- Route is `/projects/{id}/slides/{id}?task={id}&mode=review`.
- Steps. Open the Objects tab in Review on five different slides: CMU-1-Small-Region.svs in two projects, test_065, the DICOM slide and Case ai-running.
- What happened. The AI says block reads "Cells 18,240" on all of them. Philips-3.tiff has 4393 cell objects in its annotate task, and the whole cell task has 30625 objects on 13 slides, so the number cannot be real. The /developer page shows the same 18,240 as a sample figure.
- What should happen. The real cell count of the slide's result set, or no number.

### 6. The adjudication notice opens the wrong screen

- Severity is medium.
- Route is `/notifications, then /go/{id}`.
- Steps. Click Open on the notice Objects to adjudicate.
- What happened. It opens Case queue 1 in guided review, read only, with "This slide is assigned to Rhea Reviewer and Remy Reviewer". The object waiting for the adjudicator is T1 on Case queue 2, and its screen is /tasks/{id}/adjudicate. My work, Start does reach that screen.
- What should happen. The notice opens the adjudication screen on the waiting object.

### 7. RT-1 (Every state review) shows slide counts that disagree

- Severity is medium.
- Route is `/projects/{study}?tab=tasks, /projects/{study}/slides/{id}?task={id}, /tasks/{id}/sign-off, /tasks/{id}/disagreements`.
- Steps. Read the task in each place.
- What happened. The project tab says 6 slides and 2 of 6 for each reviewer, and the Reassign window says 2 of 6 slides done. The viewer says Slide 1 of 7. The sign-off window says Rhea Reviewer has 5 slides left, and the disagreements page says she has 4 slides left.
- What should happen. One count in every place.

### 8. The comparison says both tasks cover the same slides when they do not

- Severity is medium.
- Route is `/tasks/{id}/evaluation`.
- Steps. On RT-2 (Signed-off review), Compare and share, Compare with RT-1, Every state review.
- What happened. The Comparison block says "Both tasks cover the same slides". RT-2 (Signed-off review) has 1 slide with 11 objects and RT-1 (Every state review) has 7 slides with 31 objects.
- What should happen. A comparison only over shared slides, or a plain note that the slide sets differ.

### 9. A task that was never started says Signed off and locked

- Severity is medium.
- Route is `/projects/{study}/slides/{id}?task={id}`.
- Steps. Open RT-8 (Tumour annotation) on Case annotate as a person who is not assigned.
- What happened. The Objects tab says "Signed off, this slide is locked. Later changes go to the change log" above "Rhea Reviewer, Not yet". The API says the task is not signed off and the slide is only assigned. The banner says "Read only. Only the people assigned to this task can do that" although nothing was tried, and Find nuclei stays the main button.
- What should happen. The heading says the slide is not signed off yet, and the banner names who the slide is assigned to.

### 10. A task address with a slide outside the task hangs

- Severity is medium.
- Route is `/projects/{gallery}/slides/{id}?task={id}&mode=guided`.
- Steps. Open a gallery slide with the id of RT-1 (Showcase case review) from another project in the address.
- What happened. "Loading the review" stayed for the 8 seconds watched. Five API calls answer 404.
- What should happen. A notice that the slide is not part of the task, with a way to the task or the slide.

### 11. Read only notice with an empty name

- Severity is low.
- Route is `/projects/{study}/slides/{id}?task={id}&mode=guided`.
- Steps. Open Case ready in RT-1 (Every state review).
- What happened. "Read only. This slide is assigned to , so you can look but not answer."
- What should happen. "Nobody is assigned to this slide yet", or the names.

### 12. Case ai-running says its objects are not there, and shows them

- Severity is low.
- Route is `/projects/{study}/slides/{id}`.
- Steps. Open Case ai-running with and without its task.
- What happened. The slide has two result sets with the same name, Tumour detector v1. The notice says that set is still importing and its objects show when it is ready, while six objects are drawn and listed, and it does not say which of the two is meant.
- What should happen. Two sets that can be told apart, and a notice that names the one still importing.

### 13. Unknown and misplaced slide addresses give misleading screens

- Severity is low.
- Route is `/projects/{gallery}/slides/{unknown id}, /projects/{study}/slides/{a gallery slide id}`.
- Steps. Open a slide id that does not exist. Open a gallery slide under the id of the study project.
- What happened. The unknown id says "The slide file is not available. It may still be processing" with Try again. The misplaced slide draws under the other project's name with the label "Slide", and two calls answer 404.
- What should happen. Page not found for an unknown slide, and a redirect to the slide's own project.

### 14. The person asked to co-sign sees the sender's page

- Severity is low.
- Route is `/projects/{clinical}/cases/{id}/report`.
- Steps. Open the report of Showcase co-sign as Agent Tester before co-signing.
- What happened. The page says "Sent to Agent Tester, waiting", "You are told when it is signed or returned" and offers Withdraw the request to the person who received it.
- What should happen. The receiver goes to the co-sign page, and only the sender can withdraw.

### 15. Finished adjudication still reads as open

- Severity is low.
- Route is `/tasks/{id}/disagreements, /my-work`.
- Steps. Decide both objects of RT-3 (Disagreement queue example).
- What happened. The queue header says "2 objects need a decision out of 17, 2 resolved". My work keeps the adjudication row of that task with All decided and Open under To review, and the badge stays at 3.
- What should happen. "0 objects need a decision", and the finished row leaves To review.

### 16. Search does not keep its words in the address

- Severity is low.
- Route is `/search`.
- Steps. Type Showcase, then reload. Open /search?q=Showcase.
- What happened. Both show "Type at least two letters to search". Picking the object hit T6 opens the slide with ?object=T6. Whether the camera centres is PROTO-104 (a search hit opens its page and moves the camera to the object) and was not rechecked.
- What should happen. The words stay in the address and survive a reload and a shared link.

### 17. Unknown mode and tab values

- Severity is low.
- Route is `/projects/{gallery}/slides/{id}?mode=banana, ?tab=opinion, ?tab=nonsense`.
- Steps. Open a slide with no task and each value.
- What happened. mode=banana says "This slide cannot open in  here, so it opened in Annotate" with the word missing. tab=opinion and tab=nonsense stay in the address while Display shows.
- What should happen. A complete sentence, and the address rewritten to the tab on screen.

### 18. Natural addresses that are Page not found or blank

- Severity is low.
- Route is `/tasks/{id}, /projects, /projects/{clinical}/cases/{id}, /tasks/{annotate task id}/evaluation`.
- Steps. Open each address.
- What happened. The first three are Page not found. The evaluation of an annotate task is a blank page with a 409, and its /disagreements shows an empty queue with two 409 calls.
- What should happen. A redirect to the task, the project list and the case report, and a notice that annotate tasks have no evaluation.

### 19. Opening a report address sends a write

- Severity is low.
- Route is `/projects/{clinical}/cases/{unknown id}/report`.
- Steps. Open the report address of a case id that does not exist.
- What happened. The page sends POST /clinical-report, which answers 404, and shows "Could not load the clinical report".
- What should happen. No write on opening a page. A draft starts when the person asks for one.

### 20. The other two workspaces have an empty clinical project

- Severity is low.
- Route is `/ in ČVUT Machine Learning Lab and ČVUT Medical Imaging Group`.
- Steps. Switch the workspace.
- What happened. The clinical project P02 has 0 slides and no case in both, so reports, co-sign and Showcase case review exist only in ČVUT Biomedical Engineering. A fresh sign-in lands in Machine Learning Lab.
- What should happen. The same showcase case in each seeded workspace, or the sign-in landing in the one that has it.

### 21. The signed clinical report prints empty headings

- Severity is low.
- Route is `/projects/{clinical}/cases/{id}/report`.
- Steps. Read any signed report.
- What happened. Received, Requested by and Clinical history are printed with nothing after them. The Co-sign window says "What you sign, the report with your changes" when nothing was changed.
- What should happen. Empty fields are left out or marked Not given, as Category already is.

### 22. More wording slips

- Severity is low.
- Route is `/my-work, /tasks/{id}/evaluation, /tasks/{id}/sign-off, /tasks/{id}/comments`.
- Steps. Read the pages.
- What happened. "Decide 1 objects", "0 of 1 slides", "about 0 min left" on every one slide task, "1 slides, 11 objects", "2 blind reviewers, 0 adjudicator", "10 reviews not submitted", "1 disagreements not resolved", "No comments on  yet" with the object missing, and "What he gets back" for Ada.
- What should happen. Singular and plural forms, and no sentence with a hole.

## Do the viewer tabs and tools fit the task

- Look has Select, Pan, Measure, Comment and Compare, with Objects, Display and Comments, which fits. Smart select is still in the Look rail, where nobody draws.
- Guided has no rail and Review, Comments and Display, which fits. The opinion questions come after the last object, which fits. The missing Submit does not.
- Review has the reading tools with Objects, Display, Comments and Opinion, which fits. Its AI says block shows a cell count that is not real.
- Cells mode could not be judged, because it does not open. The twelve sampled cells show as a strip in Review, read only.
- Annotate has the full rail. The Objects tab holds Find nuclei, counts and what was drawn, now under the class name, but still under the heading Measurements. Layers, groups and result sets sit in Display. An outline accepted from Smart select on nuclei is saved "as tumor" and listed as a measurement.
- An annotate task adds Export and Mark slide checked and keeps the same three tabs, which fits. A read only annotate task keeps only Select, Pan and Ruler, which fits.
- A slide that failed to open has no rail and no tabs now, which fits.

## Every step

| Area | Step | URL | Role | Should happen | Did happen | Result |
|---|---|---|---|---|---|---|
| Release | Read the status | `/api/status` | Signed out | The status names the release | ok, with no release named | broken |
| Sign in | Sign the agent account in by script | `/api/auth/sign-in` | Signed out | A session in the workspace with the cases | Signed in, but the session opened in Machine Learning Lab, whose clinical project is empty | broken |
| Home | Workspace switcher | `/` | Owner | Three workspaces, switch to Biomedical Engineering | Switched, the choice is kept | works |
| Home | Open home | `/` | Owner | Welcome, start cards, projects, resume card | All drawn. One 404 for the thumbnail of Missing file.svs | works |
| Home | Resume card after answering | `/` | Owner | Progress of my task | 6 of 6 objects decided, Continue | works |
| My work | To review tab | `/my-work` | Owner | My tasks, asks and mentions | Adjudication, two tasks and the co-sign ask | works |
| My work | Assigned by me tab | `/my-work?tab=assigned` | Owner | Tasks I assigned | 15 tasks listed | works |
| My work | All slides tab | `/my-work?tab=all` | Owner | Every slide with filters | 35 slides with five filters | works |
| Notifications | Open on each notice | `/go/{id}` | Owner | The task opens | All three open a slide of their task | works |
| Notifications | Bell, then Open | `/go/{id}` | Owner | The task opens | Opens the guided slide | works |
| Notifications | Open on Objects to adjudicate | `/go/{id}` | Adjudicator | The adjudication screen | A read only guided slide of another slide | broken |
| Notifications | Unknown notice id | `/go/{unknown id}` | Owner | A clear page | "This notification cannot be opened" with two ways out | works |
| Search | Type Showcase | `/search` | Owner | Matching cases | Three cases | works |
| Search | Type T2 | `/search` | Owner | Objects with that ID | 20 object hits | works |
| Search | Reload, and ?q= in the address | `/search?q=Showcase` | Owner | The words are kept | The search is empty again | broken |
| Search | Pick the hit T6 | `/projects/{clinical}/slides/{id}?object=T6` | Owner | The slide opens on the object | The slide opens with object=T6. Centring is PROTO-104 (a search hit opens its page and moves the camera) and was not checked | works |
| Search | Command palette ⌘K, type CMU-1, Enter | `/` | Owner | Slides to go to | Eight slides, Enter opens the first | works |
| Projects | The three project pages | `/projects/{id}` | Owner | Slides tab with counts | All three draw | works |
| Projects | Review tasks tab | `/projects/{id}?tab=tasks` | Owner | Tasks with reviewers | 8, 1 and 6 tasks | works |
| Projects | Settings tab | `/projects/{gallery}?tab=settings` | Owner | Privacy and review defaults | Drawn | works |
| Projects | Old and unknown tab names | `/projects/{gallery}?tab=results` | Owner | The named tab or a notice | The address is rewritten to the tab shown, with no notice | broken |
| Projects | /projects/new | `/projects/new` | Owner | The New project window | Opens over home | works |
| Projects | Unknown project id | `/projects/{unknown id}` | Owner | Page not found | Page not found with Go home | works |
| Projects | /projects with no id | `/projects` | Owner | The project list | Page not found | broken |
| Slides tab | Click a case header | `/projects/{clinical}?tab=slides` | Owner | The case folds | It folds | works |
| Slides tab | New case | `/projects/{clinical}/cases/new` | Owner | Case form | Opens over the project | works |
| Format gallery | Open the 13 slides that worked in round one | `/projects/{gallery}/slides/{id}` | Owner | Each slide draws | All 13 draw with varied pixels and no errors | works |
| Format gallery | Open CMU-1-Saved-1_16 (MIRAX) | `/projects/{gallery}/slides/{id}` | Owner | The slide draws | Draws from original.tiff, in Annotate and in Look | works |
| Format gallery | Open CMU-1-JP2K-33005-v2 (DICOM) | `/projects/{gallery}/slides/{id}` | Owner | The slide draws | Draws with two result sets | works |
| Format gallery | Thumbnails of the two zip slides | `/api/slides/{id}/thumbnail` | Owner | A picture | 200 for both | works |
| Format gallery | Open Missing file.svs | `/projects/{clinical}/slides/{id}` | Owner | A clear notice and no tools | Could not open, no rail and no tabs | works |
| Format gallery | Unknown slide id | `/projects/{gallery}/slides/{unknown id}` | Owner | Page not found | "The slide file is not available. It may still be processing" with Try again | broken |
| Format gallery | A slide under another project's id | `/projects/{study}/slides/{id}` | Owner | A redirect or a notice | Draws under the wrong project with the label Slide | broken |
| Viewer modes | No task, default | `/projects/{gallery}/slides/{id}` | Owner | Annotate with drawing tools | 14 tools and Compare, tabs Objects, Display, Comments | works |
| Viewer modes | No task, mode=look | `/projects/{gallery}/slides/{id}?mode=look` | Owner | A reading viewer | Select, Pan, Measure, Comment, Smart select, Compare | works |
| Viewer modes | No task, mode=review, guided, cells | `/projects/{gallery}/slides/{id}?mode=review` | Owner | A notice and Annotate | Each says why and rewrites the address to mode=annotate | works |
| Viewer modes | No task, mode=banana | `/projects/{gallery}/slides/{id}?mode=banana` | Owner | A notice and Annotate | The notice has a missing word | broken |
| Viewer modes | No task, tab=opinion and tab=nonsense | `/projects/{gallery}/slides/{id}?tab=opinion` | Owner | The address shows the open tab | Display shows, the address keeps the wrong tab | broken |
| Viewer modes | Focus and compare layouts | `/projects/{gallery}/slides/{id}?layout=compare` | Owner | Only the slide, and two panes | Both work | works |
| Viewer modes | Old /live and /annotate addresses | `/projects/{gallery}/slides/{id}/live` | Owner | Redirect to the one viewer | Both redirect | works |
| Viewer modes | Review task, guided | `/projects/{clinical}/slides/{id}?task={id}&mode=guided` | Owner | No rail, Review, Comments, Display | As expected, with the coach | works |
| Viewer modes | Review task, review | `/projects/{clinical}/slides/{id}?task={id}&mode=review` | Owner | Objects, Display, Comments, Opinion | As expected | works |
| Viewer modes | Review task, annotate | `/projects/{clinical}/slides/{id}?task={id}&mode=annotate` | Owner | The full rail | As expected | works |
| Viewer modes | Review task, mode=cells and mode=look | `/projects/{clinical}/slides/{id}?task={id}&mode=cells` | Owner | A notice and Review | Each says why and rewrites the address | works |
| Viewer modes | Annotate task, every other mode | `/projects/{gallery}/slides/{id}?task={id}&mode=guided` | Owner | A notice and Annotate | Each says why and rewrites the address. mode=guided still sends one decisions call that answers 409 | works |
| Viewer modes | Cell task, mode=cells | `/projects/{gallery}/slides/{id}?task={id}&mode=cells` | Not assigned | Cells mode, read only | Review with "no cell sample" next to 12 sampled cells | broken |
| Viewer modes | /tasks/{id}/cells | `/tasks/{id}/cells` | Not assigned | Cells mode | The same wrong fallback | broken |
| Viewer modes | The AI says block in Review | `/projects/{id}/slides/{id}?task={id}&mode=review` | Owner | The cell count of the slide | Cells 18,240 on every slide | broken |
| Task types | Agree style, read only | `/projects/{study}/slides/{id}?task={id}&mode=guided` | Not assigned | The question without buttons | Read only, no coach | works |
| Task types | Certainty style, read only | `/projects/{study}/slides/{id}?task={id}&mode=guided` | Not assigned | "How sure are you" | Shown, read only | works |
| Task types | Yes or no style, read only | `/projects/{study}/slides/{id}?task={id}&mode=guided` | Not assigned | The AI's claim hidden | Hidden, "Is this tumor?" | works |
| Task types | Blind style, read only | `/projects/{study}/slides/{id}?task={id}&mode=guided` | Not assigned | The AI's class hidden | Hidden, "What is T4?" | works |
| Task types | Every state review, an assigned slide | `/projects/{study}/slides/{id}?task={id}&mode=guided` | Not assigned | Read only with the names | Read only, both reviewers named | works |
| Task types | Every state review, Case ready | `/projects/{study}/slides/{id}?task={id}&mode=guided` | Not assigned | Read only with a reason | "assigned to ," with no name | broken |
| Task types | Every state review, Case ai-running | `/projects/{study}/slides/{id}?task={id}` | Not assigned | No objects until the import ends | The notice says the set is importing while six objects show, and two sets share one name | broken |
| Task types | Case uploaded with a broken import | `/projects/{study}/slides/{id}` | Owner | A notice about the failed set | "The result set Broken import did not import" | works |
| Task types | Tumour annotation, not started | `/projects/{study}/slides/{id}?task={id}` | Not assigned | Read only, not signed off | Says Signed off and locked | broken |
| Task types | Slide counts of Every state review | `/projects/{study}?tab=tasks` | Owner | One count everywhere | 6 slides and Slide 1 of 7, 4 and 5 slides left | broken |
| Task types | A task with a slide outside it | `/projects/{gallery}/slides/{id}?task={id}` | Owner | A notice | Loading the review for the 8 seconds watched, five 404 calls | broken |
| Guided | My work, Start on Showcase case review | `/projects/{clinical}/slides/{id}?task={id}&mode=guided` | Owner | Guided review opens | Opens with the coach | works |
| Guided | Answer with K, X and U | `/projects/{clinical}/slides/{id}?task={id}&mode=guided` | Owner | Each decision saves | Six PUT decisions, the next object comes | works |
| Guided | Reload in the middle | `/projects/{clinical}/slides/{id}?task={id}&mode=guided` | Owner | The place is kept | Object 3 of 6 again | works |
| Guided | Browser back and forward | `/my-work` | Owner | My work, then the slide again | Both work | works |
| Guided | Opinion questions | `/projects/{clinical}/slides/{id}?task={id}&mode=review&tab=opinion` | Owner | Answers save | Three PUT opinion calls | works |
| Guided | Submit the slide | `/projects/{clinical}/slides/{id}?task={id}&mode=guided` | Owner | A Submit button | No Submit in Guided or Review, 0 of 3 slides submitted | broken |
| Guided | Open report from the top bar | `/projects/{clinical}/cases/{id}/report` | Owner | The case report | The signed report of the case | works |
| Annotate task | My work, Start on Annotation example | `/projects/{gallery}/slides/{id}?task={id}&mode=annotate` | Owner | The annotate viewer | Opens with Export and Mark slide checked, 4393 AI objects | works |
| Annotate task | Mark slide checked | `/projects/{gallery}/slides/{id}?task={id}&mode=annotate` | Owner | The slide counts as checked | 1 of 1 slides checked, and the task leaves To review | works |
| Drawing | Open and wait for writes | `/projects/{gallery}/slides/{id}` | Owner | No write on open | None in 9 seconds | works |
| Drawing | Change tools H, V, L, O | `/projects/{gallery}/slides/{id}` | Owner | A hint is written once at most | PUT setting-layers on most changes, twice for the same tool | broken |
| Drawing | Rectangle, ellipse, ruler, count marker | `/projects/{gallery}/slides/{id}` | Owner | Each shape is saved | Four POST /annotations | works |
| Drawing | Objects tab after drawing | `/projects/{gallery}/slides/{id}?tab=objects` | Owner | Shapes by class name | Under Tumor, M1 to M3 | works |
| Drawing | Reload and compare IDs | `/projects/{gallery}/slides/{id}` | Owner | The numbers stay | They stay | works |
| Drawing | Clear all, then ⌘Z | `/projects/{gallery}/slides/{id}?tab=objects` | Owner | A question, and undo | "Delete all 4 shapes on this slide?", undo brings all four back | works |
| Smart select | Arm with S | `/projects/{gallery}/slides/{id}` | Owner | Good by default, no server call | Good and Best in the bar, no call | works |
| Smart select | Click a nucleus on Good | `/projects/{gallery}/slides/{id}` | Owner | An outline to accept | 1 found after 12 seconds | works |
| Smart select | Accept with Enter | `/projects/{gallery}/slides/{id}` | Owner | The outline is saved | POST /annotations and POST /outline-types | works |
| Smart select | Best, two tries | `/projects/{gallery}/slides/{id}` | Owner | A Best outline or a visible wait | "Best is not answering yet" both times | broken |
| Disagreements | Queue of Disagreement queue example | `/tasks/{id}/disagreements` | Owner | Objects to decide | Two objects, one with the adjudicator | works |
| Disagreements | Queue of Every state review | `/tasks/{id}/disagreements` | Owner | Locked until all submit | Locked, with Nudge Rhea | works |
| Disagreements | Queue of Submitted review | `/tasks/{id}/disagreements` | Owner | Objects to decide | Two objects, both against the AI | works |
| Disagreements | Queue of Signed-off review | `/tasks/{id}/disagreements` | Owner | A finished queue | 0 objects, Go to sign-off | works |
| Adjudication | My work, Start on the adjudication | `/tasks/{id}/adjudicate` | Adjudicator | The waiting object, reviewers anonymous | T1 with Reviewer A and Reviewer B | works |
| Adjudication | Reload and browser back before deciding | `/tasks/{id}/adjudicate` | Adjudicator | The same object, then My work | Both work | works |
| Adjudication | Decide with X | `/tasks/{id}/adjudicate` | Adjudicator | Saved, the asker is told | "All 1 decided. Ada is told." | works |
| Adjudication | The owner decides the second object with K | `/tasks/{id}/disagreements` | Owner | Saved and kept after a reload | Saved, both rows show their decision | works |
| Adjudication | Header and My work after all is decided | `/tasks/{id}/disagreements` | Owner | Nothing left to decide | "2 objects need a decision", and the row stays in To review | broken |
| Adjudication | Adjudicate on a task with no queue | `/tasks/{id}/adjudicate` | Owner | A clear notice | "Nothing is queued for you on this task" | works |
| Sign-off | Sign off Disagreement queue example | `/tasks/{id}/sign-off` | Owner | Ready to sign, then signed | Signed with a checksum, the adjudication is listed | works |
| Sign-off | The step named single sign-on | `/tasks/{id}/sign-off` | Owner | A sign-in step | One click signs | broken |
| Sign-off | Sign off window of Every state review | `/tasks/{id}/sign-off` | Owner | What is left to do | Two things to finish, listed | works |
| Sign-off | Sign off window of an annotate task | `/tasks/{id}/sign-off` | Owner | A plain explanation | "Each slide is signed off on its own in the viewer" | works |
| Evaluation | Signed report of Signed-off review | `/tasks/{id}/evaluation` | Owner | Signed everywhere | Signed 20 Nov in the report, the window and Team | works |
| Evaluation | Report after my sign-off | `/tasks/{id}/evaluation` | Owner | Signed | Signed 20 Nov, Team lists it under Done | works |
| Evaluation | Preview the PDF, Esc, deep link, back | `/tasks/{id}/evaluation?view=pdf` | Owner | Opens and closes | All four work | works |
| Evaluation | Compare with RT-1 (Every state review) | `/tasks/{id}/evaluation` | Owner | A comparison with true text | The block appears, and says both tasks cover the same slides | broken |
| Evaluation | Evaluation of an annotate task | `/tasks/{id}/evaluation` | Owner | A notice | A blank page and a 409 | broken |
| Sharing | Make a read only link | `/tasks/{id}/evaluation` | Owner | A link shown once | Made, with Copy | works |
| Sharing | Open the link signed out | `/shared-reports/{token}` | Signed out | Numbers without names | Numbers, Reviewer A and Reviewer B | works |
| Sharing | Revoke, then open again | `/shared-reports/{token}` | Signed out | The link ends | "This link was revoked or has expired" | works |
| Sharing | A made up link | `/shared-reports/{token}` | Signed out | A clear page | "This link does not lead to a report" | works |
| Cases | Signed clinical report | `/projects/{clinical}/cases/{id}/report` | Owner | The locked report with true numbers | Version 1. The AI flagged 6, 5 confirmed, 1 rejected, 0 deposits | works |
| Cases | Draft report, Findings to Staging to Report text | `/projects/{clinical}/cases/{id}/report?step=staging` | Owner | A negative node case passes | Passes as pN0(sn) with no deposit | works |
| Cases | Sign out the draft report | `/projects/{clinical}/cases/{id}/report?step=sign` | Owner | Signed and locked | Locked as version 1 | works |
| Cases | Report page as the co-sign receiver | `/projects/{clinical}/cases/{id}/report` | Owner | The co-sign page | The sender's waiting page with Withdraw the request | broken |
| Cases | Return with a note | `/projects/{clinical}/cases/{id}/co-sign` | Owner | A note window | Opens, closed without sending | works |
| Cases | Co-sign and sign out | `/projects/{clinical}/cases/{id}/co-sign` | Owner | Signed by both | "Reported by Ada Admin, verified and signed by Agent Tester" | works |
| Cases | Case address with no /report | `/projects/{clinical}/cases/{id}` | Owner | The case | Page not found | broken |
| Cases | Report of an unknown case | `/projects/{clinical}/cases/{unknown id}/report` | Owner | A notice and no write | A notice, after a POST that answers 404 | broken |
| Jobs | Jobs tray | `/` | Owner | Running and finished jobs | One finished upload | works |
| Jobs | Open on the finished job | `/projects/{clinical}/slides/{id}` | Owner | The steps of the job | The slide opens, no steps | broken |
| Run a model | Run a model window | `/projects/{gallery}/run-model` | Owner | Slides, model, time estimate | Two slides picked, about 8 minutes. Not started | works |
| New task | New review task and New annotate task | `/projects/{gallery}/tasks/new` | Owner | The wizards | Both open on Kind. Not sent | works |
| Upload | Upload wizard | `/projects/{gallery}/upload` | Owner | Three steps | Opens on Files. Nothing uploaded | works |
| Settings | Preferences, nine sections | `/settings/display` | Owner | Each section opens | All nine open from the menu. Each click on a section sends PUT /api/me/setting-layers | works |
| Settings | Unknown section | `/settings/nonsense` | Owner | Page not found | Page not found | works |
| Admin | Overview and nine sections | `/admin` | Owner | Each section opens | All open from the menu | works |
| Team | Open tasks, Done, Reassign | `/team` | Owner | Who reviews what | Lists and the Reassign window work | works |
| Other routes | /tasks/{id}/submitted on five tasks | `/tasks/{id}/submitted` | Owner | The task opens | Each goes to a slide of the task | works |
| Other routes | /tasks/{id}/comments | `/tasks/{id}/comments` | Owner | The comments of the task | An older viewer screen with Submit and "No comments on  yet" | broken |
| Other routes | /tasks/{id} with nothing after it | `/tasks/{id}` | Owner | The task | Page not found | broken |
| Other routes | /kpi and /study | `/kpi` | Owner | The page inside the app | Both have the menu now | works |
| Other routes | /setup, /invite, /sign-up, /popout, /developer | `/setup` | Owner | Each page opens | All open | works |
| Other routes | /sign-in while signed in | `/sign-in` | Owner | Home | The sign-in form | broken |
| Other routes | Prototype pages and an unknown address | `/prototype` | Owner | Page not found | Page not found with Go home | works |
| Signed out | /, /admin and an evaluation address | `/sign-in?return_to=` | Signed out | Sign-in with the address kept | All three keep the address in return_to | works |
| Signed out | /my-work, a slide and /go/{id} | `/my-work` | Signed out | Sign-in with the address kept | The words "Sign in to go on" for more than 3.5 seconds, then /sign-in?return_to= within 11 seconds | works |
| Workspaces | The other two workspaces | `/` | Owner | The same seeded cases | Their clinical project has 0 slides | broken |

Role is Owner for the agent account acting on its own projects and tasks, Not assigned when it looks at a task of other people, Adjudicator on the seeded adjudication, and Signed out for a browser with no session.

The scripts used are in the session scratchpad and are not in the repository. Keeping one in the repository, which TEST-056 (the deployed walkthrough) asks for, is still TODO.
