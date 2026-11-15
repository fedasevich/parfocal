# Result: the per-slide type learner raises same-image balanced typing accuracy from 50.6% to 64.7% after 200 corrections

- Date: 2026-11-15
- Backlog: AILEARN-002 (browser per-slide learner)
- Kind: benchmark
- Commit: the AILEARN-002 branch commit that adds this file
- Environment: Apple M4 laptop, 24 GB, macOS 15 (Darwin 24.6), Node 26.13.1, other agents running on the same machine. No cloud runs, no model weights loaded.
- Data: the POC's PanNuke fixtures in `poc/server/fixtures/pannuke`, read only. These are public PanNuke fold 1 nuclei with precomputed PathoSAM features and MONAI typer probabilities, no PHI

## Question

Does the learner in `packages/viewer-engine/src/learner/` meet the Done line of AILEARN-002, at least 10 points of same-image balanced typing accuracy over the typer after 200 corrections on the protocol of POC doc 22 (learning from corrections)?

## Method

`pnpm --filter @parfocal/viewer-engine bench:type-learner /Users/yuriifedas/WebstormProjects/poc/server/fixtures/pannuke` runs `sameImageTrial` from `same-image-protocol.ts`, the same code the node test runs on a synthetic slide. Each nucleus gives 516 inputs, its 512 pooled PathoSAM features followed by the MONAI typer's four log probabilities. For each of the three draws of 200 corrections in `typing-samples.json`, the learner is taught one correction at a time with a warm retrain after each, as in the viewer. It is scored on 3,000 held-out nuclei from the same images: every third nucleus the typer covered that was not a correction. The score is balanced accuracy over the four classes. The typer's score is the argmax of its own probabilities on the same nuclei. The learner settings are the defaults, chosen before this run.

## Results

| Draw | Typer | Learner | Gain | Last correction's retrain |
| --- | --- | --- | --- | --- |
| 0 | 50.7% | 64.5% | 13.8 points | 27.0 ms |
| 1 | 50.7% | 64.6% | 13.9 points | 40.5 ms |
| 2 | 50.5% | 64.9% | 14.4 points | 30.0 ms |
| Mean | 50.6% | 64.7% | 14.0 points | |

## Conclusion

The Done line holds. The gain is 14.0 points against the 10 required, and it is steady across the three draws. The learner's 64.7% agrees with the 65.1% that doc 22 measured for its browser learner with MONAI appended, so the fresh code reproduces the POC.

The retrain after one more correction took 27 to 41 ms in Node, on a CPU shared with other agents. That is still fast enough to follow each keypress, but it is above the 8.6 ms doc 22 reported, so it should be timed again in the browser worker on an idle machine.

The same limits as doc 22 apply. "Same images" means the same cohort of 800 PanNuke images, not one slide. PathoSAM was trained on data that includes PanNuke. The labels are PanNuke's, mapped onto four viewer classes.
