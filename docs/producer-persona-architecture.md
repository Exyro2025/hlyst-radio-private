# Producer and Persona prompt architecture

This document records the design boundary for SubWave's optional split LLM
architecture. It is intended to make prompt changes reviewable: contributors
should be able to see which role receives a piece of information, why it needs
it, and whether it can influence speech heard on air.

## Roles

The **Producer** makes backstage editorial and operational decisions. It may
search the library, choose tracks and transitions, research facts, and decide
whether a segment is worth airing. Its reasoning is useful for logs and
diagnostics, but is not listener-facing copy.

The **Persona** performs the immediate on-air task. Its style comes from the
selected Persona Soul and the active show brief. It should receive the minimum
facts and intent needed to speak accurately, without tools, discovery history,
candidate scores, picker rationale, or Producer-authored prose.

The governing rule is: **Producer decides; Persona speaks.**

## Experimental stages

The implementation is being kept identifiable in three stages so identical
radio circumstances can eventually be replayed in the Rehearsal Room.

### Stage A: all-in-one

One model performs discovery, editorial reasoning, and speech generation in a
single agent run. Operational and creative context coexist in the prompt.

### Stage B: early split

The Producer and Persona use separate calls, but the Producer returns a prose
`speechBrief`. The Persona is asked to treat that prose as an editorial angle.
This proved routing and fallback behaviour, but it still lets Producer wording
shape the on-air voice and permits a Persona-to-Producer-to-Persona feedback
loop through shared session history.

The repository tag `experiment/producer-persona-stage-b` marks this benchmark.

### Stage C: clean split

The Producer passes only structured facts and intent. The Persona owns all
listener-facing interpretation and wording. The Producer also receives
structured operational history rather than historical Persona prose.

Stage C must preserve operational diagnostics separately from the speech
packet. A Producer `reason` remains available to logs and debugging, but must
not be inserted into the Persona prompt.

## Stage C migration: automatic track links

The first migrated path is the automatic agent pick followed by its optional
track introduction.

### Original all-in-one inputs

The legacy `djAgentPick` receives the shared session conversation, library
tools, show and music constraints, transition guidance, speech instructions,
recent on-air language and opener coaching. It chooses the track and writes
the listener-facing `say` field in the same agent run.

### Stage B split

`djProducerPick` uses a separate routed model but still receives
`session.windowMessages()`. Its output includes `speechBrief`, a short prose
angle passed into `generateProducerLink`. This separates calls but not creative
influence.

### Stage C Producer input and output

`djProducerPick` is given a newly constructed operational request rather than
the session conversation. It may receive:

- current and recent track identity;
- recent artist identity;
- recent transition choices;
- time, weather and programme state used only for music selection;
- active-show music constraints and playlist state;
- effect, run, journey, favourite and exploration instructions;
- library discovery tools.

It returns only `id`, private `reason`, and `transition`. `speechBrief` is
removed. The private reason remains in the session and diagnostics but never
enters the Persona request.

### Stage C Persona packet

`generatePersonaLink` receives:

- artist and title: the factual subject of the immediate introduction;
- active show name and user-authored brief: the programme identity;
- a deterministic fuzzy air-time phrase only when the seam can be forecast
  safely (for example, `approaching 11am`): optional factual context;
- measured intro/vocal runway: a hard broadcast timing constraint;
- the selected Persona: its Soul, user prompt and applicable broadcast rules;
- recent speech and opening words filtered to that Persona: short negative
  memory used only to prevent repetition.

The packet deliberately excludes the Producer reason, `speechBrief`, random
tone angle, listener count, generic date/season/daypart colour, operational
show mood tags, recently played titles, tempo/key patter, transition choice,
tools and sonic-journey state. It is built independently of the legacy
`buildContextLines` and `decoratePrompt` helpers so later additions cannot
quietly widen the boundary.

Queued links never receive an exact minute. They are generated ahead of their
track, and ordinary seam movement can cross a minute boundary while remaining
inside the queue's stale-clock tolerance. Converting the forecast into broad
twenty-minute bands before it reaches the Persona preserves useful situational
language without asking the model to repeat a clock value that may be false by
air time. Immediate clock functions such as the hourly check continue to use
the live exact time; the queue's existing drift guard remains the backstop for
a link that misses its intended seam altogether.

