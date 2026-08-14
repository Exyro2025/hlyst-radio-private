# Built-in skills v2: design notes

This document records the intended direction for opt-in successors to Subwave's
seven established built-in skills. It is a design reference, not a promise that
all seven must ship together.

## Shared rules

- Keep every established built-in unchanged. Each successor ships under its own
  `*-v2` name, disabled by default while it is evaluated.
- A shipped v2 skill must work without asking the operator for another account,
  API key or environment secret.
- Factual speech must cross the tool boundary as explicit, source-bound claims.
  Empty, ambiguous or failed research results produce silence rather than model
  improvisation.
- A completed research attempt consumes the skill's cooldown even when nothing
  airs. Infrastructure failures may retry sooner.
- Source retrieval, matching and rejection belong in shared services and pure
  helpers. `SKILL.md` owns presentation; it must not compensate for uncertain
  data with extra prompt rules.
- The Rehearsal Room should eventually be able to replay the tool result and
  Persona delivery separately, including the reason an item was rejected.

## Proposed skills

### Album anniversary v2

**Problem:** the established tool uses the current track's plain `year`. That
may be a reissue year, and the tool does not exclude compilations, singles, EPs
or other non-album releases.

**Implemented data boundary:** resolve the on-air track's `albumId` through OpenSubsonic and
read `originalReleaseDate`, `releaseTypes` and `isCompilation` from the album.
These are already keyless fields on the station's configured music server.

**Implemented acceptance:** require an original release year, `isCompilation !== true`, and
a release type that identifies an album while rejecting compilation, single,
EP, remix, mixtape and DJ-mix types. If the server does not provide enough
metadata to establish those facts, stay silent. Calculate the anniversary from
the station-local calendar year and retain the existing five-year interval.

**Speech:** one sourced anniversary observation. Do not infer chart performance,
importance or contemporary reception.

Album anniversary v2 now ships disabled beside the established skill. It uses
the station-local year from the segment context, requires a five-year interval
of at least five years, and emits one provenance-bound claim. Missing release
types or original-release metadata stay silent rather than falling back to the
track's year.

### Curiosity v2

**Problem:** the Wikimedia on-this-day lookup is already useful and filtered,
but the established brief permits unsourced fallback generation when the lookup
is empty.

**Data boundary:** retain the keyless Wikimedia on-this-day feed, its cultural,
scientific and sporting filters, and the durable dedup ledger.

**Acceptance:** only an explicit returned event may air. An empty feed or an
exhausted daily pool stays silent. Remove the LLM-generated factoid fallback.

**Speech:** preserve the current light, oddly specific delivery. This is a
safety revision rather than a creative redesign and is therefore low priority.

### Library deep-cut v2

**Problem:** the established tool scans only the first eight albums returned for
the artist, takes the first cold tracks it encounters and reports that bounded
sample as a count. The result is biased by server ordering and can feel like a
tease with no editorial purpose.

**Data boundary:** query Subwave's complete indexed library and play history for
the exact on-air artist. Select one track that has never aired or has genuinely
fallen out of rotation; exclude the current track and preferably the current
album. Return its exact title, album and last-air status.

**Acceptance:** only run when one unambiguous candidate exists. Never promise it
will play unless a future feature actually puts it into the queue.

**Speech:** frame it as something still worth rediscovering in the station's
own shelves. This remains the lowest-priority v2 candidate until it has a clearer
on-air purpose; a future Rehearsal Room or operator action could make it more
useful than an autonomous tease.

### News v2

**Problem:** the established skill reads one operator-configured general feed.
It cannot provide a default music-news beat or provenance-bearing headlines
shared with artist research.

**Implemented data boundary:** use a cached, keyless RSS service. Keep BBC as the general
news source and add a small fixed set of public music feeds. Preserve headline,
publication, article URL and publication time; descriptions are discovery aids,
not factual material for the speaking model.

**Implemented acceptance:** alternate between a suitable general headline and a music
headline when both pools have fresh items. If the preferred pool has nothing
safe, use the other rather than forcing an item. Deduplicate across feeds and
across previous airtime. Continue when an individual feed is unavailable.

Music headlines also pass an editorial relevance gate. When the active show has
configured genres, the headline must explicitly name an artist that can be
matched to the local library, and that artist's library genres must overlap the
show genres using Subwave's existing genre matcher. Apply this regardless of the
show's `filtersStrict` setting: the gate protects spoken editorial relevance,
not track selection. If a show has no configured genres, use the current track's
library genres as a soft relevance fallback; a genuinely broad unfiltered show
may use the full music-news pool. An unidentified or untagged headline is not
evidence of relevance and should be rejected. If no music item passes, use a
suitable general headline or stay silent.

**Speech:** conversational rather than a bulletin. Retain the established
avoidance of death, disaster and other stories unsuited to a breezy aside.

