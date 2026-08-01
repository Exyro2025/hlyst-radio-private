# Never-play visibility and one-click undo

Design for the Discord report:

> When the database contains several identical songs from different albums,
> there's a real lack of visual indication showing which songs are already
> disabled in search results. Also, in case of a misclick when blocking an
> album/artist, you have to go into the block list and restore everything
> manually.

Two asks: **mark blocked rows where the operator is looking**, and **make a
block reversible without leaving the view**.

## What's true today

`music/blocklist.ts` holds one entry per block at track/album/artist
granularity, persisted to `state/blocklist.json`. Matching is id-first
(`song.id` / `albumId` / `artistId`) with a normalised-name fallback for
album/artist, because library-db rows carry only name strings. Enforcement sits
at the Subsonic reject chokepoint, the library-db song sources, and the final
`queue.push()` gate.

Both halves of the report check out:

- **No indication anywhere.** All four admin listing surfaces render blocked
  tracks identically to playable ones:
  - `/library/browse` — `library.filter()` goes straight to `db.filter()` with
    no `rejectBlocked`.
  - `/library/untagged` — raw Subsonic album walk.
  - `/dj/search` — passes `includeBlocked: true` *deliberately* ("the operator
    must still find never-play tracks here to review them"), which is exactly
    right and exactly why the missing piece is the marking.
  - `/dj/recent` and `/library/search-sound` — same shapers, same gap.
- **Reversal is Blocked-tab-only.** `blockTrack` fires `notify.ok(...)` and
  nothing else; `web/lib/notify.ts` has no action/undo affordance at all.

One correction to the report's mental model, worth noting because it shapes the
fix: blocking an artist creates **one** entry, not one per track. Unblocking is
already a single click — the cost is *finding* it, and the anxiety of not
knowing what a stray click just did. So the fix is visibility and locality, not
bulk machinery.

## Design

### 1. The server answers "which entry blocks this row"

In `music/blocklist.ts`:

```ts
export interface BlockRef { type: BlockType; id: string; name: string | null }

export function matchOf(song: any): BlockEntry | null
export function annotate<T>(rows: T[]): T[]   // stamps blockedBy: BlockRef | null
```

`isBlocked()` becomes `matchOf(song) !== null` — one matcher, no second
implementation to drift. Precedence is today's evaluation order, made explicit:
track id → album id → artist id → artist name → album key. It matters because
the badge names an entry the operator can actually remove, so the answer has to
be stable across calls.

`annotate()` returns the array untouched when the list is empty (the existing
`rejectBlocked` fast path), so an install with no blocks pays nothing and ships
no new field.

### 2. Five listing endpoints stamp it

- `toAdminRow` in `routes/dj.ts` — covers `/dj/search` and `/dj/recent` in one
  edit.
- `/library/browse`, `/library/untagged`, `/library/search-sound` in
  `routes/library.ts`.

All admin-gated; no public route grows a field. `blockedBy` is additive, so an
old web build against a new controller ignores it and a new web build against
an old controller simply shows no badges.

### 3. `POST /library/blocklist/check` — re-annotate what's on screen

Body `{ tracks: [{ id, artist, album, albumId?, artistId? }] }` →
`{ blocked: { [id]: BlockRef | null } }`.

After a block or unblock, the rows already rendered are stale. The alternatives
are worse: refetching the active tab loses pagination and scroll (and hits
Navidrome again on the Search tab), and patching client-side means
reimplementing the normalised-name matching in TypeScript — a second matcher
that will drift from the first. A synchronous lookup against the in-memory
index costs nothing.

### 4. Row indication

A badge in the **title cell**, not the tags cell: the `≤860px` media query hides
`.lib-tags` entirely, and a blocked marker that vanishes on a phone is not a
marker.

```
♫  Everlong                        [⃠ never play · artist]
   Foo Fighters · 1997 · 4:10
   The Colour and the Shape
```

New `.lib-btag` in `globals.css`, styled off the danger/accent tokens so it
reads as a stop, not another metadata chip. The scope word is appended only
when the match isn't the track itself (`never play` vs `never play · artist`).
The `title` attribute spells out the entry: *"blocked via artist: Foo
Fighters"*.

The row stays fully legible — this is a browser of the library, not the queue.
Only the badge changes.

### 5. Row-level unblock

When `blockedBy` is set, the row's Ban control becomes an Unblock control — in
both the `sm:+` inline cluster and the phone overflow menu. One click issues
`DELETE /library/blocklist/:type/:id` for the matched entry, then re-checks the
on-screen rows so every sibling the entry covered clears at once (this is the
duplicate-albums case from the report: block one, all copies mark; unblock,
all copies clear).

For an album/artist entry the label carries the blast radius: *"Unblock artist
Foo Fighters"*. The block scope menu is not offered on an already-blocked row —
there is nothing useful to add.

### 6. Undo in the toast

`notify.undo(message, onUndo)` added to `web/lib/notify.ts`, wrapping sonner's
`action` (10s, matching the existing `err` precedent of a longer dwell for
things the operator must notice).

```
✓  Foo Fighters will never air · 3 dropped from queue        [Undo]
```

Undo deletes the entry just created and re-checks the visible rows.

**Deliberately not a confirm dialog.** The existing code comment is right —
"blocking is one-click reversible" — and a modal on every block taxes the
correct clicks to guard the misclick. Undo does the same job after the fact,
and the row badge means a misclick is visible immediately even if the toast is
missed.

### 7. Blocked tab: multi-select and bulk unblock

The second half of the report ("restore everything manually") is real for an
operator who blocked forty tracks one at a time. Add a checkbox per row and an
"Unblock N selected" action, reusing the selection pattern `TrackTable` already
has.

Backed by `DELETE /library/blocklist` with `{ entries: [{type, id}] }` →
`blocklist.removeMany()`. Not N parallel single DELETEs: `remove()` filters the
module-level array synchronously but persists asynchronously, so two in flight
can land the file in the earlier state. One array rewrite, one persist.

## Data flow

```
click Ban → scope
  → POST /library/blocklist            → { entry, purged }
  → notify.undo("… will never air", …)
  → POST /library/blocklist/check      → merge blockedBy into loaded rows

Undo / row unblock
  → DELETE /library/blocklist/:type/:id
  → POST /library/blocklist/check      → merge
```

## Error handling

- **`/check` fails** — rows keep their last-known marks and nothing is
  reported. It is an enrichment, not the operation; a toast here would blame
  the operator for a successful block.
- **Undo fails** — `notify.err`; the block stands and the Blocked tab still
  works. No silent partial state.
- **Bulk unblock partial** — server removes what it can, returns
  `{ removed, missing: [{type,id}] }`; the UI reports the count actually
  removed.
- **Version skew** — covered in §2.

## Testing

Extend `controller/scripts/blocklist.test.ts` (auto-discovered by
`npm test`; no registration step):

- `matchOf` precedence — a track-id entry wins over an artist-name match on the
  same row; an album key needs both name and artist so "Greatest Hits" can't
  cross-match.
- `annotate` returns the input untouched when the list is empty, and stamps
  every row when it isn't.
- `removeMany` removes exactly the named pairs, reports the missing ones, and
  persists once.

`web/` has no test suite; verify the UI with the `verify` skill (isolated
controller + Playwright against `/admin/library`), covering: badge appears on
every duplicate of a blocked album, undo clears them all, and the phone layout
keeps the badge.

## Out of scope

- A confirm dialog on block (see §6).
- Hiding blocked rows, or a "hide blocked" filter. The report asks for
  indication, not exclusion, and the library browser should show the library.
- A track count on artist blocks ("blocks 1,204 tracks"). It needs a per-artist
  count from library-db and the name fallback makes any figure approximate —
  a confident wrong number is worse than the scope word.

## Files touched

| File | Change |
| --- | --- |
| `controller/src/music/blocklist.ts` | `matchOf`, `annotate`, `removeMany`; `isBlocked` delegates |
| `controller/src/routes/library.ts` | annotate browse/untagged/search-sound; `/blocklist/check`; bulk `DELETE /blocklist` |
| `controller/src/routes/dj.ts` | annotate in `toAdminRow` |
| `controller/scripts/blocklist.test.ts` | new cases |
| `web/lib/notify.ts` | `notify.undo` |
| `web/components/admin/library/types.ts` | `BlockRef`, `Track.blockedBy` |
| `web/components/admin/library/TrackTable.tsx` | badge, unblock control |
| `web/components/admin/library/BlockedTab.tsx` | multi-select + bulk unblock |
| `web/components/admin/LibraryPanel.tsx` | check-after-mutation, undo wiring, bulk handler |
| `web/app/globals.css` | `.lib-btag` |
