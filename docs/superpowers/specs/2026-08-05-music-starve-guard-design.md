# Music starve guard — design

Issue #1300, bug 7. The station loops jingles forever when the music source
starves, and the one dead-air guard in the chain is structurally blind to it.

## The bug, reproduced

`radio.liq:963` builds the jingle rotate over the raw music chain:

```liquidsoap
rotate(weights=[1, jingle_ratio()], [jingles, music])
```

`rotate` skips unavailable sources. With `music` starved — Navidrome
unreachable, or `auto.m3u` empty/exhausted — the rotate has no track boundary
to return to and serves `jingles` back to back indefinitely. The `emergency`
fallback at `radio.liq:1195-1196` sits *below* the rotate and never fires,
because `radio` is still "available": it is producing jingles.

Reproduced against Liquidsoap 2.4.5 (the version `Dockerfile.broadcast` pins)
with a minimal mirror of the chain and an empty `auto.m3u`:

```
t=1 music_ready=false jingles_ready=false radio_ready=false
t=2 music_ready=false jingles_ready=true  radio_ready=true
t=3 music_ready=false jingles_ready=true  radio_ready=true      <- jingles forever
...
```

`music_ready=false` alongside `radio_ready=true` is the whole bug in one line:
the mixer knows the music chain is empty and the safety net cannot see it.

## Signal

`source.is_ready(music_meta)`.

`music_meta` (`radio.liq:912`) is already a handle on the **pre-rotate**
music chain — `cue_cut(fallback([dj_queue, auto_playlist]))` — captured for the
`on_metadata` hook. It is exactly the source whose emptiness defines a starve,
and it needs no new plumbing. `is_ready` is confirmed present on 2.4.5
(`is_ready : () -> bool` on the source type).

Deliberately NOT a Navidrome reachability probe: a starve also happens with
Navidrome perfectly healthy (empty `auto.m3u`, a strict show whose pool
resolved to nothing, an exhausted playlist). The mixer's own readiness is the
only signal that covers every cause, and it is the one that matches what
listeners are actually hearing.

## Hysteresis, and why the window is the feature

A raw `is_ready` gate would be wrong: the music chain is legitimately
not-ready at a track boundary while the next request resolves (a full
`subhttp` download). `SKIP_COMMIT_WAIT_MS = 20_000` in
`broadcast/skip-policy.ts` is the project's own measured bound on that window.

