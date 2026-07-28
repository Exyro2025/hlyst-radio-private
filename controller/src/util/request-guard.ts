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

export function cleanRequesterName(raw: string | null | undefined, reserved: string[] = []): string {
  const cleaned = String(raw ?? '')
    .replace(NAME_DISALLOWED, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
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
export function guardAck(ack: string | null | undefined, requestText: string, fallback: string): string {
  const a = String(ack ?? '').trim();
  if (!a) return fallback;
  return echoesRequest(a, requestText, { minRun: 6 }) ? fallback : a;
}
