# 0021. Prototype round 4: launchpad home, worklist by day with a preview drawer, status board, account menu, upload from a link and a fixed settings window

- Date: 2026-10-08
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: edits the decisions baseline rows "Ingest" and "UX variants", the `mock N` and `kit:` notes in "How to use", the milestone table, SHELL-001, SHELL-002, HOME (epic note), HOME-002, HOME-007, HOME-008, WL-000, WL-002, WL-005, WL-006, WL-007, WL-008, WL-012, WL-015, SET-002, SET-003, SET-012, STACK-033, EXP-003, EXP-008, INGEST-021 and the "Later epics" list, and every `mock N` reference. Rewrites the tests of WL-014, CASE-004, CASE-013, REVIEW-002 and AIP-004 to check behaviour instead of matching the mock. Adds SHELL-012, IAM-015, INGEST-025, INGEST-026, EXP-010 and the new BOARD epic (BOARD-000 to BOARD-012).

## Context

The owner reviewed the hi-fi mock and the UX kit on 2026-10-08 and made these choices. The mock (version 29) and the kit (version 13) now show each one.

1. The launchpad (home option A) is the home. The kit had recommended it, and the owner chose it.
2. The worklist is option A's list, split by the day each case is due, with option B's preview folded in. The preview should not be visible all the time.
3. The status board is no longer a worklist view. It becomes a page of its own under My worklist, in the spirit of Jira: department, only my tickets or the histology lab, tickets with lab work as sub-tasks, a ticket panel and reassigning.
4. The settings button (it reads as a sun) leaves the home and worklist top bars. The avatar opens a menu with theme, settings, log out and the other account items.
5. The home top bar gains an Upload button, and upload can take a link to slides on another server, which the server downloads.
6. The settings window changed size between sections, which looked broken. It now keeps one size.

In the POC study, round 4 is running with one participant done. Its tasks, home and worklist stay frozen, and the study now blocks navigation that is clearly wrong for a task.

## Options considered

1. Keep every home and worklist variant behind flags, as the baseline said, and add the board and account menu on top. This gives the most to experiment with, but it builds and maintains three homes and two worklist views that the owner has decided against.
2. Build the chosen layouts. Keep the department dashboard as the lab leads' home and the day plan and slide grid as worklist views. Fold the feed into the launchpad's activity and notifications, fold search first into ⌘K and a search page, and move the board into its own epic. This matches the decisions and keeps every existing ID.
3. Replace the HOME and WL epics. This is cleaner on paper but loses tasks that still hold, such as the dashboard, the day plan, the grid and the AI queue.

## Decision

Option 2. The decisions below are about what the product does. Layout, sizes, placement and wording follow the prototype at the time a task is built and may change without a new ADR.

- The launchpad is everyone's home, and the dashboard is the default home for lab leads. The feed becomes the launchpad's activity list and the notification centre. Search first becomes the Search page from the sidebar and ⌘K.
- The worklist groups cases by due day: today, tomorrow, then the next working days, each with a count and a reading-time estimate. A preview of the selected case appears only on demand, never permanently, and the list stays readable while it is open. Opening a case stays one action away, by keyboard and pointer. Day plan and slide grid stay as views.
- The status board is a page under My worklist (BOARD epic). Cases are tickets, and recuts, IHC stains, rescans and second opinions are sub-tasks with their own owner. The board follows the case workflow, with quick filters, filtering and grouping by person and a work-in-progress limit. A ticket shows its details without leaving the board. Anyone can reassign their own or unassigned cases, and lab leads can reassign anyone's. The picker shows load, specialty and availability, suggests the least loaded consultant and never suggests a resident alone, and takes an optional reason. Signed is not a status you can pick or drag to, because a case is signed from the case.
- Home, worklist and board share one top bar with search, Upload and an account menu. There is no separate settings or theme button. The account menu holds status (available, busy, away with a back-up), theme, initials only, settings, shortcuts, profile and signature, help, and log out. Log out is never worded like signing out a case.
- Upload can also start from a link. In v1 the server fetches HTTPS links and object-storage links (S3, Azure) into the same quarantine as browser uploads. It lists what it found, matches it to a case and leaves out slides the case already has. Lab admins can save sources. DICOMweb, SFTP and scanner shares, and watching a link for new slides, stay later epics.
- The settings window keeps one stable size across sections, and long sections scroll inside it.
- Study mode can block navigation that is clearly wrong for a task, with a visible message. It never blocks a navigation that finishes the task, and it counts every blocked attempt (EXP-010). A running study round keeps its screens and tasks frozen.

## Consequences

- The mock gained Status board at step 3 and Report and PDF after Sign out. So the old steps 3 to 13 are now 4 to 14, and the old steps 14 to 19 are now 16 to 21. Every `mock N` reference in the backlog was renumbered in the same change. The kit's wireframes now run W1 to W38. W1 is the merged worklist, W16 is the status board and W34 to W36 are the ticket, the account menu and upload from a link.
- WL-008 is dropped, and its work lives in the BOARD epic, which belongs to milestone M5 because it needs realtime (COLLAB-001) and cases (CASES-001).
- EXP-003 and SET-012 no longer choose between four homes and five worklist views. They choose the lab leads' home and whether the preview opens on select.
- INGEST-025 needs server-side fetching with SSRF protection, which is new attack surface. SEC review must cover it before pilot.
- The study's frozen round means the POC study's `proto.js` is patched by hand until round 4 ends, as `poc/study/README.md` says.
- [ADR 0022](0022-sign-out-report-standards-and-pdf-preview.md) records the sign-out report changes made in the same review.