The LLM call kind is `generatePersonaLink`, reflecting the role executing the
call. If Producer selection fails, the established all-in-one agent remains the
fallback. If Persona delivery fails, the selected track is retained and the
legacy one-candidate link contract is attempted.

The admin dashboard's on-demand **Track Link** is also a direct
`generatePersonaLink` call. It needs no Producer because the operator has
already made the editorial decision to speak about the track currently on air.
It receives the same clean facts, fuzzy clock phrase and Persona-specific
negative memory as an automatic link. It deliberately omits measured intro and
first-vocal runway: the button may be pressed halfway through a track, when
timings measured from the beginning no longer describe the available space.

## Stage C migration: autonomous skill segments

The second migrated path is the five-minute autonomous segment director. The
base installation remains on the established all-in-one path; this split is
active only while the optional Producer leg is enabled. The existing **Run
now** action remains on its established on-air path so automatic and manual
behaviour are not changed simultaneously. A separate **Off-air test** action
exercises the split path without replacing that operator override.

### Original all-in-one contract

`djAgentSegment` receives the Persona preamble, station cadence, every offered
skill brief, selected moment context, recent on-air speech, optional SFX and
the research tools. One tool loop decides whether to speak, performs research,
chooses a skill and sound effect, and writes the final listener-facing `text`.
Its output is `{ reason, air, segment: { kind, text, sfx } }`.

### Split Producer contract

`djProducerSegment` receives no Persona Soul and has no listener-facing text
field. It receives operational cadence, the offered skill briefs, relevant
moment context, recently aired skill identifiers, optional SFX and the same
research tools. It returns only `{ air, kind, reason, sfx }`. The selected skill
must have been offered. When that skill owns a data tool, the run must contain
a usable result from that exact tool; errors, explicit `available: false` and
empty payloads resolve to silence. A prompt-only custom skill remains eligible
from its operator-authored brief and declared operational context; it does not
invent a research result merely to satisfy the tool-oriented contract.

The agent runtime already exposes discovery calls separately from its final
object. The controller therefore recovers the selected tool's actual result
without asking the Producer to paraphrase it and without running the external
search a second time. The private `reason` remains diagnostic and never enters
the Persona request. SFX remains a Producer decision because it changes the
production treatment, not the presenter's wording.

### Split Persona packet

`generatePersonaSegment` receives:

- the selected kind and the operator-authored `SKILL.md` brief;
- the selected tool's result, with no tool name, arguments, errors, rejected
  results or discovery transcript; search-backed results are conservatively
  filtered before crossing the boundary;
- the active show name and user-authored brief;
- the on-air track only for track-related skills;
- the minimum selected moment facts: date for curiosity, fuzzy time for
  weather, or explicitly declared fields for a custom skill;
- the chosen Persona and repetition memory filtered to that Persona.

Listener count, dominant mood, unrelated weather, the Producer reason and SFX
choice do not cross the speech boundary. The shared skill brief is deliberate:
today it combines editorial reliability rules with delivery rules. A future
skill format may split those into Producer and Persona sections; copying or
guessing such a split during this migration would change operator-authored
behaviour silently.

The two search-backed skills have additional deterministic grounding rules.
Both require a non-empty provider answer plus at least one subject-matching
source; search snippets alone are not evidence of a relationship between
adjacent facts and cannot authorise speech. For `now-playing-dig`, both answer
and source must name the exact artist and track. `web-search` requires the
artist in both and does not receive the on-air track in its Persona packet: a
general biographical fact must not be joined to the current song merely because
it aired during the search. If filtering leaves no evidence, the segment
resolves to silence. This is a conservative floor, not semantic claim
verification: a future evidence-appraisal stage may reject an explicit answer
whose cited source does not actually support it.

The Persona owns wording only. It cannot change kind, search again or reverse
the air decision. A failed Producer call, missing evidence, or failed/empty
Persona response results in silence. Optional talk has no legacy all-in-one
fallback because preserving airtime is less important than avoiding an
ungrounded on-air statement. The observable call kinds are
`djProducerSegment` and `generatePersonaSegment`.

### Off-air skill rehearsal

The Skills page's **Off-air test** action is the first deliberately small seam
for a future Rehearsal Room. It offers only the selected skill to the same
`djProducerSegment` contract used by the autonomous scheduler. The Producer
may decline, or it may research and approve the skill; the controller applies
the same selected-tool and evidence-grounding rules before
`generatePersonaSegment` creates a draft.

