# Debug: merge the State dir + DJ voices panels into one read-only state-dir tree

Date: 2026-08-12
Status: approved, ready for implementation plan

## Problem

`/admin/debug` renders two side-by-side cards fed from the same `/debug` payload:

- **State dir** — a flat `readdir` of `config.stateDir`, no nesting.
- **DJ voice WAVs** — a flat `readdir` of `state/voice`.

Both go through `web/components/admin/debug/FilesTable.tsx`, and both listings are
computed inside the `/debug` handler, which the panel polls **every 2 seconds**.

Three problems:

1. `voice/` is just one directory in the state dir, so a whole card exists to
   special-case one child of the other card.
2. Neither card can descend. Everything an operator actually wants to inspect —
   `sessions/`, `logs/`, `stems/`, `jingles/`, `stations/<id>/`, `skills/<slug>/` —
   is invisible below the first level.
3. The listings ride the 2s poll, so a readdir plus a stat fan-out runs every two
   seconds forever on the single-threaded controller.

## Solution

One full-width **State dir** card containing a lazy, read-only directory tree
(ai-elements `file-tree`), backed by a new non-recursive listing endpoint. The DJ-voices
card is deleted; `voice/` is expanded by default so its WAVs stay one glance away.

"Read-only" here means **metadata only** — names, sizes, mtimes, dir/file/symlink.
There is no file-content endpoint, so there is no secret-redaction policy to get
wrong (`settings.json`, `secrets.env` and `icecast-secrets.env` all live in this
tree and hold live credentials).

## Controller

### Endpoint

`GET /debug/state-tree?path=<relative>` in `controller/src/routes/debug.ts`, behind
`requireAdmin` like every other route in that file.

```jsonc
{
  "root": "/var/sub-wave",       // absolute path of the tree root, for the card subtitle
  "path": "voice",               // the relative path listed (empty string = root)
  "entries": [
    { "name": "sessions", "isDir": true,  "isSymlink": false, "size": 4096, "mtime": "…" },
    { "name": "settings.json", "isDir": false, "isSymlink": false, "size": 8123, "mtime": "…" }
  ],
  "shown": 500,                  // entries.length
  "total": 214338                // real directory size, before the cap
}
```

Failure shape is `{ error: string }`, matching how `/debug` already reports a failed
state listing.

**One directory per call. The endpoint never walks.** An eager recursive walk is
rejected outright: `stems/` is a byte-budget LRU cache that routinely holds tens of
thousands of directories, and `archive/` grows one mixdown per hour forever.

### Root

The tree roots at **`config.stateDir` — the active station dir**, which is exactly what
the current State dir card lists. In single-station mode that equals `config.stateRoot`.

Consequence, accepted deliberately: on a multi-station install the install-level files
at the root (`icecast-secrets.env`, `hf-cache/`, `analyze-tmp/`) are not browsable.
Rooting at `stateRoot` instead would change the panel's meaning and put the shared
Icecast secrets file one click from the tree. Out of scope.

### Listing

1. `readdir(dir, { withFileTypes: true })` once — `isDirectory()` comes off the dirent,
   so no stat is needed to classify.
