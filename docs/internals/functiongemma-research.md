# FunctionGemma Producer research

This document defines the experimental boundary for testing a small,
CPU-resident FunctionGemma model as part of SUB/WAVE's optional
Producer/Persona architecture. It is research scaffolding, not a commitment to
ship FunctionGemma or to replace the current Producer model.

Read [`track-selection.md`](track-selection.md) first. The important finding is
that the current picker model does two different jobs:

1. it routes discovery by choosing tools and arguments;
2. it makes the final editorial choice from the surfaced candidates.

A function-calling score can establish competence at the first job. It says
nothing by itself about the second.

## Target deployment

The long-term product hypothesis is deliberately simple for operators:

- the ordinary installation continues to use one configured LLM for all work;
- an advanced split mode may load one bundled, standard Producer model on CPU;
- the operator chooses only the Persona model and its local/cloud provider;
- the Producer supplies grounded operational decisions, never on-air prose;
- the Persona supplies expression, never tool calls or invented database facts.

The bundled-model idea is only viable if the CPU Producer is reliable enough
that it cannot create more on-air mistakes or timing failures than the existing
single-model path.

## Research stages

### Stage 1: discovery router

The smallest defensible role for FunctionGemma is selecting a library tool and
its arguments from grounded operational context. Test:

- correct function name;
- valid required arguments and enums;
- respect for a pinned show playlist and active sonic journey;
- use of structured mood/energy/genre tools rather than vague search;
- a real state transition after an empty result.

This stage does not choose the final song.

### Stage 2: candidate committer

The current architecture also asks the Producer to call `done` with one exact
surfaced ID. Test this separately so protocol success cannot conceal weak radio
programming. Fixtures should include:

- a same-artist trap;
- a quiet-song to high-energy-song discontinuity;
- a deliberate energy lift where the louder candidate is correct;
- soft Show Brief influence such as preferring overlooked album tracks;
- several defensible choices rather than one brittle golden ID.

If FunctionGemma routes well but commits poorly, keep it as a router and hand
the fixed candidate set to deterministic scoring or a more capable editorial
model. Do not average the two scores into one reassuring percentage.

### Stage 3: live-shaped replay

Only after the first two stages pass should the model see captured, anonymised
live-shaped scenarios. Replay the same station state to each candidate model
and compare multi-track arcs, fallback rates, latency and human listening
judgements. This belongs naturally in the future Rehearsal Room.

## Held-out validation fixtures

The initial fixtures live under `controller/scripts/functiongemma/`. They are
small, synthetic and intentionally readable. Every fixture is marked
`split: validation` and must never be exported into a fine-tuning dataset.

The scorer reports five independent dimensions:

| Dimension | Question |
| --- | --- |
| Protocol | Did the model call an offered function with structurally valid arguments? |
| Routing | Did it choose the appropriate discovery axis and values? |
| Recovery | After an empty result, did it change strategy rather than repeat the failed call? |
| Grounding | Is the committed ID one that a tool actually surfaced? |
| Editorial | Is that grounded choice musically defensible for the supplied situation? |

For example, choosing a same-artist candidate from a returned list passes
Protocol and Grounding but fails Editorial. That distinction is load-bearing.

### Running against a model endpoint

The runner talks directly to a separate OpenAI-compatible endpoint and never
loads or mutates the live station's settings:

```bash
cd controller
npm run functiongemma:eval -- \
  --base-url http://HOST:PORT/v1 \
  --model FUNCTIONGEMMA_MODEL_NAME \
  --iterations 5 \
  --out reports/functiongemma.json
```

Use `--api-key` when required, or set `FUNCTIONGEMMA_API_KEY`. The default
per-call deadline is 30 seconds; override it with `--timeout-ms`.
Use `--scenarios route.pinned-playlist,commit.quiet-flow` to rerun a focused
subset while diagnosing a failure.

An existing capture can be scored without contacting a model:

```bash
npm run functiongemma:eval -- --predictions results.jsonl
```

Each JSONL row has this shape:

```json
{"scenario":"route.pinned-playlist","calls":[{"name":"showPlaylistTracks","arguments":{}}],"latencyMs":120}
```

## Fine-tuning data contract

Training examples should remain provider-neutral structured conversations:

- offered function definitions;
- operational user context;
- the assistant's expected function call;
- mocked function results for multi-turn recovery examples;
- a later `done` call only when the example trains candidate commitment.

Apply Google's official FunctionGemma tokenizer/chat template during dataset
preparation. Do not hand-write FunctionGemma control tokens into the canonical
JSONL; doing so couples the data to one tokenizer revision and makes the source
hard to inspect.

