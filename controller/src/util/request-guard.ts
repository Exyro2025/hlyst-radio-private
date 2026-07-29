// On-air safety policy for listener requests (raid of 2026-07-28). Pure and
// side-effect-free — the policy chokepoint for routes/request.ts and
// broadcast/dj-agent.ts, pinned by scripts/request-guard.test.ts. The echo
// guard is the load-bearing layer: it is language-agnostic and catches any
// "read this on air" phrasing the opener regexes miss.

// "Read this verbatim" directive family. The payload always trails the
// directive, so cutting at the earliest match keeps the musical intent
// ("Play something Lo-Fi.") and drops the script. en + ru cover the observed
// raid; extend the list, never inline new patterns at call sites.
const OPENER_DIRECTIVES: RegExp[] = [
  /\b(start|begin|open)\s+(your|the)\s+(message|answer|reply|response)\b/i,
  /\b(answer|respond|reply|write)(\s+\S+){0,3}\s+as\s+follows\b/i,
  /\bonly\s+(write|say|output)\s+the\s+following\b/i,
  /\bdo\s+not\s+(answer|respond\s+to|mention)\s+this\s+(message|part|prompt)\b/i,
  /начн[иё]\s+(сво[йеё]\s+)?(ответ|сообщение)(?!\w)/iu,
  /ответь?\s+следующим\s+образом(?!\w)/iu,
];

export function stripScriptedOpener(raw: string): { text: string; injection: string | null } {
  const text = String(raw ?? '');
  let cut = -1;
  for (const re of OPENER_DIRECTIVES) {
    const m = re.exec(text);
    if (m && (cut === -1 || m.index < cut)) cut = m.index;
  }
  if (cut === -1) return { text, injection: null };
  // Trim a dangling connective the cut can leave behind ("... и", "... and").
  const kept = text.slice(0, cut).replace(/[\s,;:—-]+(and|и)?\s*$/iu, '').trim();
  return { text: kept, injection: 'scripted-opener' };
}

// Word-level normalization shared by the echo checks — lowercase, punctuation
// stripped, unicode-safe. Elongated troll tokens ("HEEEELP") survive as-is,
// which makes matches on them trivially strong.
function words(s: string | null | undefined): string[] {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// True when `script` reads the request back: a common contiguous run of
// >= minRun words, or (for requests of >= minWordsForRatio words) >= ratio of
// the request's words appearing in the script in order. Real intros quote a
// few words at most; both thresholds sit far above legitimate traffic —
// validated against every intro aired during the 2026-07-28 raid window.
export function echoesRequest(
  script: string | null | undefined,
  requestText: string | null | undefined,
  { minRun = 8, ratio = 0.6, minWordsForRatio = 10 }:
    { minRun?: number; ratio?: number; minWordsForRatio?: number } = {},
): boolean {
  const a = words(script);
  const b = words(requestText);
  if (!a.length || !b.length) return false;

  // Longest common contiguous run, one rolling DP row.
  let best = 0;
  let dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const next = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        next[j] = dp[j - 1] + 1;
        if (next[j] > best) best = next[j];
      }
    }
    dp = next;
  }
  if (best >= minRun) return true;

  if (b.length >= minWordsForRatio) {
    // Longest common subsequence (in-order overlap) vs the request's length.
    let prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      const next = new Array(b.length + 1).fill(0);
      for (let j = 1; j <= b.length; j++) {
        next[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], next[j - 1]);
      }
      prev = next;
    }
    if (prev[b.length] / b.length >= ratio) return true;
  }
  return false;
}

// Common-script allow-list: kills hieroglyph/cuneiform/emoji floods while
// keeping every ordinary name (Latin, Cyrillic, Arabic, Indic, CJK, ...).
const NAME_DISALLOWED = /[^\p{sc=Latin}\p{sc=Cyrillic}\p{sc=Greek}\p{sc=Arabic}\p{sc=Hebrew}\p{sc=Devanagari}\p{sc=Gurmukhi}\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}\p{sc=Thai}\p{Nd}\s\-_.']/gu;

// The screen-name cap. Lives here, next to the only code that applies it —
// middleware/ratelimit.ts used to export a REQUEST_NAME_MAX nobody read.
const NAME_MAX = 40;