2. Sort **directories first, then by name** (`localeCompare` with a fixed locale, so
   ordering does not drift with the container's locale).
3. Take the first `MAX_ENTRIES = 500`.
4. `stat` **only that slice** for `size`/`mtime`; `lstat` (or the dirent's `isSymbolicLink()`)
   sets `isSymlink`. A stat that throws yields the entry with `size`/`mtime` absent rather
   than failing the whole listing.
5. Report `total` = the full pre-cap count, so the UI can say "showing 500 of 214,338"
   instead of silently truncating.

So expanding a 200k-entry `stems/` costs one readdir and 500 stats, not 200k stats.

### Path safety

The guard lives in **one pure helper**, `controller/src/util/state-path.ts`:

```ts
resolveStatePath(root: string, rel: string): string | null
```

Never inline the rule at the route — the same reasoning as `util/request-guard.ts`
and `audio/voice-library.ts`'s `resolve()`: one copy, unit-testable, no second
opinion at a second call site.

Rules, in order:

1. An absolute `rel` is refused.
2. Normalise; any remaining `..` segment refuses.
3. Join to root, then require **realpath containment**: the resolved real path must
   equal root or start with `root + path.sep`.

Rule 3 is what makes a symlink planted inside the state dir unable to expose
`/etc` or the host's music library. It is compatible with the documented way to
relocate the stem cache, which is a **bind mount** at `<state>/stems` (root `CLAUDE.md`,
state-bootstrap bullet): a bind mount realpaths *inside* root; a symlink does not.

An entry whose target escapes root still **appears** in its parent's listing (with
`isSymlink: true`) but returns `{ error }` when expanded. Hiding it would misrepresent
what is on disk; the operator should see that the link exists.

`resolveStatePath` returning `null` is a **400**, not a 404 — the request was malformed,
not the path missing. A well-formed path that does not exist is the `{ error }` shape.

### Removals

Section 5 of the `/debug` handler (`out.stateFiles` / `out.voiceFiles`, `controller/src/routes/debug.ts`
~lines 208–228) is deleted outright. That removes a readdir plus a stat fan-out from
**every 2-second poll**, which is the main performance win here.

## Web

### Vendoring the tree

`npx ai-elements@latest add file-tree` → `web/components/ai-elements/file-tree.tsx`,
joining the 16 ai-elements components already vendored here (the debug panel's own
Liquidsoap log runs on `ai-elements/terminal`). One file. Declared deps are
`lucide-react` plus the `collapsible` registry item — both already present, so
there is nothing to install.

Chosen over kibo-ui's `tree`, which was the first candidate, for three concrete
reasons rather than familiarity:

1. **`onExpandedChange` is a real callback.** Lazy loading needs a hook at the
   moment a folder opens. kibo's tree keeps `expandedIds` entirely internal with
   no callback out, so the fetch had to hang off `onClick` on both the row AND
   the chevron — two call sites for one event, and neither fires for a keyboard
   expand.
2. **No inline styles.** kibo indents by an inline `level * indent` pixel padding,
   which this repo forbids (issue #50) and which would have needed an eslint
   exemption plus a hand-rolled indent scale for the status rows. `FileTreeFolder`
   nests its children in a `ml-4 border-l pl-2` wrapper instead, so indentation
   is DOM structure and every row is lint-clean.
3. **Real buttons and keyboard handling.** kibo's rows are `motion.div`s with
   click handlers — no tab stop, no Enter/Space. ai-elements ships `<button>`
   elements and an explicit `onKeyDown`.

Two import aliases are rewritten on the way in: `@/registry/default/ui/collapsible`
→ `@/components/ui/collapsible`, and `@/lib/utils` → `@/lib/cn`. (`components.json`
already maps the `utils` alias to `@/lib/cn`, so the CLI does the second one itself.)

**`FileTreeFile` renders `children ?? (icon + name)` — children REPLACE the default
row, they do not append to it.** Passing only a size/mtime column erases the
filename. The whole row is composed at the call site through the exported
`FileTreeIcon` / `FileTreeName` subcomponents.

### `components/admin/debug/StateTree.tsx`

New, self-contained, owns all tree state:

- A `Record<relPath, DirState>` cache, where `DirState` is
  `{ status: 'loading' | 'ready' | 'error', entries, shown, total, error }`.
- The tree is driven **controlled** (`expanded` + `onExpandedChange`) rather than
  left to its own internal state, because expanding a folder is what triggers the
  fetch: the callback IS the load hook. A path that has just been expanded and was
  never fetched gets one `adminFetch('/debug/state-tree?path=…')`; an already-cached
  directory re-opens with no request, and collapse keeps the cache.
- An `inFlight` ref de-dupes a directory already being fetched, so expand →
  collapse → expand cannot fire the same listing twice.
- On mount it prefetches **two** paths: the root and `voice`, so the default-expanded
  `voice/` node is populated on first paint.
- A **Refresh** button clears the cache and re-fetches the currently expanded paths.
- Loading, empty and error states use the shared admin components
  (`ui/skeleton`'s `SkeletonRows`, `ui/empty-state`, `ui/error-state`) — not hand-rolled
  "loading…" divs.
- A truncated directory renders a final non-interactive row: `… showing 500 of 214,338`.

### `DebugPanel.tsx`

The `grid-cols-2` block holding the two cards is replaced by a single full-width card:

```tsx
<Card title="State dir" sub={root}>
  <ScrollArea className="max-h-[480px]">
    <StateTree />
  </ScrollArea>
</Card>
```

`sub` comes from the endpoint's `root` field, replacing the hardcoded `/var/sub-wave`
string — which is already wrong on a multi-station install and on any non-Docker run.

**The tree does not ride the 2s `/debug` poll.** It fetches on mount and on Refresh.
A filesystem tree re-fetched every two seconds would fight the user's expansion state,
and there is no live signal in it worth that cost.

### Removals

- `web/components/admin/debug/FilesTable.tsx` — DebugPanel is its only consumer.
- `stateFiles` / `voiceFiles` from `web/components/admin/debug/types.ts`, plus the
  `FilesValue` / file-entry types if nothing else references them.

## Testing

`controller/scripts/state-tree.test.ts`, `node:test` (per-assertion reporting), dropped
into `controller/scripts/` — that is the whole registration step. It builds a temp
directory and covers:

- **Traversal**: `../`, `../../etc`, an absolute path, `a/../../b`, and a path that
  normalises back inside (`a/../b`, which must be *allowed*) — all through
  `resolveStatePath`.
- **Symlink escape**: a symlink inside the temp root pointing outside it is refused
  by `resolveStatePath` but still appears in its parent listing with `isSymlink: true`.
- **Cap**: a directory with more than `MAX_ENTRIES` children returns exactly
  `MAX_ENTRIES` entries with an honest `total`.
- **Ordering**: directories before files, name-sorted within each group.
- **Missing directory**: the `{ error }` shape, not a throw.

Run `npm test` in `controller/` before pushing — CI does not run it.

`web/` has no test suite. UI verification goes through the `verify` skill: an isolated
controller on a spare port with a temp `STATE_DIR`, the worktree Next dev server, and
Playwright against `/admin/debug` — confirming the merged card renders, `voice/` is
expanded on load, a nested directory lazy-loads on expand, and a capped directory shows
its truncation row.

## Non-goals

Explicitly out of scope, so the read-only surface stays small:

- File contents (no preview, no `cat` endpoint).
- Downloads.
- Any write: no delete, rename, upload, or chmod.
- Search or filter across the tree.
- Browsing `stateRoot` on a multi-station install.
- Live polling of the tree.