News v2 now ships disabled beside the established News skill. The relevance
gate builds a compact artist/genre index from the station's tagged library and
does not consult `filtersStrict`: editorial suitability is separate from track
selection. A show with configured genres uses those genres; a defined show
without them falls back to the current track's library genres; autonomous mode
may use any unambiguous local artist. Headline descriptions never become claims.
The selected item is recorded in the durable recall ledger at research time,
matching the v2 rule that a completed attempt consumes its opportunity even if
the Persona ultimately stays silent.

### Now-playing dig v2

**Problem:** general search snippets encouraged plausible but unsupported track
stories. Rejected attempts also retried every scheduler tick because cooldown
began only when speech aired.

**Current direction:** exact artist/title matching against MusicBrainz, with
source-bound first-release, producer, mixer and remixer claims. A completed
lookup consumes cooldown; missing evidence stays silent. The Persona may add a
brief subjective reaction, but no second factual assertion.

**RSS extension:** accept a music-feed headline only when the headline itself
explicitly names both the current artist and exact track title. An artist-only
match is current artist news and belongs to Web search v2.

**Later candidates:** writers and sample relationships require following
additional MusicBrainz entities and must receive separate exact-match tests
before becoming claims. B-sides need release/medium semantics and must not be
inferred from neighbouring track order.

### Weather v2

**Problem:** the established tool sees current conditions only and its brief
explicitly forbids forecasting. It cannot warn listeners about a meaningful
change later in the day.

**Implemented data boundary:** the existing keyless Open-Meteo request now
includes a 12-hour hourly outlook in the same cached response. Deterministic
controller code reduces that table to one evidence-backed change; neither the
Producer nor Persona receives the forecast array.

**Acceptance:** surface either a genuine change since the last weather mention
or the next significant change within a limited horizon. Significant changes
include rain or snow beginning/ending, a major condition transition, or a useful
temperature movement. Ordinary persistence (for example, remaining cloudy)
stays silent. Cache with the existing weather response and use station-local
times.

**Speech:** one or two in-character sentences. Use broad timing such as "later
this afternoon" unless the forecast supports a useful, stable time window.

Weather v2 ships disabled beside the established current-conditions skill. It
recognises precipitation and fog beginning or ending, a changed current
condition, or temperature movement of at least 4 degrees Celsius / 7 degrees
Fahrenheit. It handles the midnight boundary explicitly (for example,
"tomorrow morning") and ordinary persistence produces unavailable evidence.

### Web search v2

**Problem:** the established tool passes general answer and snippet text to the
model, allowing neighbouring search results to become invented artist facts. It
also requires a usable search provider even when a public music feed could have
answered the artist-news use case.

**Implemented data boundary:** check the shared music RSS cache first. A headline qualifies
only when it explicitly names the current artist. Preserve its source and date
as evidence and never promote the article description into a claim.

**Fallback:** when RSS has no match and the operator already has a usable search
provider, issue the existing trusted-domain query and apply the same headline
and artist-name checks. RSS remains fully functional without SearXNG or a paid
search API.

The shared reader currently uses Stereogum, Pitchfork News and The Guardian
Music. It refreshes the feeds concurrently, caches each publisher separately,
deduplicates matching headlines and retains a short stale copy across temporary
publisher failures. A failed feed receives its own retry delay so it cannot be
hammered by each scheduler pass. The same reader is the data foundation for
News v2, whose show-relevance gate is applied separately when selecting a music
headline.

**Speech:** one current artist update based only on the selected headline. Do
not infer tour locations, collaborations, quotations or release details absent
from that headline.

## Suggested implementation order

1. Finish and live-test Now-playing dig v2.
2. Build the shared music RSS cache and use it for News v2 and Web search v2.
3. Correct Album anniversary v2 using OpenSubsonic album metadata.
4. Add Weather v2's bounded look-ahead. **Implemented; live trial pending.**
5. Make Curiosity v2 evidence-only.
6. Revisit Library deep-cut v2 only after defining a stronger on-air purpose.

## Skill speech safety

Listener-facing skill speech inherits the selected speaker's Persona settings.
Name, Soul, language, Humour, Local Colour, Warmth and supported TTS expression
cues are applied to the skill prompt. Script length is both a creative direction
and a controller-enforced ceiling: each rung has finite sentence, word,
character and generation-token bounds. A skill may request something shorter,
but no skill can expand beyond the Persona's safety envelope.

Before a skill reaches TTS, the controller keeps complete sentences where
possible. If one pathological sentence alone exceeds the limit, it is shortened
at a word boundary and marked with an ellipsis. The booth log records whenever
this safety guard changes model output.

Future work: allow a skill to declare an explicit cast and roles across several
Personas. Today's automatic guest rotation only chooses one speaker after the
skill is selected; it is not a multi-persona skill contract and the manual Run
Now control cannot select a guest.