The model's function-calling activation instruction belongs in the
`developer` role, not an ordinary `system` message. Keep that role intact in
both training examples and endpoint evaluation. See the
[official FunctionGemma model card](https://huggingface.co/google/functiongemma-270m-it#basic-usage).

Keep three non-overlapping groups:

- **train** — generated variations reviewed against deterministic policies;
- **development** — used while choosing epochs and tuning parameters;
- **validation** — frozen scenarios used only for final comparison.

Split by scenario family and musical entities, not random rows. Renaming the
same track in a validation copy is not a genuinely unseen example.

Training targets must come from an explicit policy or human judgement. Never
use the current model's output as an unquestioned label: that would teach its
existing mistakes to the smaller model and then score imitation as success.

## Provisional promotion gates

These are starting safety thresholds, to be revised from measured baselines:

- Protocol: at least 99.5%, with no unoffered functions;
- Grounding: 100%; an invented ID is a hard failure;
- Routing: at least 95% on held-out scenarios;
- Recovery: at least 90%, with no repeated-call spiral;
- Editorial: non-inferior to the current Qwen3-4B Producer in blinded human
  comparisons and no increase in hard discontinuities;
- CPU latency: comfortably inside the queue runway at p95 while the station is
  concurrently generating Persona/TTS work;
- stability: no material drop across a long replay rather than one short run.

Passing these gates would justify a guarded integration experiment. It would
not yet justify making the model a bundled default.

## What this first harness does not claim

- The fixtures are not yet large enough to rank models conclusively.
- Tool descriptions are a focused subset of the live picker surface.
- The runner measures model behaviour, not CPU/RAM telemetry.
- No training examples or fine-tuning script have been generated yet.
- No live Producer routing has been changed.

The next research increment is to establish baselines for Qwen3-4B,
Qwen3-1.7B and untuned FunctionGemma on these frozen fixtures, then design
training families around the failures rather than guessing what to teach.

## Recorded baselines

### Qwen3-4B Q4_K_M — 2026-08-16

Five iterations of all nine validation scenarios against the separate
llama.cpp OpenAI-compatible endpoint:

| Result | Score |
| --- | ---: |
| Complete scenarios | 45/45 |
| Protocol | 45/45 |
| Routing | 30/30 |
| Empty-result recovery | 5/5 |
| Grounded commitment | 20/20 |
| Editorial commitment | 20/20 |

Latency across all 45 calls was 3.53s average, 2.29s p50 and 10.19s p95.
The p95 is intentionally dominated by the three-call recovery fixture:

| Stage | Runs | Average | p50 | p95 |
| --- | ---: | ---: | ---: | ---: |
| Route | 25 | 2.02s | 1.89s | 2.31s |
| Recover | 5 | 10.28s | 10.19s | 10.66s |
| Commit | 15 | 3.81s | 3.81s | 4.09s |

An earlier shorthand form wrote candidates as `fresh-01 Southbank`; Qwen
correctly chose the fresh artist but treated the whole phrase as the ID. That
was a fixture defect, because real SUB/WAVE tool results carry separate JSON
fields. All commitment fixtures were corrected to structured candidate
objects before this canonical baseline was recorded.

### FunctionGemma 270M IT Q8_0 — 2026-08-16

Five iterations of the same nine frozen scenarios were run against
`google_functiongemma-270m-it-Q8_0.gguf` on a separate llama.cpp endpoint:

| Result | Score |
| --- | ---: |
| Complete scenarios | 5/45 |
| Protocol | 25/45 |
| Routing | 5/30 |
| Empty-result recovery | 0/5 |
| Grounded commitment | 15/20 |
| Editorial commitment | 5/20 |

The failures were deterministic across all five passes. The model routed only
the active sonic-journey case correctly. It asked for clarification instead of
calling the pinned-playlist tool, chose generic or semantically adjacent tools
for genre, energy and deep-cut requests, and did not progress through the
empty-result recovery sequence. Its final choices selected the same-artist trap
and the obvious single despite contrary editorial context. Every `done` call
also emitted the string `"NULL"` instead of JSON `null`, which is invalid under
the production transition contract.

Latency was excellent but does not offset those failures: 435ms average, 385ms
p50 and 1.64s p95 overall. The three-stage recovery case accounted for the
long tail:

| Stage | Runs | Average | p50 | p95 |
| --- | ---: | ---: | ---: | ---: |
| Route | 25 | 203ms | 154ms | 430ms |
| Recover | 5 | 1.63s | 1.64s | 1.66s |
| Commit | 15 | 422ms | 409ms | 616ms |

#### llama.cpp compatibility boundary

The GGUF carried Google's official FunctionGemma chat template, but this
llama.cpp server reported its chat format as `Content-only`. Calls therefore
arrived in `message.content` as FunctionGemma's native
`<start_function_call>...<end_function_call>` envelope rather than as OpenAI
`tool_calls`. Stock SUB/WAVE cannot consume that response shape through its
existing AI SDK path.

For research only, the harness stops generation after the first native call
and applies a deliberately narrow parser for FunctionGemma's flat call
envelope. This adapter removes transport-format failure from the model-quality
score; it is not a production integration. Shipping FunctionGemma would require
either native FunctionGemma parsing in the serving layer or a maintained
SUB/WAVE provider adapter.

This baseline does not reject the fine-tuning hypothesis. It confirms the
model card's warning that FunctionGemma is a foundation for task-specific
function-calling fine-tunes, not a drop-in general Producer. The next useful
experiment is a small, policy-derived routing dataset followed by evaluation
against these unchanged validation fixtures. Candidate commitment should stay
outside the first fine-tune until routing and recovery meet their gates.

## First routing fine-tune

The first training package lives under
`controller/scripts/functiongemma/training/`. It performs full supervised
fine-tuning from Google's original BF16 weights. The Q8 GGUF is an inference
artifact and cannot be used as the training source.

The generated `subwave.functiongemma-routing.v1` dataset contains 2,400
training conversations and 400 development conversations by default. It is
72% single-turn routing and 28% multi-turn empty-result recovery. The generator
covers 19 families across the following discovery tools:

- pinned show playlist and sonic journey;
- structured genre, mood and energy;
- deep cuts, starred music and recent additions;
- semantic and music-server similarity;
- named library search and unconstrained fallback;
- recovery from empty semantic, server and playlist results through a
  genuinely different axis.

Every example contains realistic but synthetic track metadata. Training and
development use separate musical entities and seed identifiers. Generation
fails if the two sets share a conversation or if any distinctive identifier,
entity or full prompt from the frozen validation fixtures leaks into them.

Candidate commitment and the `done` function are deliberately absent. This
run asks only whether a 270M model can become a reliable discovery router.

### Ubuntu training run

Use a separate checkout so training work cannot disturb the live deployment:

```bash
cd /home/jaz666
git clone --branch codex/functiongemma-research \
  https://github.com/Jaz666/subwave.git subwave-functiongemma
cd /home/jaz666/subwave-functiongemma/controller
npm ci
npm run functiongemma:data
```

Before downloading the original weights, accept the Gemma licence on the
[official FunctionGemma model page](https://huggingface.co/google/functiongemma-270m-it).
Create a Hugging Face read token, then prepare an isolated Python environment:

```bash
sudo apt-get install -y python3-venv
python3 -m venv .functiongemma-venv
source .functiongemma-venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r scripts/functiongemma/training/requirements.txt
huggingface-cli login
```

Stop other GPU model and TTS containers before the training run. The script
refuses to train on CPU, validates both datasets again, checks every rendered
conversation against the token limit, saves a checkpoint after each epoch and
keeps the best development-loss checkpoint:

```bash
python scripts/functiongemma/training/train.py \
  --train scripts/functiongemma/training/data/train.jsonl \
  --development scripts/functiongemma/training/data/development.jsonl \
  --output scripts/functiongemma/training/output/router-v1 \
  --epochs 8 \
  --batch-size 4 \
  --gradient-accumulation 2 \
  --max-length 1024 \
  --learning-rate 5e-5
```

These parameters follow Google's published FunctionGemma SFT recipe, with a
larger safe sequence ceiling for multi-turn tool responses and an effective
batch size of eight. TRL 1.10 expresses the recipe's 5% warmup as an equivalent
automatically calculated number of optimiser steps. Early stopping defaults to
two unimproved evaluations.
The final selected weights are written to `output/router-v1/best`; checkpoints,
TensorBoard logs and a reproducibility manifest remain alongside them.

The trainer renders each assistant decision through FunctionGemma's own chat
template before constructing a homogeneous prompt/completion Arrow dataset.
Each tool call is a separate completion-only target. In recovery examples the
second target can see the first call and its empty result, but loss is never
applied across both calls as one continuous answer. This preserves native
function calls and structured tool responses, avoids Arrow's mixed-content
limitation, and teaches the required stop between decision points.
`rendered-sample.txt` records the first exact prompt plus completion for
inspection.

Monitor the run from a second terminal with `nvidia-smi`. To continue an
interrupted run, repeat the command with `--resume latest`. Do not evaluate or
convert merely the last epoch: the `best` directory contains the checkpoint
selected by development loss.

After training, first evaluate the unquantised `best` checkpoint through a
Transformers-native path. Only a passing checkpoint should be converted to
GGUF and Q8, served through llama.cpp and run against the same frozen harness.
This separates training quality from conversion, quantisation and serving
compatibility failures.

Regenerate the data bundle after pulling the evaluator so `validation.json`
contains the frozen scenarios and their FunctionGemma tool schemas, then run
five deterministic passes through the selected unquantised checkpoint:

```bash
npm run functiongemma:data
python scripts/functiongemma/training/evaluate.py \
  --model scripts/functiongemma/training/output/router-v1/best \
  --scenarios scripts/functiongemma/training/data/validation.json \
  --output scripts/functiongemma/training/output/router-v1/native-predictions.jsonl \
  --iterations 5
npm run functiongemma:eval -- \
  --predictions scripts/functiongemma/training/output/router-v1/native-predictions.jsonl \
  --out scripts/functiongemma/training/output/router-v1/native-report.json
```

The commit scenarios remain in the report as a deliberate control. This first
tuning dataset teaches discovery routing and recovery only, so the decision to
delegate or separately train final candidate commitment remains evidence-led.

### Text-only GGUF conversion

FunctionGemma's Transformers tokenizer exposes the multimodal-only
`<image_soft_token>` and `<end_of_image>` at IDs 262144 and 262145, while the
270M text model has exactly 262144 embedding rows. Transformers text inference
does not touch them, but llama.cpp refuses to convert a tokenizer whose highest
ID is outside the model vocabulary. Prepare a separate conversion source that
removes only those unusable visual markers and verifies that the function-call
tokens remain at IDs 46–52:

```bash
python scripts/functiongemma/training/prepare_gguf.py \
  --source scripts/functiongemma/training/output/router-v1/best \
  --output scripts/functiongemma/training/output/router-v1/gguf-source
```

Never edit `best` in place. Convert the checked staging directory directly to
Q8_0 with llama.cpp's full image:

```bash
sudo docker run --rm \
  -v "$PWD/scripts/functiongemma/training/output/router-v1/gguf-source:/input:ro" \
  -v /home/jaz666/Docker/llama_cpp/models:/output \
  ghcr.io/ggml-org/llama.cpp:full \
  --convert /input \
  --outfile /output/Subwave-FunctionGemma-270M-Router-v1-Q8_0.gguf \
  --outtype q8_0
```

### Router-v1 result — 2026-08-16

The eight-epoch command stopped early after the development loss failed to
improve for two evaluations. Checkpoint 300 (the first epoch) was selected:

| Measurement | Result |
| --- | ---: |
| Best development loss | 0.245663 |
| Final reported training loss | 0.088132 |
| Runtime | 1,123s |
| Selected weights | 544 MiB |

Five deterministic passes through the frozen native evaluator produced the
same result on every pass:

| Dimension | Result |
| --- | ---: |
| Protocol | 30/45 |
| Routing | 30/30 |
| Empty-result recovery | 5/5 |
| Grounded commitment | 0/20 |
| Editorial commitment | 0/20 |

The apparent commitment failure is expected: router-v1 was deliberately never
trained to call `done`. It proves the bounded role it was trained for and does
not support delegating the final music decision to this checkpoint.

The text-only Q8_0 GGUF preserved those scores under CPU-only llama.cpp. Across
the 30 trained-scope route/recovery runs it averaged 315ms, with 209ms p50,
1.009s p95 and 1.019s maximum latency. The untuned Q8 baseline scored only
5/30 routing and 0/5 recovery on the same scope. This is strong evidence that
the improvement came from task-specific tuning rather than the harness.

### Router-v2 target: picker recovery and segment research

The first live hybrid run exposed a recovery case missing from router-v1's
training set. During a restrictive energetic/electronic show, an empty
`tracksTowardJourney` result was sometimes followed by the same journey tool
again. The complete Producer fallback often made the same retry and then fell
through to the stateless pool picker. The controller now removes any empty
discovery tool from the recovery request, so state progression is guaranteed
by code rather than entrusted to model memory. Journey-to-mood and
journey-to-genre examples remain in router-v2's dataset so the model also
learns the preferred recovery.

The next bounded workload is choosing one research tool for an autonomous
between-track segment. FunctionGemma will not decide whether the result is
worth airing and will never write listener-facing text. Those decisions remain
with the configured Producer and Persona models respectively. Manual Run Now
and Off Air Test calls already identify one specific skill; they do not need a
router merely to rediscover that choice.

The initial held-out segment fixtures covered changed weather, exact-track
research, recent artist news and album anniversaries. Router-v1's Q8 CPU
checkpoint scored 0/4 on these unseen tool names (two invalid `searchLibrary`
calls and two missing calls), while still passing the new empty-journey
recovery case. Warm latency was 323-723ms. This was the expected pre-training
result and proved that the picker checkpoint must not be silently enabled for
segment work. Changed weather later moved out of model scope because the
controller already owns that authoritative state transition.

Generate router-v2's mixed picker/segment dataset and train it into a separate
output directory, preserving router-v1 as the live benchmark:

```bash
npm run functiongemma:data
python scripts/functiongemma/training/train.py \
  --train scripts/functiongemma/training/data/train.jsonl \
  --development scripts/functiongemma/training/data/development.jsonl \
  --output scripts/functiongemma/training/output/router-v2 \
  --epochs 8 \
  --batch-size 4 \
  --gradient-accumulation 2 \
  --max-length 1024 \
  --learning-rate 5e-5
```

Router-v2 must retain the picker routing and empty-result recovery scores while
passing the new segment-routing fixtures before any live segment opt-in is
added. Final track selection, segment approval, production SFX choice and all
spoken copy remain deliberately outside the 270M model's scope.

#### Router-v2 checkpoint selection — 2026-08-17

Development loss again selected checkpoint 300, but the held-out operational
routes improved at every saved checkpoint:

| Checkpoint | Routing | Recovery | Regressions / misses |
| --- | ---: | ---: | --- |
| 300 | 8/11 | 2/2 | lower energy, overlooked shelves, changed weather |
| 600 | 9/11 | 2/2 | changed weather, album anniversary |
| 900 | 10/11 | 2/2 | changed weather |

Checkpoint 900 is therefore the router-v2 candidate even though checkpoint 300
has the lowest aggregate development loss. This is a multi-objective routing
task: aggregate token loss is useful for early warning, but it is not a proxy
for whether every operational boundary remains intact. Frozen route/recovery
scores decide which checkpoint advances.

The remaining weather miss is better handled as controller policy. SUB/WAVE
already knows when current conditions differ from the last weather segment; a
changed condition is a deterministic freshness signal, not an editorial tool
choice. The controller should directly research weather when that signal is
present and omit stale weather from the router's alternatives. FunctionGemma
then handles only genuine choices among the remaining research tools.

FunctionGemma emitted Python-style `None` for the nullable artist-news query.
The native, evaluator and live-controller parsers now normalise `None`/`True`/
`False` alongside JSON `null`/`true`/`false` before validating tool arguments.

The text-only Q8_0 conversion of checkpoint 900 preserved every in-scope result
across five deterministic passes: protocol 50/50, routing 50/50 and recovery
10/10. Across those 50 calls it averaged 336ms (207ms p50, 981ms p95, 1.098s
maximum); the slower tail consists of the intentional two-call recovery cases.

#### Router-v2 live rejection and router-v3 correction — 2026-08-17

Router-v2 passed the small frozen harness but failed its first live deployment.
Several semantic routes copied synthetic training literals such as
`seed-train-b-1379` instead of the current Navidrome track id. Some responses
also emitted an initial similarity call and a recovery call in the same model
turn, before any tool result existed. Finally, `tracksByMood` was trained with
`energy` as optional, while the live controller schema requires the key to be
present with either `low`, `medium`, `high`, or JSON `null`.

These were dataset and evaluation defects, not acceptable model variance:

- five repeated seed prefixes made memorisation easier than copying live ids;
- full-conversation loss rewarded both calls in a recovery transcript without
  isolating the turn boundary;
- the training contract was looser than the production Zod schema;
- the native parser could hide a leaked first call and score only a later one.

Router-v3 therefore changes the experiment before any further live test:

1. Every generated conversation uses a unique, production-shaped 22-character
   current-track id, with disjoint deterministic train and development sets.
2. Prompts carry a production-shaped JSON packet containing `currentTrack` and
   representative show context rather than a short synthetic metadata suffix.
3. Similarity targets are validated to copy the id from that packet exactly.
4. `tracksByMood` always sends `energy`; it is explicitly `null` when no energy
   restriction was requested.
5. Training uses completion-only loss on one assistant decision at a time.
6. Native and llama.cpp evaluation record calls per round and fail any response
   that emits zero or multiple calls at one decision point.

The v2 model remains disabled after this result. Router-v3 must pass the frozen
harness, novel-id copying tests, schema checks, multi-call checks and an offline
production-shaped soak before it is eligible for another live opt-in.

Train it into a new directory so the rejected v2 artifacts remain available
for comparison:

```bash
npm run functiongemma:data
python scripts/functiongemma/training/train.py \
  --train scripts/functiongemma/training/data/train.jsonl \
  --development scripts/functiongemma/training/data/development.jsonl \
  --output scripts/functiongemma/training/output/router-v3 \
  --epochs 8 \
  --batch-size 4 \
  --gradient-accumulation 2 \
  --max-length 1536 \
  --learning-rate 5e-5
```

#### Router-v3 result — 2026-08-17

Completion-only training selected checkpoint 768 after 985.6 seconds. The
selected weights are 544 MiB; best development loss was 0.018023 and reported
training loss 0.014635. These losses are not directly comparable with v1/v2,
because v3 excludes prompt and previous-turn tokens from the loss.

Five deterministic native runs passed every intended route and recovery gate:
routing 60/60 and recovery 10/10. The new production-shaped id-copy and
explicit-null scenarios passed on all five runs, with no multi-call-per-round
violations. Final-commit controls still fail as expected because candidate
selection remains outside this router's trained role.

The text-only Q8_0 conversion preserved the scores exactly under CPU-only
llama.cpp. Across all 75 frozen calls it averaged 359ms, with 231ms p50,
1.406s p95 and 1.474s maximum latency.

Because router-v2 had passed the small harness before failing live, router-v3
also underwent a larger generated soak. Three hundred fresh production-shaped
examples produced 384 independent route and recovery decisions. Every decision
used a novel 22-character current-track id and was checked for exact tool,
exact arguments, explicit nullable fields, and exactly one call per response.
Q8 CPU passed 384/384 with 338ms average, 299ms p50, 552ms p95 and 602ms
maximum latency. This clears router-v3 for a bounded live experiment; it does
not expand FunctionGemma into final selection or listener-facing work.

Segment routing is a separate opt-in on top of the picker router:

```dotenv
PRODUCER_ROUTER_SEGMENTS=1
```

When enabled, changed weather is researched directly by controller policy. A
single remaining research skill is also fetched directly. With two or more
data-backed skills, FunctionGemma chooses and executes one, then the configured
Producer model receives only that selected evidence and decides airtime and
SFX through `djProducerSegmentSelect`. Persona receives the approved evidence
afterwards and remains the sole writer. Off-air rehearsals retain the
established full Producer path. If a prompt-only custom skill is offered, or
the router fails, the complete Producer segment agent handles that tick so the
optimisation cannot make operator skills disappear.

## Hybrid live experiment

The FunctionGemma live-test branches integrate the router behind an optional
Producer Router boundary. Router-v2 retains the same split and adds the tested
empty-journey recovery plus optional segment-research routing:

1. FunctionGemma receives compact operational context and the currently
   available discovery tools.
2. It calls exactly one real SUB/WAVE discovery tool.
3. If that tool adds no grounded candidates, its call and exact result are
   replayed once so it can choose a different tool.
4. The configured Producer model receives the resulting candidate list and
   makes the final grounded track and transition decision without tools.
5. Persona remains a later, independent speech call and sees neither model's
   private reasoning.

This division is intentional. It tests the 270M model only where the frozen
evaluation supports it, while retaining Qwen-class editorial judgement for
flow, show fit, variety and soft prompt influence.

The experiment is disabled unless both variables are present in the
controller environment:

```dotenv
PRODUCER_ROUTER_BASE_URL=http://host.docker.internal:8092/v1
PRODUCER_ROUTER_MODEL=/models/Subwave-FunctionGemma-270M-Router-v2-text-Q8_0.gguf
PRODUCER_ROUTER_TIMEOUT_MS=15000
PRODUCER_ROUTER_SEGMENTS=1
```

`PRODUCER_ROUTER_API_KEY` is optional for protected compatible endpoints. The
deadline is shared across initial discovery and recovery rather than resetting
for each call.

The live safety order is:

1. FunctionGemma discovery + configured Producer final selection;
2. the complete established Producer tool-loop picker;
3. the established all-in-one Persona picker;
4. SUB/WAVE's existing stateless pool fallback.

Consequently the experiment cannot turn a router miss into dead air. It can
add latency only until its bounded deadline before the established paths take
over.

The stats/debug surfaces record `djProducerRoute` for FunctionGemma and
`djProducerSelect` for the configured Producer's final decision. Router records
include the real tool name, validated arguments, result and aggregate token
usage. A rejected route is recorded as a failure even when fallback later
fills the queue; that distinction is necessary to measure router reliability
honestly.

This is not yet a bundled installation feature or a replacement for the
advanced Producer settings. It is a controlled live experiment intended to
collect latency, recovery, route distribution and downstream selection data
before any commitment fine-tune is considered.

## Transition-effect pacing policy — 2026-08-21

The FunctionGemma selection experiment is being prepared on
`codex/producer-routing` with a temporary controller-side transition policy:
after any final on-air effect, the next two transitions must be plain before a
Producer-requested editorial effect may arm again. The ledger supplied to the
next picker records the treatments that actually armed, not effect requests
that later controller validation rejected. Automatic length-cap washouts are
never suppressed as editorial choices, but they do reset the same spacing
counter because they are still an audible effect on air.

This does **not** match upstream vanilla `develop`. Vanilla only removes a
third consecutive request for the same effect. It does not prevent an
alternating effect sequence such as washout → loop → sweep, and it records the
model-requested choices rather than final armed treatments.

The stricter policy is deliberate for the Gemma selection test: it gives every
candidate model the same deterministic on-air pacing contract and removes a
known source of effect-heavy transition runs from the comparison. It is a test
control, not yet a settled product decision. Once selection testing is complete,
review the observed transition distribution and listening results; if the
constraint is no longer needed, change the controller back to the vanilla
same-effect anti-streak behaviour (or replace it with a separately justified
production policy).

## Preferred playlist routing guard — 2026-08-20

A live preferred-playlist show exposed a routing-policy collapse: the V3
FunctionGemma router repeatedly selected `showPlaylistTracks` even while the
current track and downstream Producer selection continued changing. All calls
were valid, so success-rate telemetry alone did not reveal the loss of source
diversity.

This is now a controller policy, not a V4 training target. When a preferred
(non-strict) playlist track is on air, the next FunctionGemma route is not
offered `showPlaylistTracks` and is directed to choose another library axis.
Strict playlists remain exempt: their playlist source stays available on every
pick.

Regression coverage proves the two-route sequence: the first route may choose
the playlist tool, while the following route cannot receive it. The local live
test controller was rebuilt with this guard on 2026-08-20.

Future work:

- Continue generic Producer/Persona split features on `codex/producer-routing`.

## Live-test findings and V4 hand-off — 2026-08-20

The first post-guard observation window showed the preferred-playlist policy
working as intended: `showPlaylistTracks` no longer monopolised routing, with
`tracksTowardJourney` and other discovery axes continuing to receive calls.
The important remaining router failure is instead malformed
`tracksByMood` arguments.

The router recorded forms such as `type: "mood"`, `hormonal: "high"`,
`age: None`, and `mood: "mood"`. None is a library or candidate-recovery
failure: the live contract requires the exact keys `mood` and `energy`, with
`mood` drawn from the station vocabulary and `energy` one of `low`, `medium`,
`high`, or JSON `null`. Invalid calls are honestly recorded as failed
`djProducerRoute` events and fall through to the complete Producer picker,
preserving the queue but losing the router's latency benefit.

The next fine-tune should therefore be a targeted V4, rather than a longer
run over unchanged data. It is the final planned tool-function training pass
for this experiment and should include `generateProgrammePlan`, which has
already passed its Qwen3-4B implementation tests on `codex/producer-routing`.
Before training:

1. Add regression examples for the malformed `tracksByMood` forms, requiring
   only the live keys and exact enum/null values.
2. Freeze held-out acceptance cases for every supported function, including
   strict and preferred-playlist behaviour, cooldown routing, empty-result
   recovery, and programme-plan routing. Do not train on those prompts.
3. Keep representative sanitised live prompts as an independent acceptance
   set, and compare V3 and V4 by valid-call rate, correct-tool rate,
   argument-validity rate, recovery success, latency, and fallback frequency.
4. Consider a bounded controller recovery that removes `tracksByMood` after
   invalid arguments before invoking the complete Producer fallback; evaluate
   this separately from the model fine-tune.

The observed `djProducerSelect` average is an improvement, not a regression:
it is approximately ten seconds faster than before FunctionGemma took part in
the live path, though still about eight seconds slower than the original
GPU-hosted all-in-one function. Prioritise route correctness before further
selection-latency work.

The longer-term intended topology is FunctionGemma for bounded tool calls,
with remaining Qwen3-4B responsibilities returning to the Persona model once
the router is proven. Final track selection is explicitly a separate future
evaluation: it must demonstrate grounded candidate commitment, artist and
show constraints, transition choice, musical continuity, and safe fallback;
router validity alone is not evidence for that promotion.

The architecture document on `codex/producer-routing` currently lists
programme planning as Qwen3-4B-only while it is under evaluation. Keep that
boundary until V4 passes its independent acceptance and soak tests.

### V4 package prepared — 2026-08-21

The V4 generator is now ready for the final bounded tool-function experiment.
It keeps the V3 routing and recovery families, adds a deliberately
over-sampled `tracksByMood` schema-regression family, and adds the no-argument
`generateProgrammePlan` route. The mood examples explicitly target the live
closed contract: exactly `mood` plus `energy`, with `energy` set to a valid
level or JSON `null`.

The frozen acceptance set now includes strict-playlist routing, the
controller-owned preferred-playlist cooldown, a live-shaped mood-schema case,
and programme-plan routing. The scorer treats an unexpected argument as a
Protocol failure, so a superficially correct call such as
`tracksByMood({mood: "energetic", energy: "high", type: "mood"})` cannot
pass merely because its required values happen to be present.

Generate and train V4 separately from all earlier checkpoints:

```bash
npm run functiongemma:data
python scripts/functiongemma/training/train.py \
  --train scripts/functiongemma/training/data/train.jsonl \
  --development scripts/functiongemma/training/data/development.jsonl \
  --output scripts/functiongemma/training/output/router-v4 \
  --epochs 8 \
  --batch-size 4 \
  --gradient-accumulation 2 \
  --max-length 1536 \
  --learning-rate 5e-5
```

No V4 weights have been trained or promoted by this preparation step. After a
checkpoint is selected, run the native evaluator, CPU GGUF evaluator and
novel-id soak against V3 and V4 using the same endpoint conditions. Promotion
requires zero malformed mood calls, no V3 route/recovery regressions, and a
separately recorded live fallback comparison; it does not authorise final
track commitment or listener-facing writing.

### Router-v4 native result — 2026-08-21

V4 trained from the original BF16 `google/functiongemma-270m-it` weights on
the RTX 3060. It stopped after three epochs under the existing two-evaluation
early-stopping policy; checkpoint 384 was selected by development loss.

| Measurement | Result |
| --- | ---: |
| Best development loss | 0.009743 |
| Reported training loss | 0.021919 |
| Runtime | 769.1s |
| Selected checkpoint | 384 |

Five deterministic passes through the native held-out evaluator preserved all
trained-scope results: routing 80/80 and recovery 10/10. The new V4
acceptance cases for the closed `tracksByMood` schema, strict playlist,
preferred-playlist cooldown and `generateProgrammePlan` routing all passed on
every pass. The 15 protocol failures in the full 95-scenario report belong
only to the deliberately untrained final-commit controls; V4 remains a router,
not a final candidate selector.

`prepare_gguf.py` successfully created the text-only staging source and
verified the 262,144-token vocabulary after removing only the two unusable
image markers. The Q8 conversion was then served CPU-only through llama.cpp.
It preserved the five-pass frozen result exactly: routing 80/80 and recovery
10/10. Across all 95 calls, latency averaged 656ms, with 393ms p50, 2.677s
p95 and 2.827s maximum.

V4 nevertheless fails its promotion gate. The 300-example novel-id CPU soak
made 384 independent decisions and passed 378/384 (98.4%), at 912ms average,
973ms p50, 1.458s p95 and 1.731s maximum. Every miss was the same deterministic
regression: for a valid requested library genre `electro`, V4 called
`songsByGenre({genre: "electrochemical"})`. The existing V3 Q8 checkpoint
passes all six corresponding cases with the exact `electro` argument, so this
is not an acceptable pre-existing soak limitation or a conversion artefact.

Keep V3 as the live router benchmark and do not promote V4. Any follow-up must
add a new non-overlapping genre-boundary acceptance family and rebalance the
training mix before a separately named retraining run; it must not weaken the
exact-argument soak assertion or relabel `electrochemical` as acceptable.

### Proposed Router-v4 genre fix

The corrective run is intentionally small and continues from V4 checkpoint
384 rather than repeating the full original-weight training run. Its generated
bundle contains 600 training and 100 development conversations, retains every
existing route/recovery family, and contains 56 `genre-boundary-regression`
training examples. Those examples teach the canonical `electro` token without
copying the frozen acceptance prompt or its entities. The held-out
`route.genre-exact-electro` case and the existing 300-example novel-id soak
remain scoring gates.

Run it into an independent directory with two epochs. This uses approximately
one sixth of V4's supervised decision volume and keeps training output local:

```bash
cd /home/jaz666/subwave-functiongemma/controller
HF_HOME=/home/jaz666/.cache/huggingface \
  .functiongemma-venv/bin/python scripts/functiongemma/training/train.py \
  --model scripts/functiongemma/training/output/router-v4/best \
  --train scripts/functiongemma/training/data/router-v4-genrefix/train.jsonl \
  --development scripts/functiongemma/training/data/router-v4-genrefix/development.jsonl \
  --output scripts/functiongemma/training/output/router-v4-genrefix \
  --epochs 2 --batch-size 4 --gradient-accumulation 2 \
  --max-length 1536 --learning-rate 2e-5 \
  > scripts/functiongemma/training/output/router-v4-genrefix/train.log 2>&1
chmod 640 scripts/functiongemma/training/output/router-v4-genrefix/best/model.safetensors
```

The lower learning rate is deliberate for a continuation from a selected
checkpoint. Do not use `--resume`: this is a new corrective experiment, not a
continuation of V4's optimiser state. Evaluate the selected `best` directory
against the frozen native suite, CPU Q8 suite and full soak before promotion.

#### Credit-efficient execution requirement

For future heavyweight experiments, Codex should prepare and validate the
smallest defensible dataset, command and acceptance gates, but the operator
should run the long training/conversion command locally with output redirected
to an artifact-local log. Codex should then inspect the concise run summary,
reports and only the relevant log tail on failure. Do not stream routine epoch,
tokenisation or conversion progress through the chat. Prefer a targeted
continuation from a selected checkpoint and a compact mixed dataset when fixing
one measured regression; a full original-weight run is reserved for a changed
model scope or a demonstrated need to reset the learned behaviour.

#### Router-v4 genre fix result — 2026-08-21

The compact continuation completed in 133.9s and selected checkpoint 192 with
development loss 0.006987. It repaired the new exact-`electro` acceptance
case, but it fails the established native recovery gate: on all five passes of
`recover.empty-journey-waypoint`, its second decision calls
`tracksByMood({mood: "art-rock", energy: "low"})`. `art-rock` is a genre, not
one of the station's allowed mood values. The model also emits a third journey
call after that invalid result.

This is a deterministic regression from V4's previously clean 10/10 recovery
result. Do not convert or soak this checkpoint and do not promote it. The
failed narrow continuation demonstrates that over-weighting one argument-copy
boundary can erode a neighbouring structured-field boundary; any further
experiment needs a deliberately balanced corrective matrix for genre and mood
copying, with the existing recovery fixture retained as a hard gate.
