# Result: Paged cells keep their confidence at one million nuclei

- Date: 2026-11-08
- Backlog: REVIEW-015 (paged results keep confidence)
- Kind: baseline
- Commit: b325f870
- Environment: Apple M4 Mac with 24 GB shared with other agents, Chrome headless through Playwright with one worker, loopback server, no latency proxy
- Data: 1,000,000 synthetic cells generated per chunk request, no slide data

## Question

Can the engine's paged cell reader fade outlines by probability, list unsure cells and record decisions on a paged result of one million nuclei without holding them all in memory?

## Method

The viewer engine browser test for REVIEW-015 drives the paged cell reader through a test page at 1,000,000 cells, with chunks generated on each request. It checks the fade alpha of every drawn outline against its probability, lists unsure cells least sure first, looks them up, records three kinds of decision, pans away and back. `vm_stat` showed 73 percent free memory before the run.

## Results

| Measure | Value |
|---|---|
| Browser memory | 40.7 MB |
| Open | 40 ms |
| First view | 495 ms |
| Unsure cells listed | 11 ms |

## Interpretation

One run on a shared machine, so the times are indicative only. Memory stays small because only the chunks in view are held.

## Follow-ups

The web review screen still reads a flat object list. REVIEW-030 (the review screen reads paged results) connects it to the paged reader.
