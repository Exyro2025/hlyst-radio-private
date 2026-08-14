import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  enforceSkillSpeech,
  skillSpeechLimits,
  skillSpeechMode,
} from '../src/skills/speech-policy.js';

const persona = (scriptLength: string) => ({ scriptLength });

test('every Persona length rung resolves to a finite safety envelope', () => {
  for (const mode of ['one-liner', 'concise', 'extended', 'storyteller']) {
    const limits = skillSpeechLimits(persona(mode));
    assert.ok(limits.maxSentences > 0);
    assert.ok(limits.maxWords > 0);
    assert.ok(limits.maxChars > 0);
    assert.ok(limits.maxOutputTokens > 0);
  }
  assert.equal(skillSpeechMode(persona('not-real')), 'concise');
  assert.equal(skillSpeechMode(null), 'concise');
});

test('one-liner retains one complete sentence and drops the rest', () => {
  const out = enforceSkillSpeech(
    'First sentence belongs on air. Second sentence must not reach TTS.',
    persona('one-liner'),
  );
  assert.equal(out.text, 'First sentence belongs on air.');
  assert.equal(out.clipped, true);
});

test('text inside the Persona envelope is unchanged', () => {
  const text = 'A compact weather line with a little warmth.';
  const out = enforceSkillSpeech(text, persona('concise'));
  assert.equal(out.text, text);
  assert.equal(out.clipped, false);
});

test('complete sentences are preferred when a later sentence crosses the word cap', () => {
  const first = `${Array.from({ length: 45 }, (_, i) => `first${i}`).join(' ')}.`;
  const second = `${Array.from({ length: 45 }, (_, i) => `${i === 0 ? 'Second' : 'second'}${i}`).join(' ')}.`;
  const out = enforceSkillSpeech(`${first} ${second}`, persona('concise'));
  assert.equal(out.text, first);
  assert.equal(out.clipped, true);
  assert.ok(!out.text.includes('Second0'));
});

test('one pathological sentence is clipped at a word boundary with an ellipsis', () => {
  const input = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
  const limits = skillSpeechLimits(persona('concise'));
  const out = enforceSkillSpeech(input, persona('concise'));
  assert.equal(out.clipped, true);
  assert.ok(out.text.endsWith('…'));
  assert.ok(out.text.length <= limits.maxChars);
  assert.ok((out.text.match(/\S+/gu) ?? []).length <= limits.maxWords);
});

test('whitespace is normalised before the safety calculation', () => {
  const out = enforceSkillSpeech('  A   short\n\nline.  ', persona('concise'));
  assert.equal(out.text, 'A short line.');
  assert.equal(out.clipped, false);
});
