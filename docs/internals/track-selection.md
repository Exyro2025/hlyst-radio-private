# Internals: track selection architecture

This document traces how SUB/WAVE chooses an automatically queued track. It
separates deterministic library work from decisions made by an LLM, records
which operator-controlled settings reach each decision, and defines how to
evaluate smaller Producer models without confusing valid tool syntax with good
radio programming.

The vanilla architecture described here was checked against upstream
`develop` at `8d3f1dbb`. The optional Producer/Persona notes describe the fork's
Stage C implementation.

## Executive summary

There are two automatic selection paths:

1. The default session agent, `djAgentPick`, lets the LLM choose discovery
   tools and their arguments, inspect the returned candidates, and choose the
   final track ID.
2. The stateless fallback, `pickNextTrack`, builds a balanced candidate pool in
   controller code and asks the LLM only to choose the final track ID.

The missing step between “roughly a dozen candidates” and “one queued track” is
therefore an LLM editorial decision. There is no deterministic aggregate score
which selects the winner. The prompt tells the model to weigh, in order:

1. **Flow** — energy, mood, tempo, key, pace, arrangement and vocal space;
2. **Context** — daypart, weather, room mood and show intent;
3. **Variety** — artist rotation, energy rotation and unaired/deep material;
4. **Interest** — prefer a track which creates a moment over a generic choice.

Controller code still constrains and sometimes corrects that decision. It
enforces recency, strict show filters, playlist locks and blocklists before the
model can choose; rejects IDs no tool returned; repairs slightly corrupted IDs;
re-picks or uses the pool to avoid the same artist back-to-back; validates
transition effects against analysis; and falls back to the first pool candidate
if the final stateless LLM call fails.

This has an important consequence for small-model experiments:

- raw tool execution is not made “smarter” by a larger picker model;
- the model does decide **which** tools and arguments to use;
- the model also performs the multi-factor final ranking;
- valid tool calls and valid IDs do not prove that the chosen music is good.

A 270M function-calling model is therefore not a drop-in equivalent to the
current Producer. It may be a viable discovery router after task-specific
fine-tuning, but the present contract also asks it to act as the station's music
editor. That editorial ability must either be demonstrated independently or
moved to deterministic code/a second capable model.

## End-to-end flow

```text
track starts
  |
  +-- resolve the show expected when the queued track will air
  +-- calculate recency and hard no-repeat sets
  +-- resolve strict music filters, pinned playlists and exclusions
  +-- optionally advance a DJ mini-run / sonic journey
  |
  +-- session agent enabled, budget normal, breaker closed?
  |     |
  |     +-- yes: djAgentPick (or djProducerPick on the split fork)
  |     |     1. LLM chooses discovery tool call(s) and arguments
  |     |     2. tools query Navidrome/library indexes
  |     |     3. shared code filters, samples and records candidates
  |     |     4. LLM chooses an exact surfaced ID + transition
  |     |     5. controller validates/repairs/artist-guards the choice
  |     |     6. enqueue it; optionally create an on-air link
  |     |
  |     +-- failure/no usable candidate: fall through
  |
  +-- pickViaPool / pickNextTrack
        1. controller gathers a balanced pool from fixed sources
        2. controller filters and soft-ranks it, capped at 18
        3. LLM chooses one exact ID + transition
        4. controller validates/repairs, else takes candidate[0]
        5. enqueue it; optionally create an on-air link
```

Liquidsoap's `auto.m3u` remains the final no-LLM coast path if the controller
cannot fill the queue.

## Path A: session agent discovery and choice

### Inputs assembled by controller code

Before the LLM is called, `broadcast/dj-agent.ts` resolves:

- the current and previous track;
- time-scaled track recency and a non-relaxable count-based no-repeat set;
- queued track IDs;
- the show expected at the future air time;
- strict genre, era, mood, energy and vocal locks, where library coverage
  permits them;
- pinned playlist tracks and an optional strict playlist ID lock;
- excluded-playlist IDs;
- an optional sonic-journey waypoint;
- recent transitions, listener favourites, mini-run direction and an
  occasional exploration nudge.

