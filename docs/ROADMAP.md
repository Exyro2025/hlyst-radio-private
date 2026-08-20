# Roadmap

This is an onboarding roadmap, not a product commitment. Items are separated between maintainer-confirmed direction, repository-evidenced work, and proposals derived from missing information.

## Maintainer-confirmed direction

- Keep `develop` as the fork's main branch used to run the local Subwave version.
- Continue `codex/producer-routing` as the primary focus: separate a CPU Producer model from a GPU creative/persona model.
- Treat Qwen3-4B-Q4_K_M.gguf as a successful Producer-model result.
- Offer the producer/persona split first to the upstream lead developer as an optional opt-in change.
- Continue `codex/skills-v2` as an ongoing architecture change.
- Continue FunctionGemma as an experiment in Subwave tool-function handling, with possible future track-selection evaluation.

## Work evidenced by this checkout

- FunctionGemma has research, training/evaluation, soak-test, producer-routing, and live-test artifacts under `controller/scripts/functiongemma/`, `controller/src/llm/internal/producer/`, and related tests.
- The repository maintains multiple runtime delivery paths: split Docker services, all-in-one images, optional analyzer/TTS variants, a CLI installer, and native/mobile clients.
- CI maintains lint/typecheck, generated asset/schema/theme consistency checks, multi-architecture image publishing, CLI binary publishing, release automation, and image scanning.
- The controller has a broad set of focused tests covering broadcast policy, queueing, LLM behavior, TTS, analysis, skills, stations, settings, and schemas.

## Proposed next steps

These are proposals, not claims of an existing maintainer plan:

1. Document the producer/persona split's opt-in configuration and CPU/GPU resource assumptions.
2. Define an evaluation harness comparing the current all-in-one path, the Qwen3 Producer path, and FunctionGemma tool routing.
3. Establish fallback and rollback behavior before any producer/persona change is offered upstream.
4. Continue skills-v2 design with explicit compatibility notes for existing skills and state.
5. Define FunctionGemma graduation criteria for tool use and, separately, track selection.
6. Define an end-to-end smoke environment covering Compose startup, controller health, stream output, web onboarding, and at least one representative client.
7. Document state backup, restore, SQLite migration, and rollback expectations for upgrades.

## Open questions

The repository and current project context do not establish:

- The final upstream PR base branch for a future producer/persona contribution.
- The final FunctionGemma model, training budget, quality threshold, or track-selection readiness criteria.
- The compatibility and migration policy for skills-v2.
- The supported CPU/GPU hardware matrix for the split architecture.
- The deployment environments and provider combinations that must be supported by the fork.
