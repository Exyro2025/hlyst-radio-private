// Talk Wave — reads the SAME "messages" and "voice_notes" tables the web
// app's Talk Wave submission/moderation/admin-review pipeline writes to.
// This is the ONLY link between an owner-approved Talk Wave submission —
// text or voice — and an actual on-air DJ break.
//
// Voice notes are NOT a separate system: they compete for the same slot,
// through the same LISTENER purpose, the same fact-preservation guard, and
// the same fetch/mark-used functions below — a voice note is just a
// PendingMessage whose `message` field holds a transcript instead of typed
// text, and whose `kind` says which table to write the "used" mark back to.
//
// Ordering: oldest-approved-first ACROSS BOTH TABLES COMBINED, via
// COALESCE(approved_at, created_at) — degrades gracefully for any
// already-approved rows from before approved_at started being set.
import { neon } from '@neondatabase/serverless';

const connectionString = process.env.TALKWAVE_URL_POSTGRES_URL;
const sql = connectionString ? neon(connectionString) : null;

export interface PendingMessage {
  kind: 'message' | 'voice_note';
  id: number;
  listenerName: string | null;
  category: string;
  message: string; // typed text, or the voice note's transcript
  // When this item was approved (or created, if never explicitly approved) —
  // COALESCE(approved_at, created_at) from the query. Used by talk-decision.ts
  // to force priority once a real listener has waited too long for a reply,
  // rather than leaving an indefinite wait to the model's own discretion each
  // decision cycle.
  waitingSince: Date;
}

// Fails silently (returns null) on any error or missing config — a Talk Wave
// DB outage or misconfiguration should never take down the DJ's normal talk
// breaks. Same fail-open-to-silence rule every other optional segment in
// this codebase already follows (severe-weather, traffic).
//
// Voice notes only enter this query once their transcript is confirmed
// confident (transcript_status = 'ok') AND owner-approved (status =
// 'approved') — a voice note that failed transcription, was too uncertain
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
    return {
      kind: row.kind === 'voice_note' ? 'voice_note' : 'message',
      id: Number(row.id),
      listenerName: row.listener_name ?? null,
      category: String(row.category ?? 'other'),
      message: String(row.text ?? ''),
      waitingSince: row.sort_at ? new Date(row.sort_at) : new Date(),
    };
  } catch {
    return null;
  }
}

// Called once the item's paraphrase has actually aired (queue.announceAtNextTrack
// resolved). Best-effort: the caller logs failures but never lets a marking
// failure undo or block the break that already aired. Routed to the correct
// table by `kind` — two explicit statements rather than a dynamic table name,
// since identifier interpolation isn't a feature this driver's tagged
// template is verified to support.
export async function markMessageUsed(kind: 'message' | 'voice_note', id: number, djName: string | null, showName: string | null): Promise<void> {
  if (!sql) return;
  if (kind === 'voice_note') {
    await sql`
      UPDATE voice_notes
      SET used_at = now(), used_by_dj = ${djName}, used_by_show = ${showName}
      WHERE id = ${id}
    `;
  } else {
    await sql`
      UPDATE messages
      SET used_at = now(), used_by_dj = ${djName}, used_by_show = ${showName}
      WHERE id = ${id}
    `;
  }
}
