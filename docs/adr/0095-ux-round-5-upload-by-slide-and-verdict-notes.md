# 0095. Upload has three steps with results under their slides, verdict reasons become optional and several, and the viewer folds the magnification bar and loads coarse first

- Date: 2026-10-19
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: INGEST-021, CASES-016, CASES-024, RSET-004, NAV-001, VIEW-041, GUIDE-003, GUIDE-005, GUIDE-010, GUIDE-011, IAM-023, ADMIN-002, ADMIN-006. Amends [ADR 0072](0072-verdicts-reasons-and-opinion-forms.md) on reasons

## Context

The owner reviewed the hi-fi mock after POC [doc 41](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/41-clickable-pass.md) and asked for six changes, recorded in POC [doc 42](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/42-ui-feedback-round-5.md). The upload's two columns of slides and results did not line up, the magnification bar distracted on the slide, reviewers could not explain a verdict, slide loading had no defined look, there was no passkey sign-in, and the team storage was a single bar.

## Options considered

1. Keep the Match step and only regroup the Files list. Rejected by the owner, who chose to fold Match into Files.
2. Make a note or a reason required on Disagree, as ADR 0072 has it. Rejected by the owner, who chose optional notes with quick reasons offered but never required.
3. Offer passkey enrolment after sign-in, a passkey list in settings and an admin policy. Deferred by the owner. This round adds only the sign-in option.

## Decision

- The upload has three steps, Files, Check and Upload. Files lists each slide with the result files paired to it under it, grouped into cases. Pairing runs on drop, by folder shape first, then the same name, then the slide ID inside the file, and each pairing says how it was made. A result that pairs with no slide waits in "Not matched yet" in the Files step until the user picks its slide, and Check names it as a problem if it is still unplaced. The pairing rule and the case choice stay changeable from the Files step. The empty step explains the folder shape: a folder is a case, a result sits next to its slide with the same name or in a folder named like the slide.
- Verdict reasons change, which amends ADR 0072. A reason is optional on Disagree, and a verdict may carry several reason codes. Unsure gains four optional codes: `need_deeper_level`, `need_ihc`, `border_unclear` and `out_of_focus`. The optional note of up to 500 characters stays, can mention people as comments do, and shows in the Comments tab as a thread on the object, in the disagreement queue and in the adjudicator view, which keeps reviewers blinded.
- The magnification bar folds to a chip with the magnification and the scale bar. It opens to the presets, the readout and brightness on hover and focus, while Alt plus a number is held, for 2 s after a zoom and while the brightness popover is open. Brightness shows in the folded chip only when it is not 100%.
- While a slide loads, the coarse level shows first, stretched, and sharper tiles fade in over it. A quiet checker appears only where no level has loaded, and outside the slide bounds the canvas is the plain background. Overlays draw at once on top. A hint appears after 1 s of waiting for sharp tiles, and after 5 s it names the slow source.
- Sign in and the lock screen offer a passkey as one more way in, through the identity provider's passwordless flow.
- Admin shows team space as one bar split by kind (copied slides, tile cache for remote slides, results and reviews, free), with a legend and a by-project list. Slides read in place are a line under it, not a segment.

## Consequences

- INGEST-021, CASES-016, CASES-024 and RSET-004 refer to `mock: upload/files` instead of `mock: upload/match`.
- GUIDE-001 is built with a required reason, so GUIDE-011 relaxes it and adds the Unsure codes and several codes per verdict. The evaluation report's reason counts count each code of a verdict once.
- NAV-001 describes the folding chip, VIEW-041 is new for the loading order, GUIDE-010 is new for notes in the interface, IAM-023 is new for passkeys, and ADMIN-006 and ADMIN-002 show the storage bar from a usage figure per kind and per project.
