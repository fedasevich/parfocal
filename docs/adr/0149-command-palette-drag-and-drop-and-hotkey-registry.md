# 0149. The command palette stays hand-written, drag and drop will be Pragmatic drag and drop, and hotkeys go through one custom registry with chords and hold versus tap

- Date: 2026-11-02
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-014 (command palette, drag and drop, hotkeys). Touches [ADR 0143](0143-client-ui-state-zustand-and-xstate.md) (client UI state with Zustand and XState) and [ADR 0145](0145-tables-tanstack-table-and-virtual.md) (tables driven by J/K from a window key listener)

## Context

The mock gives every action a keyboard path. Settings keep a keymap with three presets (viewer default, QuPath-like, Figma-like), personal rebinding, conflict checks, keys reserved by the browser and a choice of whole-slide by hold, tap or both (`apps/web/src/screens/settings/keymap.ts` and `shortcuts.ts`, mock 21). The keymap has chords such as G then 1 to 9 for "go to AI area n", and Z means a whole-slide peek while held and a latched whole slide when tapped. The kit's Interaction spec sets the threshold: a tap under 350 ms latches. The palette opens on ⌘K and finds actions, places and settings (mock 18).

The prototype screens already built a palette: `CommandPaletteView` in `packages/ui` and `apps/web/src/shell/command-palette.tsx` on the kit's Radix dialog. It has a combobox input, a listbox with options and `aria-activedescendant`, arrows, Enter and Esc, grouping, highlight and server search through the API client, and `e2e/home-and-work.spec.ts` checks it. Keys today are about fourteen separate `window` keydown listeners, one per screen, and `usePeekKey` in `slide-peek.tsx` holds the only hold-versus-tap logic. Nothing in the app drags yet except file drops onto upload, which use the native HTML events.

## Options considered

Command palette.

1. Keep the hand-written palette. It already meets the mock and the accessibility pattern, costs no dependency and filters by substring.
2. cmdk 1.x. A headless palette with fuzzy scoring and its own list virtualisation. It would replace working code, and its scoring would reorder results the mock fixes by group.
3. kbar. Brings its own action registry and shortcut handling, which would clash with the keymap the settings screen already owns.

Drag and drop.

1. Pragmatic drag and drop (Atlassian). Built on native HTML drag events, so files from the desktop and items in the app share one model, about 5 KB for the core, headless, with optional hitbox and auto-scroll packages.
2. dnd-kit. Pointer-event based with good sortable lists and keyboard dragging, but files from the desktop still need the native events, so two models would live side by side.

Hotkeys.

1. A custom registry. A pure `step(bindings, state, input)` function decodes key events into fired actions, with a thin React hook on `window`.
2. tinykeys. About 1 KB with sequences, but no hold versus tap, no layered presets and no conflict model.
3. react-hotkeys-hook. Scopes and form-field filtering, but sequences and hold versus tap are not covered and bindings live in components rather than in the keymap.

## Decision

| Concern | Choice |
|---|---|
| Command palette | Keep the hand-written palette. cmdk is the option to measure again if the palette grows past a few hundred commands or needs fuzzy matching |
| Drag and drop | Pragmatic drag and drop, installed by the first task that drags something inside the app (reordering layers, worklists or report sections). Not installed now |
| Hotkeys | A custom registry in `apps/web/src/keys/registry.ts` with the hook `use-hotkeys.ts` |
| Key names | The keymap's own names: `G`, `2`, `⇧K`, `⌥↑`, `⌘K`, letters and digits read from `event.code` so a layout or ⌥ does not change them. Ctrl counts as ⌘ so Windows and Linux get the same binding |
| Chords | A binding is a list of keys, written `G then 2` in the keymap. The first key waits up to 1,000 ms for the next. Esc cancels a waiting chord. A key that does not continue the chord acts on its own |
| Hold versus tap | A `hold` binding fires `hold-start` on key down and `tap` or `hold-end` on key up, with the 350 ms threshold from the Interaction spec. Auto-repeat is ignored, and losing window focus ends a hold |
| Text fields | Bindings do not fire, and chords do not start, while focus is in an input, textarea, select or editable element, unless the binding is marked `inInputs` (⌘K, Esc and the like) |
| Presets and rebinding | `resolveBindings(defaults, preset, personal)` layers overrides by action ID, so the settings screen's state feeds the registry directly |
| Conflicts | `conflicts(bindings)` also reports a single key that starts a chord in the same set, such as a bare G next to G then 2 |
| State library | No XState. The registry is a pure function of the state and one event, tested with fake timestamps, and the decoder is not a UI flow in the sense of ADR 0143 |

The palette stays because it already meets the mock and its tests, and a library would only replace it. Pragmatic drag and drop wins because the app has to accept files from the desktop anyway, and one native model is simpler than two. The registry is custom because chords, hold versus tap, layered presets and the conflict rules are the hard part, and no library covers them.

## Consequences

- The spike lives at the dev-only route `/spikes/hotkeys`. `e2e/hotkeys-spike.spec.ts` shows G then 2 firing with focus outside a text field and typing `g2` with focus inside, ⌥↑ firing inside the field because it is marked `inInputs`, and Z tapped, Z held for 500 ms and Z typed into the field. `test/hotkeys.test.ts` covers the same rules on `step` with fake time.
- The existing window listeners, `usePeekKey` and the shell's ⌘K handler move into the registry one view at a time, the same way [ADR 0145](0145-tables-tanstack-table-and-virtual.md) moves J and K. Until then two listeners can answer one key, as the spike showed when its ⌘K also opened the shell's palette.
- The registry's hook attaches in a layout effect, so a key pressed right after the first paint is not lost.
- The settings screen's `conflicts` in `shortcuts.ts` does not yet know about chord prefixes. It should call the registry's `conflicts` when the keymap feeds the registry.
- No new dependency is added by this record.
