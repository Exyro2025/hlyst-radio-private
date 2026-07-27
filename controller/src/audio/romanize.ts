// Kana → Latin romanizer for booth-bound text (issue #1179).
//
// THE BUG: every TTS engine here is fed through a phonemizer keyed to the
// station's language — espeak-ng `en-gb` for the default Kokoro/Piper path.
// espeak has no reading for Japanese codepoints, so it falls back to its
// dictionary's character-CLASS names and the DJ literally says "japanese
// letter japanese letter chinese letter" where an artist or title should be.
// Non-Latin metadata is common ("ウルフルズ - バカサバイバー"), so a Japanese
// library turns every link into that.
//
// THE FIX: hand the engine Latin letters. "ウルフルズ" → "Urufuruzu" is a
// broken-accent approximation, which is explicitly what the issue asks for
// over the placeholder. This is modified-Hepburn, the romanization an English
// phonemizer guesses closest to.
//
// SCOPE IS KANA ONLY — deliberately. Kanji (and Han characters generally) have
// no reading without a morphological dictionary: 宇多田 is "Utada" only because
// a dictionary says so, and the smallest Node analyzer that knows carries a
// ~41 MB IPADIC. So kanji and Chinese runs are passed through UNTOUCHED and
// still hit the espeak fallback. Half the reported cases, none of the weight.
// Wiring an analyzer in later means adding a branch in romanizeCjk() — the
// pipeline position and the speech-only rule below don't change.
//
// Two invariants that keep this safe to run over every spoken line:
//   1. Only kana codepoints are ever rewritten. Latin, punctuation, digits,
//      kanji, Cyrillic — every other byte survives, so a station with no
//      Japanese metadata gets byte-identical text and this is a no-op.
//   2. SPEECH ONLY. Callers must use it from normalizeForSpeech(), never
//      normalizeForDisplay() — the player feed, booth log and session keep the
//      real "ウルフルズ". A listener seeing "Urufuruzu" written down is a bug,
//      the same rule the "Ye" → "Yay" correction layer follows.
//
// No imports — pure module, unit-pinned by scripts/romanize.test.ts.

// Katakana ァ(U+30A1)–ヶ(U+30F6) maps onto hiragana ぁ(U+3041)–ゖ(U+3096) by a
// flat -0x60 offset, so folding katakana to hiragana first lets ONE table
// serve both syllabaries. The prolonged sound mark ー (U+30FC) sits outside
// that range and survives the fold to be handled as a vowel-lengthener below.
const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const KANA_FOLD_OFFSET = 0x60;

const HIRAGANA_START = 0x3041;
const HIRAGANA_END = 0x3096;
const PROLONGED = 'ー';
const SOKUON = 'っ';

// Digraphs first — two-kana sequences whose romaji is not the concatenation of
// its parts (きゃ is "kya", not "kiya"). Matched greedily before singles.
const KANA_DIGRAPHS: Record<string, string> = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho', しぇ: 'she',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo', じぇ: 'je',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', ちぇ: 'che',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  // Katakana-only sounds, reached after the fold above. These carry most
  // loanword titles — ファイト, ヴィーナス, ティアー.
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', ふゅ: 'fyu',
  ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo',
  てぃ: 'ti', でぃ: 'di', てゅ: 'tyu', でゅ: 'dyu',
  とぅ: 'tu', どぅ: 'du',
  つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso',
  うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
  しぃ: 'shi', じぃ: 'ji',
};

const KANA_SINGLES: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'o',
  ん: 'n',
  ゔ: 'vu',
  // Bare small kana — a leftover ゃ with no consonant before it, or the small
  // vowels used decoratively in titles. Read as their full-size selves.
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa',
  ゕ: 'ka', ゖ: 'ke',
};

const VOWELS = new Set(['a', 'i', 'u', 'e', 'o']);

function isKanaChar(ch: string): boolean {
  const c = ch.codePointAt(0);
  if (c === undefined) return false;
  if (c >= HIRAGANA_START && c <= HIRAGANA_END) return true;
  if (c >= KATAKANA_START && c <= KATAKANA_END) return true;
  return ch === PROLONGED;
}

function foldToHiragana(ch: string): string {
  const c = ch.codePointAt(0);
  if (c === undefined) return ch;
  if (c >= KATAKANA_START && c <= KATAKANA_END) {
    return String.fromCodePoint(c - KANA_FOLD_OFFSET);
  }
  return ch;
}

// Romanize one contiguous kana run. Split from the walker so the syllable
// rules (sokuon, prolonged mark, moraic n) only ever see kana — they read the
// PRECEDING output to decide, and letters from surrounding Latin text would
// give them the wrong answer.
function romanizeKanaRun(run: string): string {
  const kana = Array.from(run, foldToHiragana);
  let out = '';
  // The small tsu doubles the NEXT consonant, so it can only be resolved once
  // that syllable is known — carry it forward rather than emitting anything.
  let pendingSokuon = false;

  for (let i = 0; i < kana.length; i += 1) {
    const ch = kana[i];

    if (ch === SOKUON) {
      pendingSokuon = true;
      continue;
    }

    // Prolonged sound mark: lengthen whatever vowel we just emitted, which is
    // what turns バカサバイバー into "bakasabaibaa". With no vowel behind it
    // (a title opening on ー) there is nothing to double, so drop it.
    if (ch === PROLONGED) {
      const last = out.slice(-1);
      if (VOWELS.has(last)) out += last;
      continue;
    }

    const pair = i + 1 < kana.length ? ch + kana[i + 1] : '';
    let romaji = pair && KANA_DIGRAPHS[pair] ? KANA_DIGRAPHS[pair] : '';
    if (romaji) {
      i += 1;
    } else {
      romaji = KANA_SINGLES[ch] ?? '';
    }
    // Not in either table (an iteration mark, a stray combining char) — skip
    // it rather than emitting a placeholder. Unspoken beats mangled.
    if (!romaji) continue;

    if (pendingSokuon) {
      pendingSokuon = false;
      // Hepburn spells a doubled ch as "tch" (マッチ → "matchi"), not "chch".
      out += romaji.startsWith('ch') ? 't' : romaji[0];
    }

    out += romaji;
  }

  // Moraic ん assimilates to "m" before a labial — Hepburn's しんばし →
  // "shimbashi". Applied over the finished run so it can see what followed.
  return out.replace(/n(?=[bmp])/g, 'm');
}

/**
 * Rewrite Japanese kana into Latin letters, leaving every other character
 * untouched. Kanji and Chinese are out of scope (see the header) and pass
 * through unchanged.
 *
 * Speech-only — see invariant 2 in the header.
 */
export function romanizeCjk(text: string): string {
  if (!text) return text;
  // Cheap bail so the overwhelmingly common Latin-only line does no work
  // beyond one regex test.
  if (!/[ぁ-ゖァ-ヶー]/.test(text)) return text;

  let out = '';
  let run = '';
  const flush = () => {
    if (!run) return;
    const romaji = romanizeKanaRun(run);
    // Capitalize the run — kana in a track title is nearly always a proper
    // noun, and the normalized text surfaces in the TTS stats ring where
    // "urufuruzu" reads like a bug. Purely cosmetic; the engine is unaffected.
    out += romaji ? romaji[0].toUpperCase() + romaji.slice(1) : '';
    run = '';
  };

  for (const ch of text) {
    if (isKanaChar(ch)) {
      run += ch;
      continue;
    }
    flush();
    out += ch;
  }
  flush();

  return out;
}
