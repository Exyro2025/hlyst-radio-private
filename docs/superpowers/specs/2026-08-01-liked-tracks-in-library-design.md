# Liked tracks in the admin library

Date: 2026-08-01
Origin: Discord operator report

## The ask

> Would be good to see the liked tracks either on the liked tracks page or
> directly in the library page as a filterable item. Would also be helpful to
> unlike or like a track directly in the library page as well. Should we remove
> liked tracks from admin dash?

Three things: surface liked tracks in `/admin/library`, let the operator
like/unlike from there, and decide the fate of the Dash Likes card.

Note the premise correction: there is no "liked tracks page" today. Likes
surface in exactly one place, the Dash `LikesCard`.

## Current state

- **Store**: `state/likes.json`, owned by `controller/src/broadcast/likes.ts`.
  A `LikeRecord` is `{ songId, track (slim snapshot), airingKey, listenerKey,
  likedAt }`.
- **Identity**: `listenerKey = HMAC(persisted secret, ip)`, 24 hex chars. Raw
  IPs are never stored. Accountless by design — one NAT is one key.
- **Dedup**: `airingKey = ${songId}|${startedAt}`, so one like per apparent
  listener per *airing*. The same song aired later is likeable again.
- **Cap**: `MAX_RECORDS = 5000`, oldest trimmed first.
- **Picker**: `topLiked({ windowDays, limit })` feeds both pick paths as a
  weighted preference when `settings.likes.influenceDj` is on. Default window
  is 30 days.
- **Navidrome**: `settings.likes.starInNavidrome` mirrors each first like to a
  Subsonic star, fire-and-forget. Deleting likes never unstars.
- **HTTP**: `POST /like`, `GET /like` (public); `GET /likes`,
  `DELETE /likes/song/:id`, `DELETE /likes` (admin). `GET /likes`'s only
  consumer is `DashPanel`.
- **Library page**: the Browse tab queries `library.db` and is hard-gated to
  tagged tracks (`SQL_HAS_MOODS`). The Tracks tab has an **All / Needs tags**
  segmented toggle. Search results come from Navidrome, not `library.db`.
- **Tests**: the likes store has none.

## Decisions

1. An operator like is a **real like record tagged `via: 'operator'`** — it
   counts, it feeds the picker, it stars in Navidrome.
2. Liked tracks are a **third mode on the Tracks tab**, not a sixth tab and not
   a Browse facet.
3. The **Dash Likes card is removed**.

Why not a Browse facet, given the ask said "filterable item": Browse is gated
to tagged tracks. A liked-but-untagged track — likely, since listeners heart
whatever is on air — would be silently missing from a view whose whole purpose
is "show me the liked ones". The Tracks tab already carries a mode toggle and
has no such gate.

Why not a sixth tab: the tab strip already wraps to two rows below `sm:`
(see the comment in `library/Tabs.tsx`), and Liked is a *view of tracks*, which
is precisely what the Tracks tab's toggle is for.

## Design

### 1. The operator like

Add an optional `via?: 'operator'` to `LikeRecord`. Operator records use:

- `listenerKey: 'operator'` — a reserved literal. It cannot collide with a real
  key, which is always 24 hex characters.
- `airingKey: ${songId}|operator` — there is no airing. The existing dedup then
  makes an operator like idempotent per song, exactly once, forever.

Two consequences must be handled explicitly or the feature quietly rots:

- **Window exemption.** `topLiked` drops records older than `windowDays`
  (default 30). A listener like ageing out is correct — it is a snapshot of
  recent taste. An operator like ageing out is wrong — it is curation,
  deliberately set, and its silent expiry reads to the operator as the DJ
  forgetting a favourite. Operator records skip the cutoff.
- **Trim exemption.** `records.slice(-MAX_RECORDS)` evicts oldest-first.
  Curation must not be evicted by listener volume. The trim drops oldest
  *listener* records only. If operator records alone ever exceed the cap, the
  store is far outside its design envelope; the trim then falls back to plain
  oldest-first so the cap still holds.

`countForSong` keeps counting every record, operator included. The operator's
heart *is* a like — it should show in the count and it should reach the picker.
The `via` marker exists so surfaces can tell the two apart, not so one is
second-class.

`recent()` includes operator records; `listenerKey.slice(0, 8)` renders as the
self-describing handle `operator`.

### 2. Controller API

**`POST /likes/song/:id`** (admin) — operator like.

Body: optional `{ title, artist, album, genre, year, duration }`. Snapshot
resolution order: request body → `library-db.getTrack(id)` →
`subsonic.getSong(id)` → `{ id, title: 'unknown' }`. The library UI always
sends the body, so the common path costs no extra I/O.

Fires `subsonic.star(id)` fire-and-forget when `starInNavidrome` is on, exactly
as a listener like does. Returns `{ ok, count, operator: true }`. Idempotent —
a second call is a no-op that still reports the count.

**`DELETE /likes/song/:id/operator`** (admin) — operator unlike.

Removes only the record with `via: 'operator'`. Every listener like for the
song survives.

Unstar rule: when `starInNavidrome` is on **and** no likes remain for the song
after removal, fire `subsonic.unstar(id)`. This is the one place the store's
"deleting never unstars" rule bends, deliberately: this is the operator
toggling their own heart, not an admin pruning listener data, and a toggle that
stars on but never stars off is a bug rather than a policy. The "no likes
remain" guard is what keeps it safe — a star earned by twenty listener likes is
never discarded because the operator un-hearted.

Returns `{ ok, removed, count }`.

**`GET /likes/index`** (admin) — the like map that decorates rows.

`{ songs: { [songId]: { count: number, operator: boolean } } }`. Bounded by
distinct liked songs (≤ `MAX_RECORDS` = 5000); at roughly 20 bytes an entry the
ceiling is ~100 KB on an admin-only fetch, and a real station sits orders of
magnitude under it.

