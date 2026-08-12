import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.STATE_DIR = mkdtempSync(path.join(tmpdir(), 'subwave-producer-live-split-'));

const settings = await import('../src/settings.js');
await settings.load();
const {
  pickerAgent,
  producerPickMessage,
  producerPickerAgent,
  producerPickerSystem,
} = await import('../src/broadcast/dj-agent/agents.js');
const { fuzzyAirTime, generatePersonaLink, personaLinkPrompt } = await import('../src/llm/internal/prompts/scripts.js');
const { showMusicLean } = await import('../src/llm/internal/prompts/picker.js');
const { queue } = await import('../src/broadcast/queue.js');

test('live picker agents declare separate Persona and Producer routes', () => {
  assert.equal(pickerAgent.role, 'persona');
  assert.equal(producerPickerAgent.role, 'producer');
  assert.equal(producerPickerAgent.kind, 'djProducerPick');
});

test('the Producer picker system excludes the on-air Persona preamble', () => {
  const system = producerPickerSystem(null, false);
  const personaPreamble = settings.agentPersonaPreamble(settings.getEffectivePersona());
  assert.ok(personaPreamble.length > 20);
  assert.ok(!system.includes(personaPreamble));
  assert.match(system, /backstage Producer/i);
  assert.ok(!system.includes('speechBrief'));
  assert.ok(!system.includes('Keep your talk'));
  assert.match(system, /Do not plan, suggest or write anything/i);
  const strictLean = showMusicLean(
    { name: 'Test', topic: '', moods: ['calm'], filtersStrict: true },
    { includeTalk: false },
  );
  assert.ok(!strictLean.includes('Keep your talk'));
});

test('the Producer receives structured operational history without Persona prose', () => {
  const message = producerPickMessage({
    current: { id: 'now-1', title: 'Headlong', artist: 'Queen', mood: 'driving' },
    recentTracks: [{ id: 'old-1', title: 'Survivors', artist: 'Levellers', energy: 0.4 }],
    recentArtists: ['Levellers'],
    recentTransitions: ['normal', 'washout'],
    instructions: ['Use a normal transition if no effect is justified.'],
  });
  assert.match(message, /pick_next_track/);
  assert.match(message, /Headlong/);
  assert.match(message, /Survivors/);
  assert.match(message, /washout/);
  assert.ok(!message.includes('driving'));
  assert.ok(!message.includes('energy'));
  assert.ok(!message.includes('holding its breath'));
});

test('the Stage C Persona prompt contains only approved facts and negative memory', () => {
  const prompt = personaLinkPrompt({
    current: { title: 'Headlong', artist: 'Queen', introMs: 12_000, bpm: 134, musicalKey: 'D' },
    context: {
      date: { dayLabel: 'Wednesday', dayOfMonth: 12, monthLabel: 'August', season: 'summer' },
      clock: { display: '16:29' },
      time: { period: 'afternoon', vibe: 'drive home' },
      festival: { name: 'Example Festival' },
      listeners: { count: 1 },
      activeShow: {
        name: 'The Scenic Route',
        topic: 'Take the longer way home.',
        moods: ['driving', 'focus'],
      },
    },
    clockIsAirTime: true,
    persona: { scriptLength: 'concise' },
    recap: '- 2m ago [link]: "A line this presenter already used."',
    recentOpeners: ['A line this presenter'],
  });
  assert.match(prompt, /Headlong/);
  assert.match(prompt, /Queen/);
  assert.match(prompt, /The Scenic Route/);
  assert.match(prompt, /Take the longer way home/);
  assert.match(prompt, /around half past 4pm/);
  assert.ok(!prompt.includes('16:29'));
  assert.match(prompt, /do not turn it into an exact minute/i);
  assert.match(prompt, /supplied only to prevent repetition/i);
  assert.ok(!prompt.includes('Wednesday'));
  assert.ok(!prompt.includes('summer'));
  assert.ok(!prompt.includes('afternoon'));
  assert.ok(!prompt.includes('Example Festival'));
  assert.ok(!prompt.includes('Listeners'));
  assert.ok(!prompt.includes('driving'));
  assert.ok(!prompt.includes('focus'));
  assert.ok(!prompt.includes('134'));
  assert.ok(!prompt.includes('musicalKey'));
  assert.ok(!prompt.includes('Tone for this segment'));
  assert.ok(!prompt.includes('Backstage editorial direction'));
  assert.equal(typeof generatePersonaLink, 'function');
});

test('queued Persona links receive resilient fuzzy time landmarks', () => {
  assert.equal(fuzzyAirTime({ display: '10:56' }), 'approaching 11am');
  assert.equal(fuzzyAirTime({ hhmm: '11:55' }), 'approaching noon');
  assert.equal(fuzzyAirTime({ display: '23:55' }), 'approaching midnight');
  assert.equal(fuzzyAirTime({ display: '00:08' }), 'just after midnight');
  assert.equal(fuzzyAirTime({ display: 'broken' }), null);
});

test('an on-demand Persona link does not reuse the track opening as live runway', () => {
  const prompt = personaLinkPrompt({
    current: { title: 'Blow My Mind', artist: 'Robyn', introMs: 12_000, firstVocalMs: 9_000 },
    context: { clock: { display: '10:56' } },
    clockIsAirTime: true,
    includeIntroBudget: false,
    persona: { scriptLength: 'concise' },
  });
  assert.match(prompt, /approaching 11am/);
  assert.ok(!prompt.includes('9s'));
  assert.ok(!prompt.includes('vocals'));
});

test('recent speech and openers can be isolated to one Persona', () => {
  const now = new Date().toISOString();
  queue.djLog = [
    { id: 1, kind: 'link', message: 'Chris opens with a bicycle story.', t: now, meta: { personaId: 'chris' } },
    { id: 2, kind: 'link', message: 'Lucy opens with a new discovery.', t: now, meta: { personaId: 'lucy' } },
  ];
  const chrisRecap = queue.getDjRecap({ personaId: 'chris' }) || '';
  const chrisOpeners = queue.getRecentOpeners(6, 'chris');
  assert.match(chrisRecap, /bicycle story/);
  assert.ok(!chrisRecap.includes('new discovery'));
  assert.deepEqual(chrisOpeners, ['Chris opens with a bicycle']);
});
