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
const {
  fuzzyAirTime,
  generatePersonaLink,
  personaLinkPrompt,
  generatePersonaSegment,
  personaSegmentPrompt,
} = await import('../src/llm/internal/prompts/scripts.js');
const { buildProducerSituation, groundedSearchEvidence, isolatedSegmentState, personaSegmentContext, producerDirectorAgent, usableSegmentEvidence } = await import('../src/skills/_agent.js');
const { rehearsalStationServices } = await import('../src/llm/internal/tools/station-services.js');
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

test('the segment Producer has no listener-facing text field', () => {
  assert.equal(producerDirectorAgent.kind, 'djProducerSegment');
  assert.equal(producerDirectorAgent.role, 'producer');
  const parsed = producerDirectorAgent.schema.parse({
    air: true,
    kind: 'weather',
    reason: 'conditions changed',
    sfx: null,
    text: 'This must not cross the boundary.',
    angle: 'Nor this.',
  });
  assert.ok(!('text' in parsed));
  assert.ok(!('angle' in parsed));
});

test('the segment Producer receives operational history, not Persona prose', () => {
  queue.djLog = [
    { id: 1, kind: 'weather', message: 'The rain is holding its breath over the valley.', t: new Date().toISOString() },
  ];
  const situation = buildProducerSituation({}, [{ kind: 'weather', contextFields: [] }], null);
  assert.match(situation, /weather \(0m ago\)/);
  assert.ok(!situation.includes('holding its breath'));
});

test('the Persona segment packet contains evidence but no Producer rationale', () => {
  const prompt = personaSegmentPrompt({
    kind: 'weather',
    brief: 'Mention only a genuine change.',
    evidence: { condition: 'rain', changedSinceLastMention: true },
    contextFacts: ['Show: "The Scenic Route".', 'Approximate time: approaching 11am.'],
    recap: '- 5m ago [weather]: "A previous weather line."',
    recentOpeners: ['A previous weather line'],
    persona: { scriptLength: 'concise' },
    reason: 'Producer thinks rain suits the mood',
  });
  assert.match(prompt, /changedSinceLastMention/);
  assert.match(prompt, /approaching 11am/);
  assert.ok(!prompt.includes('Producer thinks'));
  assert.equal(typeof generatePersonaSegment, 'function');
});

test('segment context is selected for the chosen skill', () => {
  const ctx = {
    clock: { display: '10:56' },
    date: { dayLabel: 'Wednesday', dayOfMonth: 12, monthLabel: 'August', season: 'summer' },
    time: { period: 'morning' },
    activeShow: { name: 'The Scenic Route', topic: 'Take the longer way home.' },
  };
  const weather = personaSegmentContext({ kind: 'weather', seeded: true }, ctx);
  assert.match(weather.facts.join('\n'), /approaching 11am/);
  assert.ok(!weather.facts.join('\n').includes('Wednesday'));
  assert.equal(weather.includeTrack, false);
  assert.equal(personaSegmentContext({ kind: 'now-playing-dig', seeded: true }, ctx).includeTrack, true);
});

test('failed and empty tool payloads cannot reach the Persona as evidence', () => {
  assert.equal(usableSegmentEvidence({ error: 'timeout' }), false);
  assert.equal(usableSegmentEvidence({ available: false }), false);
  assert.equal(usableSegmentEvidence({ headlines: [] }), false);
  assert.equal(usableSegmentEvidence({ headlines: [{ title: 'A real item' }] }), true);
});

test('off-air rehearsal isolates in-memory and durable tool state', () => {
  const liveState = {
    seenHeadlines: new Set(['already aired']),
    lastWeatherCondition: 'cloudy',
    lastSearchedArtist: 'Queen',
    lastAnySegment: 123,
  };
  const rehearsalState = isolatedSegmentState(liveState);
  rehearsalState.seenHeadlines.add('test headline');
  rehearsalState.lastSearchedArtist = 'Robyn';
  assert.deepEqual([...liveState.seenHeadlines], ['already aired']);
  assert.equal(liveState.lastSearchedArtist, 'Queen');

  let remembered = 0;
  let logged = 0;
  const services = rehearsalStationServices({
    recall: { seen: () => true, remember: () => { remembered += 1; } },
    log: () => { logged += 1; },
  } as any);
  assert.equal(services.recall.seen('known fact'), true);
  services.recall.remember('new fact');
  services.log('test');
  assert.equal(remembered, 0);
  assert.equal(logged, 0);
});

test('now-playing evidence requires an explicit answer and exact-track source', () => {
  const evidence = groundedSearchEvidence('now-playing-dig', {
    artist: 'Anna Meredith',
    title: 'Dowager',
    answer: 'Anna Meredith described “Dowager” as beginning like a spinster lament.',
    sources: [
      'Women composers: the Dowager Countess of Radnor wrote from her armchair.',
      'Anna Meredith: Varmints review: “Dowager” starts as a spinster lament.',
    ],
  });
  assert.deepEqual(evidence.sources, [
    'Anna Meredith: Varmints review: “Dowager” starts as a spinster lament.',
  ]);
});

test('exact-track snippets alone cannot authorise a Persona claim', () => {
  assert.deepEqual(groundedSearchEvidence('now-playing-dig', {
    artist: 'Happy Mondays',
    title: 'Angel',
    answer: '',
    sources: [
      'Happy Mondays - Angel - CD (Single, Promo), 1992: View credits and track listing.',
      'Happy Mondays - Angel: Simon Machan programming; Tina Weymouth producer.',
    ],
  }), { available: false });
});

test('a track dig with no exact-track support becomes unavailable', () => {
  assert.deepEqual(groundedSearchEvidence('now-playing-dig', {
    artist: 'Anna Meredith',
    title: 'Dowager',
    answer: '',
    sources: ['The role of women in the science city included several dowagers.'],
  }), { available: false });
});

test('artist web search cannot borrow the on-air track as implied evidence', () => {
  const ctx = {
    activeShow: { name: 'Another Day, Another Spin', topic: 'Music and conversation.' },
  };
  assert.equal(personaSegmentContext({ kind: 'web-search', seeded: true }, ctx).includeTrack, false);
  assert.deepEqual(groundedSearchEvidence('web-search', {
    artist: 'Kate Bush',
    answer: 'Kate Bush studied piano as a child.',
    sources: ['Kate Bush biography: she studied piano as a child.'],
  }).sources, ['Kate Bush biography: she studied piano as a child.']);
});

test('artist snippets alone cannot authorise an invented anecdote', () => {
  assert.deepEqual(groundedSearchEvidence('web-search', {
    artist: 'Limp Bizkit',
    answer: '',
    sources: [
      'Limp Bizkit announced for Good Things festival.',
      'Limp Bizkit | NME: latest news and features.',
    ],
  }), { available: false });
});
