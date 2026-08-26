# HLYST — Deployment & Portability

This document describes how HLYST Core is deployed today, and what it would
take to move it to a different host. HLYST currently runs on Vercel, with
Neon (Postgres), ElevenLabs, and (eventually) Live365 as service providers —
but these are providers the architecture uses, not things the architecture
is built around. Personas, schedules, Talk Wave logic, break-timing
decisions, and station behavior live in plain TypeScript/SQL that has no
Vercel-specific assumptions baked in.

## Architecture: the provider boundary

Every external service HLYST depends on sits behind an interface in
`web/lib/providers/`, following one existing pattern already in the
codebase (`broadcastProvider.ts`, for Live365):

| Interface | File | Current implementation |
|---|---|---|
| `LLMProvider` | `providers/LLMProvider.ts` | Anthropic, OpenAI, or Vercel AI Gateway (tried in that order) |
| `VoiceProvider` | `providers/VoiceProvider.ts` | ElevenLabs |
| `BroadcastOutputAdapter` | `broadcastProvider.ts` | Live365 |
| `StorageProvider` | `providers/StorageProvider.ts` | Vercel Blob |
| `DatabaseProvider` | `providers/DatabaseProvider.ts` | Neon (Postgres) |

**Honest current state:** `LLMProvider`, `VoiceProvider`, and
`StorageProvider` are fully wired — every real call site goes through them
(via thin compatibility wrappers: `llm.server.ts`, `elevenlabs.server.ts`,
`audioStorage.server.ts`, kept so existing route files needed zero changes).
`BroadcastOutputAdapter` was already built this way before this pass.
`DatabaseProvider` exists and works, but the ~10 existing API routes
(engine-tick, generate-break, personas, dj-breaks, health, etc.) still call
`neon(process.env.TALKWAVE_URL_POSTGRES_URL!)` directly rather than through
this interface — migrating each of those is real, separate follow-up work,
deliberately not rushed through in one pass across many working files at
once. New code should use `databaseProvider` from here on.

**To add a new provider** (a different LLM, TTS vendor, or database):
implement the relevant interface in a new class in that file, and change
the one export line at the bottom (e.g. `export const voiceProvider = new
YourNewProvider()`). Nothing elsewhere in the codebase needs to change.

## Moving off Vercel

HLYST Core is a standard Next.js app — nothing about the personas, schedule
resolution, break-timing decision logic (`breakDecision.ts`), or Talk Wave
handling depends on Vercel's runtime specifically. To move to another
Node-compatible Linux host:

1. **Database** — Neon is already standard Postgres; the connection string
   (`TALKWAVE_URL_POSTGRES_URL`) works from any host, or migrate to any
   other Postgres provider and update that one env var / the
   `NeonDatabaseProvider` implementation.
2. **LLM** — `AnthropicProvider` and `OpenAIProvider` are vendor-neutral
   REST calls, unaffected by hosting. `GatewayProvider` is Vercel-specific
   (its OIDC auth only exists in Vercel's runtime) — off Vercel, set
   `AI_GATEWAY_API_KEY` explicitly, or rely on the Anthropic/OpenAI
   providers instead, which need no Vercel-specific mechanism at all.
3. **Voice (ElevenLabs)** — plain REST API, no Vercel dependency.
4. **Storage** — `VercelBlobStorageProvider` is Vercel-specific. Moving
   off Vercel means implementing `StorageProvider` against S3, R2, or
   equivalent object storage, and swapping the export at the bottom of
   `StorageProvider.ts`. Generated audio files already in Blob would need
   copying to the new location; the `dj_breaks.audio_url` column would
   need updating to the new URLs.
5. **Scheduler** — the GitHub Actions workflow (`.github/workflows/hlyst-engine-tick.yml`)
   just does a POST to a URL with a bearer secret. It works unchanged
   against any host — only `HLYST_SITE_URL` (a GitHub Actions secret,
   not code) needs updating to the new address.
6. **Admin auth** — `ADMIN_USER`/`ADMIN_PASS` cookie-based login, no
   Vercel dependency.

## Data export / backup

Everything that matters is either in Postgres or in git:

- **Personas, schedule, Talk Wave records, DJ Breaks log, engine tick log**
  — all in Postgres. Standard `pg_dump` against the Neon connection string
  produces a complete, portable backup:
