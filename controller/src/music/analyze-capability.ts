// Pure decision for "should this analysis pass widen its scope to backfill an
// optional dimension, and if not, what do we tell the operator?"
//
// Both widenings — CLAP "sounds-like" vectors and Demucs vocal ranges — face
// the same three-way question, and the third answer is the one that was
// missing. `capable === false` used to mean exactly one thing (the image was
// built without the model) and the message said so: "switch to the heavy
// image". A heavy image whose weights fail to download lands on the same false
// and got the same message, which is advice to do the thing already done.
//
// Side-effect-free so it can be unit-pinned (scripts/analyze-capability.test.ts).
// The messages ARE the contract here: this is the only place an operator with a
// broken analyzer finds out what broke.

export type AnalysisDimension = 'audio' | 'vocal';

export interface CapabilityInputs {
  dimension: AnalysisDimension;
  // The operator wants this dimension (env force or the admin toggle).
  wanted: boolean;
  // Backend can emit it. false = definitively not; null = unknown (a local
  // backend that hasn't been probed, or a sidecar too old to advertise).
  capable: boolean | null;
  // Why `capable` is false, when the cause is a failed model LOAD rather than a
  // lean build (analyzer.audioEmbeddingError / vocalActivityError). null
  // otherwise — including on a lean image, where nothing is wrong.
  error: string | null;
}

export interface CapabilityDecision {
  // Widen the pass to already-analysed tracks missing this dimension. False
  // when the backend definitively can't produce it — widening then re-analyses
  // the whole library every pass for a guaranteed no-op, which is the churn
  // behind the "+90 already-analysed tracks" report.
  widen: boolean;
  // One line for the pass log, or null when there is nothing to say.
  notice: string | null;
}

const LABEL: Record<AnalysisDimension, string> = {
  audio: 'audio',
  vocal: 'vocal',
};

// What the dimension needs, in the operator's terms.
const MODEL: Record<AnalysisDimension, string> = {
  audio: 'CLAP',
  vocal: 'Demucs',
};

// How to get an image that HAS the model. Deliberately names the image rather
// than a build arg: nearly everyone pulls, and `ANALYZER_HEAVY=1` is the switch
// the compose files read (it is inert on the AIO — see docs/unraid.md).
const HEAVY_HINT =
  'set ANALYZER_HEAVY=1 and recreate the analyzer, or run the -heavy AIO image';

export function backfillDecision(x: CapabilityInputs): CapabilityDecision {
  if (!x.wanted) return { widen: false, notice: null };
  if (x.capable !== false) return { widen: true, notice: null };
  const label = LABEL[x.dimension];
  const model = MODEL[x.dimension];
  if (x.error) {
    // The image HAS the model; it failed to load. Say that, say why, and say
    // that the retry is a restart — the capability is latched precisely so the
    // pass stops re-attempting it, which also means it will not clear itself.
    return {
      widen: false,
      notice:
        `${label} backfill skipped — ${model} is installed but failed to load: ${x.error}. ` +
        'Fix the cause, then restart the analyzer to retry (the failure is remembered ' +
        'until then, so the pass stops re-analysing tracks it cannot fill).',
    };
  }
  return {
    widen: false,
    notice: `${label} backfill skipped — this analyzer is built without ${model} (${HEAVY_HINT})`,
  };
}
