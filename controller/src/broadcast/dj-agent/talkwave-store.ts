// Talk Wave -- reads the SAME "messages" and "voice_notes" tables the web
// app's Talk Wave submission/moderation/admin-review pipeline writes to.
// This is the ONLY link between an owner-approved Talk Wave submission --
// text or voice -- and an actual on-air DJ break.
//
// Voice notes are NOT a separate system: they compete for the same slot,
// through the same LISTENER purpose, the same fact-preservation guard, and
// the same fetch/mark-used functions below -- a voice note is just a
// PendingMessage whose `message` field holds a transcript instead of typed
// text, and whose `kind` says which table to write the "used" mark back to.
//
// Ordering: oldest-approved-first ACROSS BOTH TABLES COMBINED, via
// COALESCE(approved_at, created_at) -- degrades gracefully for any
// already-approved rows from before approved_at started being set.
//
// CONTINUITY (HLYST human-presence pass, item 4): short-lived, NOT a
// permanent dossier. recentExchange is a live lookup against the same
// messages/voice_notes rows that already exist for moderation/audit
// purposes -- nothing new is stored about a listener beyond the single
// dj_response_text column added to those existing rows (the actual line a
// DJ aired, so a later continuation can reference it exactly, never
// invented). recurringCount is a live COUNT query, not a stored profile --
// it disappears the moment nobody asks the question again. Only fires for
// listeners who typed a real name; anonymous submissions get no continuity,
// which is the safe default.
import { neon } from '@neondatabase/serverless';

const connectionString = process.env.TALKWAVE_URL_POSTGRES_URL;
const sql = connectionString ? neon(connectionString) : null;

// How recent a prior exchange must be to count as "continuing" a
// conversation, versus just "this person has written in before".
const CONTINUATION_WINDOW_MINUTES = 45;
// How far back the recurring-listener count looks -- long enough to catch a
// regular, short enough that it is not effectively "forever" familiarity.
const RECURRING_WINDOW_DAYS = 30;

export interface RecentExchange {
  priorMessage: string;
  djResponse: string;
}

export interface PendingMessage {
  kind: 'message' | 'voice_note';
  id: number;
  listenerName: string | null;
  category: string;
  message: string; // typed text, or the voice note's transcript
  // When this item was approved (or created, if never explicitly approved) --
  // COALESCE(approved_at, created_at) from the query. Used by talk-decision.ts
  // to force priority once a real listener has waited too long for a reply,
  // rather than leaving an indefinite wait to the model's own discretion each
  // decision cycle.
  waitingSince: Date;
  // Short-lived continuity (item 4) -- null unless a real, exact prior
  // exchange with this same listener name was found within the window above.
  recentExchange: RecentExchange | null;
  // Live count of this listener's used messages/voice notes in the last
  // RECURRING_WINDOW_DAYS -- 0 or 1 means "not established as a regular
  // yet"; only counts >1 are surfaced as a familiarity signal downstream.
  recurringCount: number;
}

// Normalises a typed listener name for matching -- trimmed, case-insensitive.
// Empty/whitespace-only names are treated as "no identity" (return null),
// since matching on blank names would wrongly link every anonymous listener
// together as if they were the same regular.
function normalizedName(name: string | null | undefined): string | null {
  const n = (name ?? '').trim();
  return n.length ? n.toLowerCase() : null;
}

// Looks up the most recent prior exchange with this same listener name,
// across both tables, that actually aired (used_at set) and has a real
// recorded dj_response_text -- never returns a fabricated or guessed pairing.
// excludeId/excludeKind keep a message from matching against itself.
async function fetchRecentExchange(
  listenerName: string | null,
  excludeKind: 'message' | 'voice_note',
  excludeId: number,
): Promise<RecentExchange | null> {
  const norm = normalizedName(listenerName);
  if (!sql || !norm) return null;
  try {
    const rows = await sql`
      SELECT * FROM (
        SELECT 'message' AS kind, id, message AS text, dj_response_text, used_at
        FROM messages
        WHERE lower(trim(listener_name)) = ${norm}
          AND used_at IS NOT NULL AND dj_response_text IS NOT NULL
          AND used_at >= now() - (${CONTINUATION_WINDOW_MINUTES} || ' minutes')::interval
        UNION ALL
        SELECT 'voice_note' AS kind, id, transcript AS text, dj_response_text, used_at
        FROM voice_notes
        WHERE lower(trim(listener_name)) = ${norm}
          AND used_at IS NOT NULL AND dj_response_text IS NOT NULL
          AND used_at >= now() - (${CONTINUATION_WINDOW_MINUTES} || ' minutes')::interval
      ) combined
      WHERE NOT (kind = ${excludeKind} AND id = ${excludeId})
      ORDER BY used_at DESC
      LIMIT 1
    `;
    const row = rows[0] as any;
    if (!row) return null;
    return { priorMessage: String(row.text ?? ''), djResponse: String(row.dj_response_text ?? '') };
  } catch {
    return null;
  }
}