The test is observational. It never calls TTS, plays SFX, appends Persona
speech to the live session, advances skill cooldowns, burns headline or artist
dedup state, consumes the durable curiosity ledger, or writes an on-air event.
The normal LLM debug records retain the Producer response, tool evidence and
Persona draft. The UI reports the terminal stage and reason in a short toast.
Tests require the optional Producer leg to be enabled; the established **Run
now** action remains available regardless.

## Deliberate exception: library mood tagging

Library mood tagging looks like a Producer task because it classifies tracks
rather than writing speech. A live CPU trial established that this is the wrong
routing criterion: tagging is a bulk-throughput workload, while the Producer
leg is sized for short, latency-tolerant editorial decisions. Qwen3-4B on CPU
was structurally capable but projected roughly thirteen minutes for only 132
pending tracks at a batch size of ten. That cost would make an initial library
scan needlessly slow.

The same trial exposed a harder scheduling failure. The local Producer server
ran with `--parallel 1`, so a long `tag-library-batch` occupied its only
inference slot. Live `djProducerPick` requests queued behind the background
batch and timed out. This is priority inversion: a non-urgent maintenance job
can make the time-sensitive broadcast controller miss its deadline even though
both tasks work correctly in isolation. Raw tagging accuracy cannot make that
topology safe.

Both bulk Library Scan batches and the Library page's single-track **Retag**
therefore remain on the established primary Persona route, including when the
optional Producer leg is enabled. A configured fallback may continue operating
as the existing second parallel tagging worker. This is not a Producer-to-
Persona speech-boundary leak: the tagging prompt contains only title, artist,
album, year, genre and the mood vocabulary, and its structured mood/energy
result is never listener-facing prose.

The trade-off is explicit: a future roleplay-focused Persona model must retain
basic structured classification ability. The evaluation harness should test
`tag-library-batch` before such a model is adopted. If a future installation
needs an independent high-throughput classifier, that should be a dedicated
library-routing setting or process rather than overloading the live Producer
role. Raising llama.cpp parallelism is not the default remedy: it increases
shared CPU and memory pressure and still gives bulk work no priority boundary
over an urgent live pick.

## Boundary rules

Every field crossing from Producer to Persona must answer this question:

> Could knowing this legitimately improve what the presenter needs to say for
> this immediate task?

If not, omit it. In particular, the Persona should not normally receive:

- tool names, schemas, arguments, errors, retries, completion protocols, or
  unselected results (the selected skill's controller-grounded evidence is the
  explicit segment exception);
- candidate IDs, rejected candidates, scores, or selection weighting;
- picker rationale or internal editorial deliberation;
- sonic-journey, energy-target, mood-tag, or transition-planning terminology;
- Producer-authored metaphors, suggested sentences, or other creative prose;
- speech or openers generated by a different presenter.

Likewise, the Producer should not normally receive historical Persona prose,
metaphors, anecdotes, or rhetorical openings. Where it needs continuity, use
derived operational state such as recent track and artist IDs, last-spoken
times, aired skill identifiers, or recent topic identifiers.

## Persona prompt layers

Persona requests should remain small and legible, in this order:

1. Universal broadcast contract and output shape.
2. User-authored Persona Soul.
3. User-authored active show brief, when relevant.
4. The immediate speech task.
5. A structured Producer packet containing facts and intent only.
6. Short, presenter-specific negative memory used only to avoid repetition.

Recent speech and opener memory must be keyed by Persona identity. It is
negative context, not a creative example: do not reuse its wording, anecdotes,
metaphors, or sentence structures.

## Naming

LLM call kinds and public function names describe the role executing the call,
not the role that supplied its input. For example, the function that turns a
Producer decision into on-air speech is `generatePersonaLink`, while the
backstage picker is `djProducerPick`.

## Change record requirements

For each migrated call path, document:

- the original all-in-one inputs;
- the Producer-only inputs and structured output;
- the exact fields crossing into Persona, with a reason for each;
- fields deliberately removed and why;
- fallback behaviour and observable call-kind names;
- focused tests proving the boundary does not leak operational or creative
  Producer material.

Do not add creative guardrails merely to compensate for irrelevant context.
First remove the context. Preserve a plain baseline so later Persona-model and
prompt experiments measure the model and user-authored Soul rather than hidden
house style.