These become one `PickerScope`. The scope is closed over by the tools; the
model never receives the raw lock sets or embedding vectors.

### What the model sees

The vanilla `djAgentPick` system prompt contains:

- the active Persona name and Soul;
- the Persona language and any co-host roster wording;
- station house rules, explicitly scoped to listener-facing speech fields;
- an instruction to treat the station as a continuous shift in DJ mode;
- the active Show Brief/Topic;
- prose describing structured show music steering;
- strict or preferred pinned-playlist guidance;
- the shared Flow/Context/Variety/Interest criteria;
- listener-request safety wording;
- the available discovery-round contract;
- optional transition-effect guidance.

The current pick event supplies the current track ID/title/artist, the previous
track, whether a link is wanted, and current operational nudges. A bounded
session window can also carry recent private pick rationales, listener events
and aired segments, although old pick events and all but the latest few pick
rationales are removed. In an ordinary session with no intervening listener
conversation, message normalization may leave little more than the latest pick
event.

The output contract is:

- `id`: an exact ID returned by a discovery tool in this run;
- `reason`: a private, short editorial scratchpad;
- `say`: an optional listener-facing link in the vanilla all-in-one path;
- `transition`: a requested transition treatment or null/normal.

### Discovery rounds

For `openai-compatible`, Ollama and Locca providers, the default is one forced
discovery round followed by one forced `done` call. A model may emit more than
one parallel tool call in that discovery round if its tool format supports it.
Native cloud providers default to three discovery rounds. The operator can
override this between one and five.

The same LLM performs both stages:

1. choose a discovery strategy and generate tool arguments;
2. after seeing results, choose the final candidate ID.

The `seen` map accumulates every candidate returned during the run. A final ID
which is not in `seen` is not accepted as a valid agent choice.

## Discovery tools

Each available tool is deterministic with respect to its arguments, current
library/index state and its internal sampling. The picker model does not alter
the database query after it has made the call. It does, however, decide which
tools to call and supplies semantic arguments such as a mood, genre, artist or
sound description.

Ordinary automatic picks can be offered:

| Tool | Principal source and purpose | Model-sensitive part |
|---|---|---|
| `searchLibrary` | Navidrome lexical search, then text-embedding fallback | query wording |
| `similarSongs` | music server artist/genre/listening similarity | seed ID and whether to use it |
| `topSongsByArtist` | popular songs for an artist | artist choice |
| `recentByArtist` | newest library releases for an artist | artist choice |
| `songsByGenre` | fuzzy-resolved Navidrome genre | genre choice |
| `tracksByMood` | station mood tags, optionally intersected with energy | mood and energy choice |
| `tracksByEnergy` | station low/medium/high energy tags | energy choice |
| `tracksLikeThis` | controller text/metadata embedding KNN | seed choice |
| `tracksThatSoundLikeThis` | CLAP audio KNN | seed choice |
| `searchByLyrics` | query text embedded against the text index | theme/query wording |
| `searchBySound` | CLAP text-to-audio search | sound description |
| `deepCuts` | never aired or not aired for the configured long interval | whether to call it |
| `recentlyAdded` | sample from recently added albums | whether to call it |
| `starredSongs` | operator-starred tracks | whether to call it |
| `randomSongs` | whole-library random sample | whether to call it |
| `showPlaylistTracks` | active show's pinned playlists | whether to call it; conditional availability |
| `tracksTowardJourney` | CLAP KNN around a controller-owned journey waypoint | whether to call it; conditional availability |

`identifyRequestedTrack` is registered only for the listener-request path when
web reference resolution is enabled; it is not part of an ordinary automatic
pick.

### Shared result shaping

All tools pass tracks through `PickerContext.collect()` before the model sees
them. This code:

- applies strict show filters and playlist/blocklist intersections;
- removes recently played and already-surfaced tracks;
- preserves the hard no-repeat set even when softer recency is relaxed;
- freshness-biases and randomizes ordering;
- normally caps one artist at three results;
- caps most tool results at eight tracks (`showPlaylistTracks` uses twelve);
- records every returned track in `seen`;
- projects stable metadata and measured fields into a compact shape.