// Live count -- not a stored profile. A regular is anyone whose name has
// shown up on enough aired exchanges recently; the count is recomputed from
// the existing moderation/audit rows every time, never persisted separately.
async function countRecentMessages(listenerName: string | null): Promise<number> {
  const norm = normalizedName(listenerName);
  if (!sql || !norm) return 0;
  try {
    const rows = await sql`
      SELECT
        (SELECT COUNT(*) FROM messages WHERE lower(trim(listener_name)) = ${norm} AND used_at IS NOT NULL AND used_at >= now() - (${RECURRING_WINDOW_DAYS} || ' days')::interval)
        +
        (SELECT COUNT(*) FROM voice_notes WHERE lower(trim(listener_name)) = ${norm} AND used_at IS NOT NULL AND used_at >= now() - (${RECURRING_WINDOW_DAYS} || ' days')::interval)
        AS total
    `;
    return Number((rows[0] as any)?.total ?? 0);
  } catch {
    return 0;
  }
}

// Fails silently (returns null) on any error or missing config -- a Talk Wave
// DB outage or misconfiguration should never take down the DJ's normal talk
// breaks. Same fail-open-to-silence rule every other optional segment in
// this codebase already follows (severe-weather, traffic).
//
// Voice notes only enter this query once their transcript is confirmed
// confident (transcript_status = 'ok') AND owner-approved (status =
// 'approved') -- a voice note that failed transcription, was too uncertain
// to trust, or is still quarantined never reaches the DJ, same as a text
// message in the same states.
export async function fetchNextApprovedMessage(): Promise<PendingMessage | null> {
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT * FROM (
        SELECT
          'message' AS kind, id, listener_name, category, message AS text,
          COALESCE(approved_at, created_at) AS sort_at
        FROM messages
        WHERE status = 'approved' AND used_at IS NULL
        UNION ALL
        SELECT
          'voice_note' AS kind, id, listener_name, category, transcript AS text,
          COALESCE(approved_at, created_at) AS sort_at
        FROM voice_notes
        WHERE status = 'approved' AND used_at IS NULL AND transcript_status = 'ok'
      ) combined
      ORDER BY sort_at ASC
      LIMIT 1
    `;
    const row = rows[0] as any;
    if (!row) return null;
    const kind: 'message' | 'voice_note' = row.kind === 'voice_note' ? 'voice_note' : 'message';
    const id = Number(row.id);
    const listenerName = row.listener_name ?? null;
    const [recentExchange, recurringCount] = await Promise.all([
      fetchRecentExchange(listenerName, kind, id),
      countRecentMessages(listenerName),
    ]);
    return {
      kind,
      id,
      listenerName,
      category: String(row.category ?? 'other'),
      message: String(row.text ?? ''),
      waitingSince: row.sort_at ? new Date(row.sort_at) : new Date(),
      recentExchange,
      recurringCount,
    };
  } catch {
    return null;
  }
}

// Called once the item's paraphrase has actually aired (queue.announceAtNextTrack
// resolved). Best-effort: the caller logs failures but never lets a marking
// failure undo or block the break that already aired. Routed to the correct
// table by `kind` -- two explicit statements rather than a dynamic table name,
// since identifier interpolation isn't a feature this driver's tagged
// template is verified to support.
//
// djResponseText is the EXACT line that aired -- stored so a future
// continuation lookup (fetchRecentExchange above) can quote it verbatim
// rather than guessing or re-deriving it.
export async function markMessageUsed(
  kind: 'message' | 'voice_note',
  id: number,
  djName: string | null,
  showName: string | null,
  djResponseText: string | null = null,
): Promise<void> {
  if (!sql) return;
  if (kind === 'voice_note') {
    await sql`
      UPDATE voice_notes
      SET used_at = now(), used_by_dj = ${djName}, used_by_show = ${showName}, dj_response_text = ${djResponseText}
      WHERE id = ${id}
    `;
  } else {
    await sql`
      UPDATE messages
      SET used_at = now(), used_by_dj = ${djName}, used_by_show = ${showName}, dj_response_text = ${djResponseText}
      WHERE id = ${id}
    `;
  }
}
