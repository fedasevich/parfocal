# 0259. Saved arrows, text notes and rulers

- Date: 2026-11-08
- Status: Accepted
- Deciders: Claude
- Backlog: ANN-036

## Context

The arrow, text and ruler tools from ANN-034 (harden the count, arrow, text, ruler and comment pin tools) draw shapes that lived only in the browser. The save step sent only polygons, as `region`, and count markers, as `cell`. The annotations table had four kinds, `roi`, `measurement`, `region` and `cell`, and no place for words. [ADR 0071](0071-object-id-grammar.md) (object ID grammar) gives every kind a letter that numbers it per slide.

## Options considered

1. Save all three as `measurement` lines with a new column that says which tool drew them. One letter, no new kinds, but case report findings read every `measurement` row as a length, so arrows and notes would show up as deposit sizes, and every reader of the kind would need the extra column.
2. Save rulers as `measurement` and add two kinds, `arrow` as a two point LineString and `text` as a Point, numbered under their own letters. Add one nullable `text` column on `annotations` and `annotation_versions`.
3. Number arrows and text notes under the measurement letter `M` to avoid new letters. Codes stay unique, but threads and reports that resolve an `M` code to a measurement would find an arrow.

## Decision

Option 2. A ruler is a `measurement` LineString of two points, which the case report already measures with `ST_Length`. An arrow is kind `arrow`, a LineString from tail to head, letter `A`. A text note is kind `text`, a Point, letter `N`, and its words, trimmed and at most 200 characters as in the text tool, go in the new `text` column, marked PHI in the data map because it is free text. A check keeps `text` set exactly on text notes, the API refuses words on any other kind, and an edit may change the words alone. History rows copy the words, so a text edit shows in history. Migration 0099 adds the two columns, widens the kind check on `annotations` and the letter check on `slide_counters`, and changes no existing row.

The web app maps shapes to saved records in one place, `saved-shapes.ts`, loads every kind of a slide in one list call and skips kinds it does not draw, such as regions of interest and area measurements. A change of words counts as a change to sync. Imported files cannot create text notes, because they carry no words field yet. Exports carry arrows and notes with their codes but not yet their words.

## Consequences

- The object ID grammar gains the letters `A` and `N`. Report blocks still accept only the older letters, because reports do not cite arrows or notes.
- Threads cannot anchor to an arrow or note by code yet, since their kind table maps only the older letters.
- Undoing this means a migration that deletes every arrow and text note, which the downgrade does.

## Update 2026-11-08

ANN-039 (arrows and notes in threads, reports, imports and exports) lifted the first two limits. Threads and report blocks now take `A` and `N`, imports bring a note in with its words, and the slide export carries note words, while the training dataset export still leaves them out.
