// Vince Morgan (station imaging) at ORDINARY track transitions — the
// counterpart to the show_open/show_close path in engine-tick/route.ts.
// Called by the controller (queue.ts's maybeVinceImaging) once per real
// track change; the controller has already checked its own local priority
// state (no DJ break busy/queued, no traffic, no severe weather, no
// emergency mode) before ever calling this — this route only decides the
// DB-side half: is the global cooldown clear, and is there eligible content.
//
// Deliberately NOT a scheduled/periodic trigger — every call here corresponds
// to a genuine, real track boundary the controller observed, so "how often
// this fires" is naturally bounded by real station activity, never a timer.

import { neon } from '@neondatabase/serverless';
import { sendToSubwave } from '@/lib/subwaveBridge.server';
import { VM_MIN_GAP_MINUTES, VM_RECENT_EXCLUDE_COUNT } from '@/lib/vmImagingConfig';

export const dynamic = 'force-dynamic';

const sql = neon(process.env.TALKWAVE_URL_POSTGRES_URL!);

function isAuthed(req: Request): boolean {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.HLYST_ENGINE_CRON_SECRET;
  return !!cronSecret && authHeader === `Bearer ${cronSecret}`;
}

export async function POST(req: Request) {
  if (!isAuthed(req)) {
    return Response.json({ fired: false, reason: 'unauthorized' }, { status: 401 });
  }

  try {
    const cooldownRows = await sql`
      SELECT last_used_at FROM vm_imaging
      WHERE last_used_at IS NOT NULL
      ORDER BY last_used_at DESC LIMIT 1
    `;
    const lastVmAt = cooldownRows.length ? new Date((cooldownRows[0] as any).last_used_at) : null;
    const cooledDown = !lastVmAt || (Date.now() - lastVmAt.getTime()) >= VM_MIN_GAP_MINUTES * 60_000;
    if (!cooledDown) {
      return Response.json({ fired: false, reason: 'cooldown active' });
    }

    // Recent-use suppression, on top of the cooldown: exclude the last
    // VM_RECENT_EXCLUDE_COUNT used ids so the same handful of assets can't
    // cycle repeatedly once cooldown has cleared several times over. Recent
    // use is tracked by last_used_at being non-null, most recent first.
    const recentRows = await sql`
      SELECT id FROM vm_imaging
      WHERE last_used_at IS NOT NULL
      ORDER BY last_used_at DESC LIMIT ${VM_RECENT_EXCLUDE_COUNT}
    `;
    const recentIds = recentRows.map((r: any) => r.id);

    // imaging_type is the real column (confirmed against the live schema) —
    // prefer a different type than the last-used asset's, so the same kind
    // of imaging (e.g. sweeper vs. promo vs. hype-drop) doesn't repeat
    // back-to-back even once cooldown clears.
    const lastTypeRows = lastVmAt
      ? await sql`SELECT imaging_type FROM vm_imaging WHERE last_used_at = ${lastVmAt.toISOString()} LIMIT 1`
      : [];
    const lastType = lastTypeRows.length ? (lastTypeRows[0] as any).imaging_type : null;
    const candidates = recentIds.length
      ? await sql`
          SELECT id, text, audio_url, imaging_type FROM vm_imaging
          WHERE status = 'approved' AND audio_status = 'rendered'
            AND id != ALL(${recentIds})
          ORDER BY (imaging_type IS NOT DISTINCT FROM ${lastType})::int, random()
          LIMIT 1
        `
      : await sql`
          SELECT id, text, audio_url, imaging_type FROM vm_imaging
          WHERE status = 'approved' AND audio_status = 'rendered'
          ORDER BY (imaging_type IS NOT DISTINCT FROM ${lastType})::int, random()
          LIMIT 1
        `;

    if (!candidates.length) {
      return Response.json({ fired: false, reason: 'no eligible content' });
    }

    const vm = candidates[0] as any;
    await sendToSubwave({
      kind: 'vm-imaging',
      text: vm.text,
      audioUrl: vm.audio_url,
      personaName: 'Vince Morgan',
    });
    await sql`UPDATE vm_imaging SET times_used = times_used + 1, last_used_at = now() WHERE id = ${vm.id}`;

    return Response.json({
      fired: true,
      reason: `ordinary transition — asset #${vm.id}${vm.imaging_type ? ` (${vm.imaging_type})` : ''}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return Response.json({ fired: false, reason: `error: ${message}` }, { status: 500 });
  }
}