The compact candidate can include ID, title, artist, album, year, genres,
moods, energy, duration, instrumental status, BPM, key, intro timing, perceptual
pace, section count and an `unaired` flag. Unknown fields are omitted rather
than guessed.

Tool execution therefore contains meaningful code intelligence independent of
the LLM. Model intelligence matters before and after it: choosing an appropriate
query, then interpreting the candidates.

## The final agent decision

After discovery, the LLM is forced to return the structured pick. It sees the
tool results and applies the shared selection criteria. There is no hidden
weighted score combining all four criteria.

The controller then applies safeguards:

1. exact ID lookup in `seen`;
2. conservative near-ID repair for a mistranscribed NanoID;
3. a constrained LLM re-pick over `seen` if the model returned an unknown ID;
4. a same-lead-artist guard, with a constrained re-pick over other artists;
5. a stateless pool rescue if the run exposed no usable other artist;
6. queue de-duplication, blocklist enforcement and transition validation.

These safeguards measure grounding and basic rotation, not editorial quality.
A model can pass every one while repeatedly choosing a less coherent candidate.

## Path B: stateless pool picker

The fallback path removes LLM tool routing. `music/picker.ts` gathers candidates
from code-defined sources including current-track similarity, text and audio
KNN, listener likes, show genres/eras, pinned playlists, mood tags, mood-named
playlists, recent and frequent albums, similar artists and a whole-library
exploration sample. Starred and random sources top up a thin pool.

Controller code then:

- applies show filters and playlist rules;
- removes repeats and limits artist concentration;
- gives a soft compatibility boost for BPM and key;
- gives a freshness boost to unaired/long-unheard tracks;
- applies a decaying penalty to repeatedly offered but unchosen tracks;
- includes randomness as the dominant base score;
- caps the final candidate list at 18.

`pickNextTrack` receives that complete list, the current track, four recent
plays, current time/vibe/mood/weather/festival, the active Show Brief and music
steer, plus the same Flow/Context/Variety/Interest criteria. It then asks the
LLM for one ID.

This path is useful diagnostically:

- discovery quality is almost entirely independent of the LLM;
- final editorial choice is still entirely dependent on the LLM;
- if the call fails or returns an unusable ID, code takes the first candidate,
  whose position came from the controller's randomized compatibility/freshness
  rank.

## Operator-controlled influence

The following table describes actual prompt plumbing, not intended semantics.

| Operator control | Vanilla `djAgentPick` | Vanilla `pickNextTrack` | Stage C `djProducerPick` |
|---|---|---|---|
| Global System Prompt (`djPrompt`) | **No** | **No** | **No** |
| Station House Rules | visible, but scoped to spoken fields | no | no |
| Persona Soul | **yes, soft influence** | no | no |
| Persona tone dials | not used for music selection | no | no |
| Persona script length | only shapes `say`, not the ID | no | no |
| Show Brief/Topic | **yes, soft editorial influence** | **yes** | **yes** |
| Show genre/era/energy/vocal settings | prompt steer; code-enforced when strict | pool shaping + prompt steer | same as agent path |
| Show moods | room context when soft; code lock when strict | pool/context; code lock when strict | operational context; code lock when strict |
| Pinned playlist | preferred or code-locked | dominant or code-locked | preferred or code-locked |
| Excluded playlist | hard code filter | hard code filter | hard code filter |
| Listener likes | current favourites listed in the pick event | candidate source | operational nudge |
| Recent session conversation | bounded window | no | deliberately no |

Two implications deserve emphasis.

First, the custom global System Prompt affects scripted listener-facing calls,
but it is not the picker system prompt. Editing it cannot reliably change track
selection.

Second, the vanilla Persona Soul is placed at the top of the agent picker's
system prompt. A line such as “prefers overlooked album tracks to obvious
singles” can therefore influence tool choice and final ranking in the default
agent path. It does not reach the pool picker, and Stage C deliberately removes
the Soul from the Producer.

