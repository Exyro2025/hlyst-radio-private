// Unit tests for audio/romanize.ts — the kana → Latin layer that stops espeak
// reading Japanese metadata as "japanese letter japanese letter" (issue #1179).
//
// The cases that matter most are the NEGATIVE ones: this runs over every spoken
// line on every station, so anything that isn't kana must survive byte-for-byte.
//
// Run: npm test -- romanize

import assert from 'node:assert/strict';
import { romanizeCjk } from '../src/audio/romanize.js';
import { normalizeForDisplay, normalizeForSpeech } from '../src/audio/speech-text.js';

let failures = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => { failures++; console.error(`  ✗ ${name}\n      ${err?.message || err}`); });
}

async function main() {
  console.log('the reported case:');

  await test('the issue\'s own example romanizes end to end', () => {
    // Both halves of "ウルフルズ - バカサバイバー" are pure katakana, which is
    // why this case is fixed without any kanji dictionary.
    assert.equal(romanizeCjk('ウルフルズ'), 'Urufuruzu');
    assert.equal(romanizeCjk('バカサバイバー'), 'Bakasabaibaa');
    assert.equal(romanizeCjk('ウルフルズ - バカサバイバー'), 'Urufuruzu - Bakasabaibaa');
  });

  await test('a real DJ line keeps its English intact', () => {
    assert.equal(
      romanizeCjk('Up next, ウルフルズ with バカサバイバー here on SUB/WAVE'),
      'Up next, Urufuruzu with Bakasabaibaa here on SUB/WAVE',
    );
  });

  console.log('\nkatakana and hiragana:');

  await test('both syllabaries share one table', () => {
    assert.equal(romanizeCjk('ひらがな'), 'Hiragana');
    assert.equal(romanizeCjk('カタカナ'), 'Katakana');
    assert.equal(romanizeCjk('さくら'), 'Sakura');
  });

  await test('digraphs beat their parts', () => {
    // きゃ is "kya", never "kiya".
    assert.equal(romanizeCjk('きゃく'), 'Kyaku');
    assert.equal(romanizeCjk('しゃしん'), 'Shashin');
    assert.equal(romanizeCjk('ちょうちょ'), 'Choucho');
    assert.equal(romanizeCjk('リョウ'), 'Ryou');
  });

  await test('katakana-only loanword sounds', () => {
    assert.equal(romanizeCjk('ファイト'), 'Faito');
    assert.equal(romanizeCjk('ティアー'), 'Tiaa');
    assert.equal(romanizeCjk('ヴィーナス'), 'Viinasu');
  });

  await test('prolonged sound mark lengthens the vowel before it', () => {
    assert.equal(romanizeCjk('ラーメン'), 'Raamen');
    assert.equal(romanizeCjk('ソード'), 'Soodo');
    // Nothing to lengthen — dropped rather than emitted as a stray letter.
    assert.equal(romanizeCjk('ー'), '');
  });

  await test('sokuon doubles the next consonant, tch for ch', () => {
    assert.equal(romanizeCjk('がっこう'), 'Gakkou');
    assert.equal(romanizeCjk('キット'), 'Kitto');
    assert.equal(romanizeCjk('マッチ'), 'Matchi');
    // Trailing sokuon has no consonant to double — emits nothing.
    assert.equal(romanizeCjk('あっ'), 'A');
  });

  await test('moraic n assimilates before a labial', () => {
    assert.equal(romanizeCjk('しんばし'), 'Shimbashi');
    assert.equal(romanizeCjk('さんぽ'), 'Sampo');
    // ...but stays n everywhere else.
    assert.equal(romanizeCjk('にほん'), 'Nihon');
    assert.equal(romanizeCjk('かんじ'), 'Kanji');
  });

  console.log('\nleaves everything else alone:');

  await test('Latin-only text is byte-identical', () => {
    for (const s of [
      'Up next, Fleetwood Mac with Dreams',
      'AC/DC, Ke$ha, P!nk and Florence & the Machine',
      '76°F and $5 at the door',
      'SUB/WAVE',
      '',
    ]) {
      assert.equal(romanizeCjk(s), s);
    }
  });

  await test('kanji and Chinese pass through untouched (out of scope)', () => {
    // Deliberate: a reading for these needs a ~41 MB dictionary. They still
    // hit the espeak fallback, which is the documented limitation.
    assert.equal(romanizeCjk('周杰倫'), '周杰倫');
    assert.equal(romanizeCjk('日本'), '日本');
    // Mixed kanji + kana: the kana half is still rescued.
    assert.equal(romanizeCjk('宇多田ヒカル'), '宇多田Hikaru');
  });

  await test('other non-Latin scripts are not touched', () => {
    assert.equal(romanizeCjk('Кино'), 'Кино');
    assert.equal(romanizeCjk('안녕'), '안녕');
    assert.equal(romanizeCjk('مرحبا'), 'مرحبا');
  });

  await test('punctuation, spacing and digits survive between kana runs', () => {
    assert.equal(romanizeCjk('「サクラ」 (2004)'), '「Sakura」 (2004)');
    assert.equal(romanizeCjk('アイ / ユー'), 'Ai / Yuu');
  });

  await test('idempotent — a second pass changes nothing', () => {
    const once = romanizeCjk('ウルフルズ - バカサバイバー');
    assert.equal(romanizeCjk(once), once);
  });

  console.log('\nwired into the speech pass only:');

  await test('romanization is speech-only, never display', () => {
    const line = 'Up next, ウルフルズ with バカサバイバー';
    // The player feed, booth log and session must keep the real script.
    assert.equal(normalizeForDisplay(line), line);
    assert.equal(normalizeForSpeech(line), 'Up next, Urufuruzu with Bakasabaibaa');
  });

  await test('an operator correction beats the transliteration', () => {
    // The band's own Latin name is "Ulfuls", not the literal "Urufuruzu" —
    // so the rule has to match the ORIGINAL script, i.e. corrections must run
    // before romanization.
    const rules = [{ from: 'ウルフルズ', to: 'Ulfuls' }];
    assert.equal(
      normalizeForSpeech('Up next, ウルフルズ with バカサバイバー', rules),
      'Up next, Ulfuls with Bakasabaibaa',
    );
  });

  await test('romanized text still gets the symbol pass', () => {
    // Order check: romanization must not short-circuit the rules after it.
    assert.equal(normalizeForSpeech('サクラ 100% & more'), 'Sakura 100 percent and more');
  });

  console.log(failures ? `\n${failures} failing` : '\nall passing');
  process.exit(failures ? 1 : 0);
}

main();