So the latch requires a **sustained** starve: `STARVE_GRACE_SEC = 30.0`,
sampled every `1.0s` (matching `poll_queue`'s existing cadence). Thirty
seconds clears the known worst case with margin.

The window is not merely a false-positive guard — it *is* the "a jingle may
cover a brief hiccup" behaviour, for free. A 10s Navidrome blip is still
papered over by a stinger exactly as today; only a sustained outage escalates.

Recovery is immediate and unconditional: any tick that sees the source ready
resets the counter and clears the latch. No restart, no operator action.

## On-air behaviour

Gate the jingles source on the latch, alongside the existing bed gate:

```liquidsoap
jingles = source.available(jingles, {not bed_on_air() and not music_starved()})
```

Once latched, jingles stop covering, the rotate has nothing, `radio` goes
unavailable, and the **existing** `fallback(track_sensitive=false, [radio,
emergency])` fires the `emergency.mp3` "technical difficulties" loop. No new
source, no new output — the fix restores the dead-air guard that was already
there.

Verified end to end on 2.4.5 with a 5s grace for the test:

```
t=2..5   music=false starved=false jingles=true  programme=true    <- grace: jingle covers
STARVED latched after 5.0s
t=6..13  music=false starved=true  jingles=false programme=false   <- emergency fires
(auto.m3u refilled)
RECOVERED
t=14..20 music=true  starved=false jingles=true  programme=true    <- back, no restart
```

### `jingle_ratio = 0`

When jingles are off (#997) the rotate is not built at all, so a starved
`music` already makes `radio` unavailable and the emergency loop already
fires correctly. The `source.available` gate therefore lives **inside** the
`jingle_ratio() > 0` branch. The detection tick and the marker write live at
top level, because admin should report a starve regardless of whether jingles
happen to be masking it.

### Idle gate

The latch is suppressed while `idle_mode()` is on. With the programme
deliberately frozen for an empty room, "the music source is starved" is not a
meaningful claim, and latching there would raise a banner about a station
nobody is listening to. The counter resets while idle, so the first listener
back gets a full fresh grace window rather than an instant latch.

## Ordering constraint

Liquidsoap evaluates definitions in order, and this change spans three points
in the file:

- `music_starved` / `starved_for` refs — declared **early**, with the other
  refs near the top.
- The `source.available` gate — at line 962, inside the jingle branch. It
  reads the ref from inside a `{...}` thunk, evaluated per-frame, so the ref
  needs only to *exist* by then, not to be driven yet. This is the same
  pattern `bed_on_air` already uses (set later, in `on_meta`).
- The detection tick (`thread.run`) — registered **late**, after
  `idle_mode` is defined (~line 1210), since it reads both `music_meta`
  (line 912) and `idle_mode`.

Getting this wrong is an unbound-variable error at startup, i.e. a station
that will not boot. It is called out here because the natural instinct is to
put all three together.

## The tick must not be able to die

The probe surfaced a failure mode worth designing against explicitly. An
uncaught exception inside a `thread.run` callback **kills that thread
permanently** — liquidsoap logs `[runtime:1] Uncaught error` and the tick
never fires again. Observed directly when a `file.write` inside the tick hit
`EACCES`: the guard latched starved and then froze there, emergency loop
forever, recovery impossible.

For a safety guard that is the worst possible outcome, and the trigger is
realistic: the marker write below touches the state mount, which is exactly
the thing `ensure_tmp_dir` already exists to defend against.

**Therefore: the marker write is wrapped in `try ... catch` inside the tick.**
A failing write degrades to "the guard still works, the marker is just stale"
rather than "the guard is dead and the station is stuck on the emergency
loop". The detection and gating logic must not share a failure domain with
the reporting.

## Reporting — `music-starved.json`

`radio.liq` writes `${state_dir}/music-starved.json`, same pattern and
rationale as `jingle-playing.json` / `bed-playing.json`:

```json
{ "starved": true, "since": 1785934821.4, "at": 1785934851.4 }
```

`since` and `at` are unix **seconds** — liquidsoap's `time()`, matching
`startedAt` in the two existing markers. The controller works in
milliseconds, so the conversion happens once, at the parse boundary in
`starveState`, and never again. (`jingle-playing.json`'s consumer in
`queue/voice-io.ts` already has to do this; do it the same way.)

- Written on each **edge** (latch and clear), and once at startup with
  `starved: false` so the file exists on a healthy station.
- While starved, `at` is refreshed every tick as a **heartbeat**. This is what
  lets the controller tell a live starve from a mixer that died mid-starve and
  left a stale `true` on disk. Zero steady-state cost: the heartbeat only runs
  during an outage, when nothing else is happening anyway.
- `atomic=true` with its **own** temp dir,
  `starve_tmp_dir = ensure_tmp_dir("#{state_dir}/tmp/starve")` — one dir per
  writer, per #1240, because the stdlib always names its temp file
  `atomic.write` inside the dir it is given.

## Controller — `broadcast/music-starve.ts`

A new module, following the established pure-policy split (`skip-policy.ts`,
`drain-policy.ts`, `voice-policy.ts`, `stream-idle-pure.ts`):

```ts
// Pure, unit-pinned. `now` and the returned `since` are epoch MILLISECONDS;
// the marker's seconds are converted here and nowhere else.
export function starveState(
  marker: unknown,
  now: number,
): { starved: boolean; since: number | null }
```

Rules, all fail-safe toward **not starved**:

- absent file → `{starved: false}`. An older mixer that does not write the
  marker must not read as a permanent outage.
- malformed JSON / wrong types → `{starved: false}`.
- `starved: true` with `at` older than `STARVE_MARKER_STALE_MS` (60_000) →
  `{starved: false}`. The heartbeat stopped; the mixer is gone, and a dead
  mixer has its own louder failure modes. Same reasoning as
  `BED_MARKER_FRESH_MS` in `queue/voice-io.ts` — these markers are never
  deleted, so freshness is the only thing separating a live signal from one
  that survived a restart.
- `starved: true`, fresh `at` → `{starved: true, since}`.

Failing toward "not starved" is the right direction: a missed banner costs
less than a permanent false alarm, and the `NavidromeBanner` already covers
the most common cause independently.

The reader wraps this in `util/ttl-cache.ts` (from #1304) with a ~2s TTL and
single-flight, so `/state` polling from many clients cannot turn into a
file read per request.

## `/state`

Two fields, next to `streamIdle` in `routes/public.ts` — which exists for
precisely the neighbouring purpose, telling "quiet because the room is empty"
from "broken":

```ts
musicStarved: boolean,
musicStarvedSince: number | null,   // epoch ms, null when not starved
```

## Admin banner

`web/components/admin/MusicStarvedBanner.tsx`, rendered in `AdminShell`
alongside `NavidromeBanner`, polling `/state` on the same 30s cadence.

Copy says what is actually happening — the station has no music to play and is
airing the emergency loop — and links to `/admin/doctor`, since the cause
varies (Navidrome, an empty `auto.m3u`, an over-strict show) and the Doctor is
the page that diagnoses across all of them.

**Suppressed while the Navidrome banner is showing.** A Navidrome outage
raises both, and two stacked red bars saying overlapping things is worse than
one. `NavidromeBanner` gains an optional `onStatus` callback; `AdminShell`
holds the flag and passes `suppressed` down. Two small edits, no restructure —
the Navidrome banner keeps owning its own poll and stays the more specific,
more actionable message when it applies.

## Testing

- `controller/scripts/music-starve.test.ts` — the pure `starveState` across
  absent / malformed / stale / fresh-starved / recovered, plus the exact
  staleness boundary. Dropping the file into `controller/scripts/` is the
  whole registration step.
- `liquidsoap --check liquidsoap/radio.liq` against `savonet/liquidsoap:v2.4.5`
  — nothing in CI validates `radio.liq` today, so this is a manual gate. It
  catches the ordering constraint above.
- The docker probe harness used to reproduce and verify this design, re-run
  against the real `radio.liq`: starve → latch → emergency → refill →
  recovery.
- On-air smoke test on the dev stack before marking ready, as #1322 did:
  point the station at an empty `auto.m3u` with Navidrome stopped, confirm the
  emergency loop engages after ~30s, the banner appears, and recovery is
  automatic when the source returns.

## Out of scope

Declined during design, recorded so they are not silently re-litigated:

- **Booth log / event log lines** on the starve edges.
- **`station.starved` webhook event** and a `doctor/checks-station` entry.
  `WEBHOOK_EVENTS` is a stable public contract; adding to it deserves its own
  decision.
- **Operator-configurable grace window.** This is a safety guard, not a taste
  knob. `STARVE_GRACE_SEC` is a constant in `radio.liq`, like the duck depths.
