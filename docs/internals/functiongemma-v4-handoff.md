# FunctionGemma V4 handoff — 2026-08-21

This is a concise restart point for the FunctionGemma routing experiment. Read
[`functiongemma-research.md`](functiongemma-research.md) for full context and
the recorded decisions.

## Current position

- Checkout: `/home/jaz666/subwave-functiongemma`
- Branch: `codex/functiongemma-v3-live-test`
- The hierarchy corrective matrix, harness and handoff are ready to commit.
- FunctionGemma remains a bounded tool router. It does not select the final
  track or write listener-facing content.
- `generateProgrammePlan` is intentionally included in the V4 router scope.

## Completed V4 run

The full V4 supervised run used Google's original BF16
`google/functiongemma-270m-it` weights.

| Item | Result |
| --- | --- |
| Output | `controller/scripts/functiongemma/training/output/router-v4` |
| Selected checkpoint | `checkpoint-384` / `best` |
| Development loss | 0.009743 |
| Runtime | 769.1s |
| Native frozen evaluation | routing 80/80; recovery 10/10 |
| CPU Q8 frozen evaluation | routing 80/80; recovery 10/10 |
| CPU Q8 soak | 378/384 (98.4%) — failed |

The Q8 GGUF is:

`/home/jaz666/Docker/llama_cpp/models/Subwave-FunctionGemma-270M-Router-v4-Q8_0.gguf`

V4 is **not promotable**. Its six soak failures are deterministic: an exact
requested genre `electro` becomes `electrochemical`. The existing V3 Q8
checkpoint passes all six matching cases.

Useful artifacts:

- `controller/scripts/functiongemma/training/output/router-v4/run-summary.json`
- `controller/scripts/functiongemma/training/output/router-v4/native-report.json`
- `controller/scripts/functiongemma/training/output/router-v4/cpu-report.json`
- `controller/scripts/functiongemma/training/output/router-v4/cpu-soak-report.json`

## Completed compact genre-fix continuation

A credit-efficient continuation was attempted from V4 `best` using 600 train
and 100 development conversations, two epochs and a 2e-5 learning rate.

| Item | Result |
| --- | --- |
| Output | `controller/scripts/functiongemma/training/output/router-v4-genrefix` |
| Selected checkpoint | `checkpoint-192` / `best` |
| Development loss | 0.006987 |
| Runtime | 133.9s |
| Exact `electro` acceptance | passed |
| Native recovery gate | failed 5/5 — do not convert or soak |

The compact correction fixed `electro`, but introduced a deterministic recovery
regression. In `recover.empty-journey-waypoint` it calls:

```json
{"name":"tracksByMood","arguments":{"mood":"art-rock","energy":"low"}}
```

`art-rock` is a genre, not a station mood. It then emits a third journey call.
Do not promote this checkpoint.

Useful artifacts:

- `controller/scripts/functiongemma/training/output/router-v4-genrefix/run-summary.json`
- `controller/scripts/functiongemma/training/output/router-v4-genrefix/native-report.json`

## Promoted hierarchy corrective continuation

The balanced `router-v4-hierarchy` continuation repairs both observed failure classes without weakening the frozen contract. It adds exact parent/child genre collisions (including `electro`/`electro house` and `soul`/`northern soul`) paired with valid mood-only recovery examples.

| Gate | Result |
| --- | --- |
| Selected checkpoint | `checkpoint-96` |
| Training runtime | 135.9s |
| Native frozen evaluation | routing 100/100; recovery 10/10 |
| CPU Q8 frozen evaluation | routing 100/100; recovery 10/10 |
| CPU Q8 300-example soak | 384/384; zero failures |
| CPU Q8 latency | 873ms avg; 930ms p50; 1,395ms p95; 1,571ms max |

The promotable Q8 artifact is:

`/home/jaz666/Docker/llama_cpp/models/Subwave-FunctionGemma-270M-Router-v4-Hierarchy-Q8_0.gguf`

### Weekend live observation — 2026-08-21

The weekend deployment runs this model independently on host port `8095`; the controller routes to it through `host.docker.internal:8095/v1`. The V3 router on `8092` remains intact as the rollback target.

The initial weekend request exceeded an incorrectly configured 2,048-token llama.cpp context (2,355 prompt tokens); restarting the isolated router with a 4,096-token context resolved that configuration error without changing the controller.

`PRODUCER_ROUTER_SEGMENTS=1` is also enabled for this observation. It **does not** replace Qwen3-4B's `djProducerSegment` editorial decision: FunctionGemma records `djProducerSegmentRoute` only when choosing one research function, then Qwen evaluates evidence and decides airtime/SFX, and Persona writes any approved copy. The earlier V3 live test showed `djProducerRoute` but no `djProducerSegmentRoute`; it covered music discovery, not this optional segment-research route. Watch telemetry for successful `djProducerSegmentRoute` records and repeated router failures/fallbacks.

## Harness changes in the working tree

- `training-data.ts` adds `mood-schema-regression` plus the compact
  `genre-boundary-regression` family.
- `fixtures.ts` adds held-out cases for exact `electro`, mood schema, strict
  playlist, preferred-playlist cooldown and programme planning.
- `score.ts` treats unexpected function arguments as protocol failures.
- `functiongemma-v4.test.ts` covers those boundaries.
- Focused V4 tests and `npm run typecheck` passed after the latest changes.

## Genre reference

The user supplied a 334-label library snapshot at:

`/home/codex-worker/.codex/attachments/fdb26858-fd2d-4951-bab1-af91f9901a92/allgenres.csv`

It includes `Electro` and `Art Rock`. It is a few weeks old, so use it as an
offline corpus for genre-prefix/collision and genre-vs-mood tests; do not make
it the live runtime authority. The live library should supply the actual
runtime genre whitelist.

## Local endpoints and permissions

- V3 CPU endpoint: `http://127.0.0.1:8092/v1`
- V4 CPU endpoint: `http://127.0.0.1:8093/v1`
- The V4 endpoint was launched in Portainer/Docker as a CPU-only test service.
  It may still be running; do not replace the V3 service.
- Long model artifacts created by a different local user may be mode `600`.
  Before an evaluator running as `codex-worker` reads a locally trained model,
  the operator should run:

```bash
chmod 640 scripts/functiongemma/training/output/<run>/best/model.safetensors
```

## Credit-efficient workflow requirement

Do not stream long training or conversion output through Codex. Codex should:

1. prepare a minimal, balanced data bundle and hard acceptance gates;
2. give the operator a local command redirecting output to a run-local log;
3. inspect only run summaries, reports and relevant log tails;
4. avoid a full original-weight run unless model scope changes or evidence
   requires resetting learned behaviour.

## Recommended next step

Do not immediately train another narrow patch. First create a balanced,
non-overlapping corrective matrix that jointly tests:

- exact genre copying, especially prefix collisions from the supplied corpus;
- explicit distinction between a supplied genre and allowed station moods;
- empty-journey recovery with the exact valid mood vocabulary;
- no extra arguments and exactly one call per decision.

Keep `route.genre-exact-electro`, `recover.empty-journey-waypoint`, the native
five-pass suite and the 300-example / 384-decision CPU soak as hard gates.
Only convert to Q8 after the native router/recovery gates all pass.
