# SUB/WAVE architecture

This document records architecture visible in the repository plus maintainer-provided context about the fork's active work. It is an onboarding reference, not a complete runtime specification.

## Product shape

SUB/WAVE is a self-hosted, single-station internet radio system. The documented model is one shared Icecast broadcast: listeners hear the same live programme, while the DJ selects tracks and produces speech between them.

## Main components

| Area | Repository location | Responsibility visible in source |
|---|---|---|
| Broadcast | `liquidsoap/`, `docker/Dockerfile.broadcast`, `docker/icecast.xml.template` | Icecast output, Liquidsoap playback, metadata, transitions, beds, jingles, and stream state |
| Controller | `controller/src/` | HTTP server, station state, queue and scheduling, DJ orchestration, LLM providers, TTS, analysis, persistence, admin/API routes, and MCP |
| Web | `web/app/`, `web/components/`, `web/lib/` | Next.js listener player, admin console, manuals, setup pages, and server/client API integration |
| Native app | `app/src/` | Expo/React Native player, station directory, playback, casting, themes, and listener interactions |
| Operator CLI | `cli/src/`, `bin/subwave` | Setup, lifecycle, status, diagnostics, logs, updates, and platform binaries |
| Standalone MCP | `mcp-subwave/src/` | Local stdio MCP alternative to the controller's HTTP MCP endpoint |
| Runtime packaging | `docker/`, `docker-compose*.yml`, `infra/` | Caddy edge routing, split services, all-in-one images, analyzer/TTS profiles, and CLI installer deployment |

## Runtime flow

1. The broadcast container runs Icecast and Liquidsoap and exposes the shared audio stream.
2. The controller reads station configuration and persistent state, consults the library through the configured integrations, chooses or receives requests for tracks, and coordinates queue transitions and spoken segments.
3. The controller uses local or remote LLM/TTS/analyzer capabilities according to configuration. The repository contains separate analyzer and optional heavy-TTS container paths.
4. The web UI and native app consume controller/station feeds and stream audio through the configured public edge.
5. Caddy is the documented public edge in the production Compose file. The BYO Compose variant exposes internal service ports for an operator-managed reverse proxy.

## Active fork architecture

The fork's main development branch is `develop`, which is also the branch used to run the local version from `/home/jaz666/Docker/subwave`.

The primary architecture effort is `codex/producer-routing`: split the all-in-one LLM path into:

- a smaller CPU-resident Producer model for structured producer decisions and tool-function routing;
- a larger GPU-resident creative model used by DJ personas for creative speech and persona expression.

Maintainer-provided context records Qwen3-4B-Q4_K_M.gguf as a successful smaller Producer model. The producer/persona split is intended to be offered first to the upstream lead developer as an optional opt-in change; it is not the default architecture.

`codex/skills-v2` is another ongoing architecture change affecting the skills system. FunctionGemma is a separate ongoing experiment training tool-function handling, with future evaluation for track-selection decisions. Neither experiment should be described as a supported default without explicit maintainer confirmation.

## State and configuration

The production Compose configuration mounts a configurable state directory, defaulting to `./state`, at `/var/sub-wave`. The repository contains examples and seed/state files, but a running station's complete state is deployment-specific. `.env.example` documents configuration names; `.env` and state secrets are local data and must not be treated as source.

The controller uses SQLite-related dependencies and state files. Exact migration guarantees and backup/restore semantics are not fully specified by this repository; see the open questions below.

## Build and test surfaces

- Node.js 20 or newer is required by the root, controller, CLI, and standalone MCP manifests.
- The web package is built and served by Next.js.
- The native client is built and run through Expo.
- The CLI is compiled into platform binaries with Bun in CI.
- Docker Compose is the primary integration/deployment surface.
- Controller tests are individual `*.test.ts` files under `controller/scripts/`, collected by `controller/scripts/run-tests.ts`. Web, app, and tooling also contain package-local tests.
- GitHub Actions runs lint/typecheck and generated-asset checks, and publishes images/CLI artifacts from release tags.

## Repository questions not answered here

- The repository does not prove the exact production service topology, host layout, or operator ownership of a deployed station.
- It does not define a complete compatibility matrix for LLM, TTS, analyzer, Navidrome, Docker, and host architectures.
- It does not establish the supported database migration and rollback policy for existing `state/` directories.
- It does not define a single end-to-end test environment that validates audio output, external providers, and the web/native clients together.
- It does not establish the final FunctionGemma model, training budget, evaluation threshold, or track-selection readiness criteria.