export function cleanRequesterName(raw: string | null | undefined, reserved: string[] = []): string {
  const cleaned = String(raw ?? '')
    .replace(NAME_DISALLOWED, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  if (!cleaned) return 'anon';
  const lc = cleaned.toLowerCase();
  if (reserved.some((r) => r && String(r).trim().toLowerCase() === lc)) return 'anon';
  return cleaned;
}

// Echo-guard a spoken intro. `regenerate` must produce a script WITHOUT the
// request text in its prompt — it physically cannot echo what it never saw,
// so one retry suffices; if it somehow still echoes (or throws), drop the
// intro entirely (the track still airs, just unannounced).
export async function guardIntro(
  script: string | null,
  requestText: string,
  regenerate: () => Promise<string | null>,
): Promise<{ script: string | null; guard: string | null }> {
  if (!script || !echoesRequest(script, requestText)) return { script, guard: null };
  let clean: string | null = null;
  try { clean = await regenerate(); } catch { clean = null; }
  if (clean && !echoesRequest(clean, requestText)) return { script: clean, guard: 'echo-regenerated' };
  return { script: null, guard: 'echo-dropped' };
}

// Acks are <= 20 words, so the contiguous-run threshold tightens to 6. A
// failing ack is replaced, not regenerated — it's one line, the fallback reads
// fine, and it saves a model call under raid load.
//
// Reports the verdict so call sites get guardIntro's treatment: log the swap
// and flag it on the durable request record. Silent replacement left the
// operator with no signal at all under conversational trolling — the ack is
// the one line that always reaches the listener, so a run of replacements is
// exactly the shape of an attack in progress.
//
// An EMPTY ack is not a replacement: the model wrote nothing, so the fallback
// is filling a hole rather than covering an echo. Only a real echo flags.
export function screenAck(
  ack: string | null | undefined,
  requestText: string,
  fallback: string,
): { ack: string; guard: string | null } {
  const a = String(ack ?? '').trim();
  if (!a) return { ack: fallback, guard: null };
  if (!echoesRequest(a, requestText, { minRun: 6 })) return { ack: a, guard: null };
  return { ack: fallback, guard: 'ack-replaced' };
}

// Plain-string form of screenAck, for callers that only need the text.
export function guardAck(ack: string | null | undefined, requestText: string, fallback: string): string {
  return screenAck(ack, requestText, fallback).ack;
}

// Pick-path echo guard. The picker agent reads the live session window, which
// carries listener request text verbatim for up to ~40 turns / 4h, so an
// injected phrasing that slipped past the opener regexes can resurface in a
// LATER pick's spoken link — a path neither guardIntro nor screenAck sees
// (they only run on the request that carried the text). Same thresholds as
// guardIntro; `recent` is the request log's newest-first ring, so only the
// last `lookback` texts are checked — an echo of something asked hours ago
// isn't the attack this defends against, and the scan is O(script x text).
export function echoesRecentRequest(
  script: string | null | undefined,
  recent: Array<{ text?: string | null }> | null | undefined,
  { lookback = 5 }: { lookback?: number } = {},
): boolean {
  if (!script || !Array.isArray(recent)) return false;
  for (const entry of recent.slice(0, lookback)) {
    const text = entry?.text;
    if (text && echoesRequest(script, text)) return true;
  }
  return false;
}

// One-pending-per-IP hold (routes/request.ts POST /request): an IP's previous
// request must resolve AND its pick must have fully left `queuedIds` (current
// + upcoming — i.e. aired to completion) before a new one from that IP is
// accepted. Pulled out as a pure predicate rather than inlined at the call
// site so the invariant — spread across every `resolved()` closure that sets
// `entry.pick` — has one place that's actually pinned by a test, instead of a
// future resolution path silently forgetting to set `pick` and defeating the
// hold with nothing catching it.
export function stillInFlight(
  prev: { status?: string; refused?: boolean; pick?: { id?: string } } | null | undefined,
  queuedIds: Set<string>,
): boolean {
  if (!prev) return false;
  if (prev.status === 'pending') return true;
  // A REFUSED resolution (repeat cooldown, already-queued dedup) still records
  // the track it declined on `pick`, so the operator log names it — but
  // nothing was queued on this listener's behalf. Holding their next request
  // until that track leaves the queue would lock them out over a play they
  // never got: "that one just spun" followed by minutes of silence.
  if (prev.refused) return false;
  if (prev.status === 'resolved' && prev.pick?.id) return queuedIds.has(prev.pick.id);
  return false;
}
