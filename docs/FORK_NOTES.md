# Fork notes

This file records Git evidence plus maintainer-provided fork context. Remote refs are local cached refs and may become stale.

## Remotes and collaboration boundary

The local `.git/config` contains:

- `origin`: `https://github.com/perminder-klair/subwave.git`
- `jaz666`: `https://github.com/Jaz666/subwave.git`

The upstream project at `https://github.com/perminder-klair/subwave` is the destination for pull requests intended to be shared with the wider Subwave community. The fork's `develop` branch is the main branch used to run the local version.

The local runtime checkout is `/home/jaz666/Docker/subwave`. Alternate branches should be placed in separate sibling folders/worktrees so the runtime checkout remains stable.

## Current checkout evidence

- `HEAD`: `b1103b8e`
- Current branch: `codex/functiongemma-v3-live-test`
- Current commit: `feat(llm): extend producer live-test routing`
- Local upstream ref: `origin/develop` at `6adaa6772fa8b0a2413d024db79b1c0669d86e2d`
- Local fork ref: `jaz666/develop` at `c0d8d613a4b29adc659d8ca2bedc0a98163f3841`
- Local comparison `origin/develop...HEAD`: 0 behind, 322 ahead

The comparison above is a statement about refs available in this checkout. It is not a definitive count of all fork-only commits until remotes are refreshed and the intended base is confirmed.

## Active development lines

Maintainer-provided context:

- `codex/producer-routing` has been the primary focus. It splits the all-in-one LLM approach into a smaller CPU Producer model and a more creative GPU model for DJ personas.
- Qwen3-4B-Q4_K_M.gguf proved successful as the smaller Producer model.
- The producer/persona split is intended to be offered first to the upstream lead developer as an optional opt-in change.
- `codex/skills-v2` is an ongoing architecture change.
- FunctionGemma is an ongoing experiment in training Subwave tool-function handling. The longer-term question is whether it can also handle track-selection decisions; it is not yet a supported default.

The current branch contains FunctionGemma research, router versions, evaluation, soak-test, producer/skills integration, and live-test commits. This audit does not establish whether the current live-test branch is intended for merge, long-term retention, or experimental deployment.

## Current handoff — 2026-08-20

The local test station currently runs the `codex/functiongemma-v3-live-test`
worktree. It combines FunctionGemma routing research, the producer/persona
split, and today's DJ speech/activity diagnostics. The programme-plan call is
also routed to the optional Producer leg for evaluation; Persona remains
responsible for the listener-facing programme beats.

For the current two-model experiment, FunctionGemma is limited to selecting
library/skill research functions and arguments. Qwen3-4B remains responsible
for final track commitment, transition and re-pick decisions, autonomous
segment approval/SFX, and programme planning. See
`docs/producer-persona-architecture.md` for the full boundary and the
conditions for any future Qwen3-4B retirement.

The local changes in this handoff include the FunctionGemma v3 live-test
instrumentation, DJ speech debug log, programme-plan Producer routing, and
the updated architecture/onboarding notes. Do not remove or reset unrelated
changes in this worktree while continuing these tests.

## Upstream relationship

The remote naming and history show that this checkout was configured with the original project as `origin` and the `Jaz666/subwave` fork as `jaz666`. The local branch graph also contains merges from upstream development history. No claim is made here about GitHub fork metadata, contribution policy, or whether all local branches have been pushed.

## Follow-up checks

- Confirm the upstream PR base branch at the time of opening a PR.
- Refresh both remotes before making release or divergence decisions.
- Keep experimental changes in separate branch worktrees.
- Document opt-in configuration, fallback behavior, evaluation results, and rollback steps before proposing producer/persona changes upstream.