That influence is limited by evidence. Current candidates do not carry a
reliable “album cut versus single” or global-popularity field. The wording may
encourage `deepCuts`, but that tool means “unexplored by this station,” not
“non-single album track.” The model can act on a source label or infer from
album/title metadata, but it cannot know the requested property consistently.
Adding grounded taste features would make this steer testable rather than
opaque.

## Producer/Persona Stage C

The fork's `djProducerPick` retains the vanilla discovery tools, scope, strict
locks, shared selection criteria and post-choice safeguards. It changes the
model-facing context:

- no Persona Soul, language, house rules or on-air speech history;
- no listener-facing `say` field;
- a fresh operational message containing current/recent tracks and artists,
  recent transitions, period/vibe/mood/weather/festival and current nudges;
- the active Show Brief and structured music/playlist guidance;
- output limited to `id`, private `reason` and `transition`.

This cleanly prevents Persona prose from steering the backstage model. It also
means musical tastes stated only in the Persona Soul no longer influence the
Producer. If that behaviour is desired, the correct future boundary is a small,
explicit, music-only **selection profile** passed to Producer—not the whole Soul
and not examples of the Persona's prose. The profile should contain grounded
preferences such as “favour unaired tracks,” “prefer album tracks when known,”
or “avoid obvious catalogue staples,” with corresponding metadata/tools to make
each preference observable.

## Does model size affect tool output?

The answer depends on what “tool output” means.

### Raw result from a fixed tool call

Usually **no**. Given the same tool, arguments, library state, recency sets and
random seed/sample, the database/index result does not improve because the
caller has more parameters. Text and CLAP embeddings are separate models; the
main LLM does not calculate nearest neighbours.

### The discovery result set for a complete agent run

**Yes, potentially a great deal.** The LLM chooses:

- which axes to explore;
- whether to call one tool or several in parallel;
- which genre, mood, energy, artist, seed or free-text query to provide;
- whether to obey a journey, playlist, favourite or exploration nudge;
- whether to recover sensibly after a thin/empty result on providers with more
  than one discovery round.

Parameter count is only a proxy. Tool-use fine-tuning, chat-template
compatibility, constrained-output compliance and the model's ability to follow
several simultaneous instructions can matter more than raw size. The Qwen3-8B
versus Hermes-3-8B observations already demonstrate that equal parameter count
does not imply equal agent reliability.

## Does model size affect the final choice?

**Yes in architecture; the magnitude must be measured.** Both picker paths ask
the LLM to perform a multi-objective judgement over incomplete, mixed metadata.
A stronger model may better understand deliberate energy moves, distinguish a
good contrast from a jarring jump, apply soft show prose, and trade freshness
against flow. A small specialist may still do this well if trained on the exact
contract.

The current success metric mostly answers “did a valid structured pick land?”
It does not answer “was this the best of the surfaced candidates?” Consequently
a 270M model could look flawless on the Stats page while flattening a show's
musical identity or making poor transitions.

There is no code evidence for a universal 12B minimum. There is equally no code
basis for assuming a 270M function model can replace the current Producer. The
contract is larger than function calling.

## Evaluation required before adopting a 270M Producer

Reliability and editorial judgement should be tested as separate stages with
replayable fixtures.

### Test 1: protocol and grounding

Give each model identical synthetic tools and operational prompts. Measure:

- completion and deadline success;
- at least one real discovery call;
- valid tool names and arguments;
- exact surfaced-ID compliance;
- recovery after empty results;
- latency, CPU/GPU memory and tokens.

The existing `picker-test.mjs` and `llm-bench` Producer scenarios cover much of
this layer.

### Test 2: discovery routing

Freeze tool outputs and present scenario-specific needs, for example:

- preserve a quiet acoustic flow;
- deliberately lift energy;
- obey a strict pinned playlist;
- follow a sonic journey;
- honour an explicit “explore unheard shelves” instruction.

Score whether the model chose the useful tool axes and arguments. Do not score
only whether a tool was called.

### Test 3: final editorial ranking

Remove routing as a variable: supply every model the same fixed candidate set.
Each fixture should contain deliberate traps and defensible alternatives. Score:

