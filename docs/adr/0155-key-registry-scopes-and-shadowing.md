# 0155. The key registry layers scopes by rank, expands sets from the keymap and takes a hold time per action

- Date: 2026-11-02
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: CMD-001 (key registry). Builds on [ADR 0149](0149-command-palette-drag-and-drop-and-hotkey-registry.md) (the hotkey decoder with chords and hold versus tap) and [ADR 0107](0107-viewer-input-binding.md) (viewer input, whose Space hook the registry feeds later)

## Context

ADR 0149 built the decoder (`step`) and left the actions themselves in the settings keymap, with one flat `context` of `all` or `review`. CMD-001 asks for every action registered once with default keys per preset, a scope of global, viewer, review, annotate or worklist, and a hold time. The settings keymap writes sets as text such as `⌥1 … ⌥6`, `G then 1 … 9` and `Arrows`, so the registry has to read what the keymap already says.

## Options considered

Where actions live.

1. A second list of actions beside the settings keymap. Two lists drift, and the Shortcuts section has to show every registered action.
2. The settings keymap stays the one catalogue, gains a scope, an input flag, a hold time and per-preset keys, and `src/keys/actions.ts` turns it into bindings.

What happens when two scopes use one key.

1. Both bindings stay and the first one found fires.
2. Scopes have a rank (annotate, review, viewer and worklist, then global). A binding is dropped when a higher-ranked active scope has the same keys or a key sequence that starts with or is started by them. The same rank keeps both, which is a conflict for CMD-004 (the CI check) to report.

## Decision

Option 2 in both. `createActionRegistry(defs).bindings({ preset, personal, scopes, only })` resolves the keys of each action as personal keys, else the preset's keys, else the default, expands sets (`Arrows`, `WASD` and `IJKL` into `:up`, `:down`, `:left` and `:right`, and `A … B` into `:n`), drops shadowed bindings and returns plain bindings for `step`. Registering an id twice throws. The global scope is always active. `only` lets a screen move onto the registry one action at a time. A binding may carry `holdMs`, and the decoder falls back to the 350 ms of the Interaction spec.

## Consequences

- `usePeekKey` now runs on the registry, so the whole-slide hold and tap in the full viewer and in focus mode share one decoder with the spike.
Z keeps the 350 ms hold of ADR 0149 (command palette, drag and drop and hotkey registry), which the owner accepted on 2026-11-02 over the 180 ms an older backlog line named.
- The review keys for certainty (1 to 5) and for the class (1 to 4) share digits in one scope, because which one is live depends on the question style. The screen must pass `only` for the style in use until the conflict check (CMD-004) models styles.
- The other window listeners move over one screen at a time. The settings screen's own `conflicts` should call the registry's rank rule once the keymap feeds the registry.
- The setting for whole slide by hold, tap or both is not read yet. It maps to a `holdMs` of 0 for hold only and infinity for tap only when the screens read the user's settings.
