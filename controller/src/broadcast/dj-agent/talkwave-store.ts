// Talk Wave — reads the SAME "messages" table the web app's Talk Wave admin
// review UI (web/app/api/hlyst-admin/talkwave) writes to. This is the ONLY
// link between an owner-approved Talk Wave submission and an actual on-air
// DJ break — before this module, an approved message just sat in Postgres
// forever with no code anywhere reading it.
//
// Scope: TEXT messages only (the `messages` table). Voice notes
// (`voice_notes`) are NOT wired here — reading one on air would need
// transcription first, which is separate work and out of scope for this drop.
//
// Ordering: oldest-approved-first, via COALESCE(approved_at, created_at) —
// degrades gracefully for any already-approved rows from before approved_at
// started being set (see the two web route edits shipped alongside this
// file, which start populating it going forward).
import { neon } from '@neondatabase/serverless';

const connectionString = process.env.TALKWAVE_URL_POSTGRES_URL;
const sql = connectionString ? neon(connectionString) : null;

export interface PendingMessage {
  id: number;
  listenerName: string | null;
  category: string;
  message: string;
}

// Fails silently (returns null) on any error or missing config — a Talk Wave
// DB outage or misconfiguration should never take down the DJ's normal talk
// breaks. Same fail-open-to-silence rule every other optional segment in
// this codebase already follows (severe-weather, traffic).
export async function fetchNextApprovedMessage(): Promise<PendingMessage | null> {
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT id, listener_name, category, message
      FROM messages
      WHERE status = 'approved' AND used_at IS NULL
      ORDER BY COALESCE(approved_at, created_at) ASC
      LIMIT 1
    `;
    const row = rows[0] as any;
    if (!row) return null;
    return {
      id: Number(row.id),
      listenerName: row.listener_name ?? null,
      category: String(row.category ?? 'other'),
      message: String(row.message ?? ''),
    };
  } catch {
    return null;
  }
}

// Called once the message's paraphrase has actually aired (queue.announceAtNextTrack
// resolved). Best-effort: the caller logs failures but never lets a marking
// failure undo or block the break that already aired.
export async function markMessageUsed(id: number, djName: string | null, showName: string | null): Promise<void> {
  if (!sql) return;
  await sql`
    UPDATE messages
    SET used_at = now(), used_by_dj = ${djName}, used_by_show = ${showName}
    WHERE id = ${id}
  `;
}
