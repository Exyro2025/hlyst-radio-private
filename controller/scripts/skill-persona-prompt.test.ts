import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, after } from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'subwave-skill-persona-'));
process.env.STATE_DIR = root;

const { skillPersonaPreamble } = await import('../src/skills/_agent.js');

after(() => rmSync(root, { recursive: true, force: true }));

const base = {
  id: 'p_skill_test',
  name: 'Nova',
  soul: 'dry, curious and musically obsessive',
  language: 'English',
  scriptLength: 'extended',
  humour: 9,
  localColour: 1,
  warmth: 9,
};

test('skill prompt carries the selected Persona tone dials and length ceiling', () => {
  const prompt = skillPersonaPreamble({ ...base, tts: { engine: 'piper' } });
  assert.match(prompt, /dry, playful wit/i);
  assert.match(prompt, /skip local references/i);
  assert.match(prompt, /warm and earnest/i);
  assert.match(prompt, /three to five sentences/i);
  assert.match(prompt, /maximum, not a target/i);
});

test('skill prompt offers expression cues only to a compatible TTS engine', () => {
  const chatterbox = skillPersonaPreamble({ ...base, tts: { engine: 'chatterbox' } });
  assert.match(chatterbox, /\[laugh\]/);

  const piper = skillPersonaPreamble({ ...base, tts: { engine: 'piper' } });
  assert.doesNotMatch(piper, /\[laugh\]|\[laughs\]|\[whispers\]/);
});