One map, rather than annotating every listing endpoint, is what makes the heart
work on *all* library views. Browse, Tracks, Search and sounds-like results come
from four different sources (`library.db`, `library.db`, Navidrome `/dj/search`,
CLAP KNN); teaching each about likes is four changes plus a fifth for whatever
is added next. It also covers the Navidrome search path, which has no
`library.db` row to annotate at all.

**`GET /library/liked`** (admin, in `routes/library.ts`) — the Liked-mode
listing.

Query: `limit` (≤ 200, default 50), `offset`, `sort` ∈ `recent | count | artist`
(default `recent`), `q` (substring over title/artist/album).

It lives in `library.ts` rather than `likes.ts` because it does `library.db`
enrichment and returns the `Track` shape the panel's table already renders — a
library listing whose *source* happens to be the likes store.

Per song it merges the stored snapshot (always present, so a liked track that
was never walked or tagged still renders) with the `library.db` row where one
exists (moods, energy, bpm, key, LUFS, instrumental). Rows carry `likeCount`,
`likedByOperator`, `lastLikedAt`. Station-archive rows are filtered through
`subsonic.isStationArchive` like every other listing (#273).

Sort semantics: `recent` is `lastLikedAt` descending; `count` is `likeCount`
descending, tie-broken by `lastLikedAt` descending so equal-count songs order
stably; `artist` mirrors the Browse tab's default (artist, album, title, all
case-folded).

`GET /likes`, `DELETE /likes/song/:id` and `DELETE /likes` are unchanged.
`GET /likes` loses its only UI consumer when the dash card goes but stays as an
admin API surface.

### 3. Liked mode on the Tracks tab

`TrackMode` becomes `'all' | 'needs' | 'liked'`; `TableVariant` gains
`'liked'`. The `Seg` toggle reads **All / Needs tags · N / Liked · N**, where
the Liked count is the number of distinct liked songs — available for free as
the size of the already-fetched `likeIndex` map, so the label needs no extra
request and stays correct after an optimistic toggle.

`LibraryPanel` state: `liked` rows, `likedTotal`, `likedLoading`, `likedSort`,
plus the shared `likeIndex` map fetched on panel mount. URL sync mirrors the
existing `?view=needs` pattern with `?view=liked`; entry-load follows the same
effect shape as the `all` and `needs` modes.

The sort control (`recent | count | artist`) and a Refresh button occupy the
card's `right` slot when the mode is `liked` — the same slot the other two
modes already use.

Pagination follows the Browse tab (prev/next over `likedTotal`) rather than the
untagged tab's cursor, because the likes store is a bounded in-memory array
with a stable, cheap total.

Empty state: "No likes yet — the heart on the player feeds this, and you can
heart tracks here yourself."

### 4. The heart on every row

`TrackTable` gains `likeCount`, `liked` (operator flag) and `onToggleLike`,
wired from `likeIndex`:

- **Inline cluster (`sm:`+)**: a Heart button before Queue. Filled and vermilion
  when the operator has liked it, outline otherwise. When the count is above
  zero it rides alongside as `♥ 3`.
- **Overflow menu (below `sm:`)**: "Like this track" / "Unlike this track",
  plus "Clear all likes (N)" when `count > 0`. That last item wraps the
  pre-existing `DELETE /likes/song/:id` and is the operator's tool for pruning
  listener likes — something the heart deliberately does not do.
- Optimistic toggle with rollback on failure, reporting through the toaster the
  way `blockTrack` and `retagTrack` already do.

In Liked mode, an unlike that drops the count to zero removes the row (nobody
likes it any more); a count above zero keeps the row with an unfilled heart.

### 5. Removing the Dash Likes card

Delete `web/components/admin/dash/LikesCard.tsx`. From `DashPanel.tsx` remove
the import, the `likes`/`likesErr` state, the 15s polling effect and the render.
From `dash/types.ts` remove `LikesPayload`, `LikeTopEntry` and `LikeRecentEntry`
once unreferenced.

What moves and what is lost:

- The top-8 leaderboard → Liked mode sorted by `count`.
- The recent-likes feed → Liked mode's default `recent` sort, with each row's
  `lastLikedAt`.
- **Genuinely lost**: the per-like listener handle (`listenerKey.slice(0, 8)`).
  That is a per-*record* detail and a per-*track* view has no row for it.
  `GET /likes` still returns it for anyone who wants it.

`settings/LikesSection.tsx` copy currently says likes "land in the Dash" —
retarget it at the library.

### 6. Tests

New `controller/scripts/likes.test.ts` — dropping the file into
`controller/scripts/` is the whole registration step. Setup follows
`blocklist.test.ts`: `process.env.STATE_DIR = mkdtempSync(...)` before the
dynamic `import('../src/broadcast/likes.js')`, since `likes.ts` resolves
`STORE_FILE` from `config.stateDir` at module scope.

The store has no test today, and this change adds three rules that are
invisible until they break:

- an operator like is idempotent per song
- an operator record is exempt from the `topLiked` window cutoff; a listener
  record of the same age is not
- an operator record survives a trim that evicts older listener records
- an operator unlike removes only the operator record, leaving listener likes
  and the count intact
- `countForSong` includes the operator record
- a plain listener like is byte-identical to today's behaviour (no `via` key)

`npm run lint` in `controller/` and `web/` is the merge gate; `npm test` in
`controller/` is not run by CI, so run it locally before pushing.

## Out of scope

- A listener-facing liked list on the player.
- Per-listener like management. The store is accountless on purpose.
- Likes in the Observatory or the Playlist Builder.
- Backfilling `via` on existing records — absent means listener, which is
  already correct.