- hard-constraint compliance;
- back-to-back artist avoidance;
- tempo/key/pace continuity or a justified deliberate move;
- vocal/instrumental sequencing;
- freshness and variety;
- response to the Show Brief;
- stability across repeated runs without collapsing to one favourite.

Human pairwise listening judgements are appropriate here. Several tracks can
be defensible; a single “correct ID” is too brittle for programming taste.

### Test 4: soft-influence sensitivity

Replay the same candidate/tool snapshot with one input changed at a time:

- no Show Brief versus “prefer overlooked album tracks”;
- no music selection profile versus the proposed grounded profile;
- Persona Soul present versus absent on the vanilla path;
- 270M, 1.5–2B, 4B and 8B models.

Measure changes in tool choice and selected candidate. This turns an opaque
claim that prose “nudges” the picker into observable evidence.

### Test 5: on-air sequence replay

Finally run each candidate Producer over the same recorded sequence of tracks,
show state and library snapshots. Compare multi-track arcs, not isolated picks:
artist recurrence, energy shape, pool fallback rate, tonal jumps and listener
perception. This is a natural future Rehearsal Room workload.

## Architectural options for a very small model

If a 270M model passes protocol tests but fails editorial ranking, it can still
be useful in a narrower design:

1. **Router only** — 270M selects discovery calls; a 4B Producer chooses among
   the grounded results.
2. **Deterministic discovery** — use the existing pool builder; a capable small
   Producer only ranks its 18 candidates.
3. **Deterministic scorer** — controller code combines explicit compatibility,
   freshness, variety and show-profile features; 270M is used only where a
   natural-language Show Brief must be mapped to structured preferences.
4. **Compiled show intent** — a capable model converts a changed Show Brief to
   a cached selection profile once, not on every track; runtime selection is
   then cheap and grounded.

Option 2 is already close to SUB/WAVE's fallback path. Option 4 most closely
matches AudioMuse-AI's principle of placing intelligence in schemas and
deterministic retrieval rather than asking a small runtime model to repeatedly
re-interpret a large prose prompt.

## Comparison with AudioMuse-AI

Both projects use familiar recommendation building blocks: metadata filters,
embeddings/KNN, recency, library-grounded IDs and an LLM-facing natural-language
layer. That conceptual resemblance does not establish that they derive from a
specific shared paper or codebase.

AudioMuse-AI's Instant Playlist documentation draws a firmer boundary: its LLM
chooses tools/arguments and deterministic code performs the remaining search,
validation, filtering, ranking and interleaving. SUB/WAVE's session agent asks
the LLM to choose the tools **and** the final ID; its pool fallback removes tool
routing but still asks the LLM for the final ID.

That difference explains why AudioMuse can target very small local models more
confidently. A SUB/WAVE function-calling benchmark is necessary but not
sufficient: replacing its Producer also replaces its final music editor.

## Source map

- `controller/src/broadcast/dj-agent.ts` — live orchestration, event context,
  validation, artist guard and fallback.
- `controller/src/broadcast/dj-agent/agents.ts` — agent definitions and split
  Producer prompt assembly.
- `controller/src/broadcast/dj-agent/schemas.ts` — vanilla picker schema and
  system prompt.
- `controller/src/broadcast/session.ts` — bounded session window.
- `controller/src/llm/internal/strategy/agent.ts` — discovery/done loop and
  recovery cascade.
- `controller/src/llm/internal/provider/capabilities.ts` — provider discovery
  budgets and structured-output strategy.
- `controller/src/llm/internal/tools/picker/` — discovery tool registry,
  constraints, result shaping and tools.
- `controller/src/llm/instructions/pick-criteria.md` — shared final-choice
  editorial criteria.
- `controller/src/music/picker.ts` — stateless candidate-pool builder and
  post-LLM validation.
- `controller/src/llm/internal/prompts/picker.ts` — stateless final-choice
  prompt.
- `controller/scripts/picker-test.mjs` and `controller/scripts/llm-bench/` —
  existing reliability harnesses to extend with editorial fixtures.
