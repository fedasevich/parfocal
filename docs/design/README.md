# Frozen prototype

These are frozen copies of the two prototype artifacts at the end of round 6 of the redesign, taken on 2026-11-01 by PROTO-001 (freeze the redesigned prototype). The PROTO epic ports them into React over fake data, and the screens and components there were compared with these copies ([ADR 0129](../adr/0129-the-prototype-moves-into-react-as-the-design-source.md)). Since PROTO-010 (make the React app the design source), the app in `apps/web` and its Storybook in `packages/ui` are the design source and these copies are frozen history. Nobody edits them.

| Copy | Artifact | Version id | What it is |
|---|---|---|---|
| [ux-mock/index.html](ux-mock/index.html) | [Hi-fi mock](https://claude.ai/artifact/3axrsHDKG5EqDyxu3nZYoJ) | `1793543251-80da` | The clickable mock, 40 screens with 248 scenes, in both themes |
| [ux-kit/index.html](ux-kit/index.html) | [UX kit](https://claude.ai/artifact/WKq3HJJWYL15oY4nXNBweC) | `1793543567-f4c8` | The UX kit, 21 Parfocal pages and 4 specs and analysis pages |

[prototype-inventory.md](prototype-inventory.md) lists every screen, scene and kit page with the PROTO task that builds it, the task that owns it and the API it reads.

## Where they come from

The local copies were taken from the archived POC repository (https://github.com/fedasevich/pathlogy-poc, branch `master`) at commit `ea20efda82cadeeb434d2f827d88d2d2096f1063`, from `docs/ux-mock/` and `docs/ux-kit/`. The POC's round 6 status notes (`docs/44-notes/status.md` there) record that both artifacts were republished and read back on 2026-11-01 with the version ids above. The meaning of each round 6 change is in POC doc 44 (the round 6 working mock), section "What changed in round 6".

The owner allows copying markup, styles, text and fake data from these two artifacts into this repository. That covers the kit and the mock only, and the rule against copying POC code still stands.

## What is in the copies and what was left out

| Path | Size | Notes |
|---|---|---|
| `ux-mock/index.html` | 1.2 MB | The whole mock in one file. Open it in a browser, no server needed |
| `ux-mock/assets/` | 2.0 MB | The slide images the mock draws on: overview, 10x and 40x crops and the tumor heatmap |
| `ux-mock/shots/` | 2.9 MB | Ten screenshots from earlier rounds that sat next to the mock. The mock does not link them |
| `ux-kit/index.html` | 200 KB | The whole kit in one file |

The kit's `mockups/` folder was left out. It holds 353 packed stills of the mock, about 80 MB, and every one of them can be shot again from the mock with the POC's `scripts/shoot-mock.mjs`. So the still galleries in the frozen kit show broken images. The published kit artifact still shows them.

## Data in the copies

Every person, email address, hospital, case number, slide and object ID in the copies is fictional demo data. The emails use made-up addresses at real-looking domains such as `fnvltava.cz` and `cuni.cz`, and the patient fields read "Not entered". There is no real patient data. This was checked by searching the copies for birth numbers, dates of birth, record numbers and patient names on 2026-11-01.

## Tooling that skips the copies

Biome ignores `docs/design` (`biome.json`), because the copies are not our code. The secrets scanner allows the two button labels "Sign with password" in the mock, which its generic password rule took for a secret (`.betterleaks.toml`). Nothing else is allowed there.
