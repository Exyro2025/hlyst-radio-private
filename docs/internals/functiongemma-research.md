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
  --iterations 5
```

Use `--api-key` when required, or set `FUNCTIONGEMMA_API_KEY`. The default
per-call deadline is 30 seconds; override it with `--timeout-ms`.

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
