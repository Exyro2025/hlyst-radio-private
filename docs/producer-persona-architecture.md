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
- forecast air time only when it is considered safe: optional factual context;
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

The LLM call kind is `generatePersonaLink`, reflecting the role executing the
call. If Producer selection fails, the established all-in-one agent remains the
fallback. If Persona delivery fails, the selected track is retained and the
legacy one-candidate link contract is attempted.

## Boundary rules

Every field crossing from Producer to Persona must answer this question:

> Could knowing this legitimately improve what the presenter needs to say for
> this immediate task?

If not, omit it. In particular, the Persona should not normally receive:

- tool names, schemas, results, errors, retries, or completion protocols;
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
