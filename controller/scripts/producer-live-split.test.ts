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
  producerRouterMessage,
  producerSelectorSystem,
} = await import('../src/broadcast/dj-agent/agents.js');
const {
  fuzzyAirTime,
  generatePersonaStationId,
  personaStationIdPrompt,
  generatePersonaSignoff,
  personaSignoffPrompt,
  generatePersonaHandoffGreeting,
  personaHandoffGreetingPrompt,
  generatePersonaLink,
  personaLinkPrompt,
  generatePersonaSegment,
  personaSegmentPrompt,
} = await import('../src/llm/internal/prompts/scripts.js');
const { buildProducerSituation, changedWeatherCapability, groundedSearchEvidence, isolatedSegmentState, personaSegmentContext, producerDirectorAgent, usableSegmentEvidence } = await import('../src/skills/_agent.js');
const { rehearsalStationServices } = await import('../src/llm/internal/tools/station-services.js');
const { showMusicLean } = await import('../src/llm/internal/prompts/picker.js');
const { queue } = await import('../src/broadcast/queue.js');

test('live picker agents declare separate Persona and Producer routes', () => {
  assert.equal(pickerAgent.role, 'persona');
  assert.equal(producerPickerAgent.role, 'producer');
  assert.equal(producerPickerAgent.kind, 'djProducerPick');
});

test('Persona station ids receive only identity, show name and anti-repeat memory', () => {
  const prompt = personaStationIdPrompt({
    persona: { name: 'Chris', scriptLength: 'concise' },
    context: {
      date: { dayLabel: 'Wednesday', dayOfMonth: 12, monthLabel: 'August', season: 'summer' },
      clock: { display: '13:15' },
      time: { period: 'afternoon', vibe: 'drive home' },
      festival: { name: 'Example Festival' },
      listeners: { count: 7 },
      activeShow: {
        name: 'Lunchtime Rocks',
        topic: 'Big guitars and loud opinions.',
        episodeAngle: 'The history of distortion.',
        moods: ['energetic'],
      },
    },
    recap: '- 4m ago [station-id]: "A previous Chris ident."',
    recentOpeners: ['A previous Chris ident'],
  });
  assert.match(prompt, /Presenter: Chris/);
  assert.match(prompt, /Lunchtime Rocks/);
  assert.match(prompt, /previous Chris ident/);
  assert.ok(!prompt.includes('Wednesday'));
  assert.ok(!prompt.includes('13:15'));
  assert.ok(!prompt.includes('afternoon'));
  assert.ok(!prompt.includes('drive home'));
  assert.ok(!prompt.includes('Example Festival'));
  assert.ok(!prompt.includes('Listeners'));
  assert.ok(!prompt.includes('Big guitars'));
  assert.ok(!prompt.includes('history of distortion'));
  assert.ok(!prompt.includes('energetic'));
  assert.ok(!prompt.includes('Tone for this segment'));
  assert.equal(typeof generatePersonaStationId, 'function');
});

test('Persona handover prompts keep the conversational bridge but drop generic context', () => {
  const context = {
    date: { dayLabel: 'Wednesday' },
    clock: { display: '10:59' },
    time: { period: 'morning', vibe: 'slow start' },
    festival: { name: 'Example Festival' },
    listeners: { count: 9 },
    activeShow: { name: 'Wrong implicit show', moods: ['calm'] },
  };
  const signoff = personaSignoffPrompt({
    personaOut: { name: 'Chris', scriptLength: 'concise' },
    personaIn: { name: 'Carrie' },
    showIn: 'Lunchtime Rocks',
    context,
    recap: '- 5m ago [link]: "Chris already said this."',
    recentOpeners: ['Chris already said'],
  });
  assert.match(signoff, /Outgoing presenter: Chris/);
  assert.match(signoff, /Incoming presenter: Carrie/);
  assert.match(signoff, /Lunchtime Rocks/);
  assert.match(signoff, /Chris already said this/);

  const greeting = personaHandoffGreetingPrompt({
    personaIn: { name: 'Carrie', scriptLength: 'concise' },
    personaOut: { name: 'Chris' },
    signoffText: 'Carrie is here now, so I am handing over.',
    showIn: 'Lunchtime Rocks',
    showBrief: 'Big guitars and loud opinions.',
    episodeAngle: 'How distortion changed rock.',
    context,
    recap: '- 2h ago [handoff]: "Carrie already used this opener."',
    recentOpeners: ['Carrie already used'],
  });
  assert.match(greeting, /Carrie is here now/);
  assert.match(greeting, /Big guitars and loud opinions/);
  assert.match(greeting, /How distortion changed rock/);
  assert.match(greeting, /Carrie already used this opener/);
  for (const prompt of [signoff, greeting]) {
    assert.ok(!prompt.includes('Wednesday'));
    assert.ok(!prompt.includes('10:59'));
    assert.ok(!prompt.includes('slow start'));
    assert.ok(!prompt.includes('Example Festival'));
    assert.ok(!prompt.includes('Listeners'));
    assert.ok(!prompt.includes('Wrong implicit show'));
    assert.ok(!prompt.includes('calm'));
    assert.ok(!prompt.includes('Tone for this segment'));
  }
  assert.equal(typeof generatePersonaSignoff, 'function');
  assert.equal(typeof generatePersonaHandoffGreeting, 'function');
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

test('hybrid routing and selection preserve the Producer/Persona boundary', () => {
  const route = producerRouterMessage({
    current: { id: 'seed-1', title: 'Current', artist: 'Artist' },
    activeShow: { name: 'Deep Cuts', topic: 'Prefer overlooked album tracks.' },
  });
  assert.match(route, /semantic index/);
  assert.match(route, /seed-1/);
  assert.match(route, /Prefer overlooked album tracks/);
  assert.ok(!route.includes('listener'));
  assert.ok(!route.includes('say'));
  assert.ok(!route.includes('transition'));

  const selector = producerSelectorSystem(null, true);
  assert.match(selector, /supplied candidate list/i);
  assert.ok(!selector.includes('using the library discovery tools'));
  assert.ok(!selector.includes('on-air presenter'));
  assert.ok(!selector.includes('listener-facing speech'));
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
  assert.equal(personaSegmentContext({ kind: 'now-playing-dig-v2', seeded: true }, ctx).includeTrack, true);
  assert.match(personaSegmentContext({ kind: 'weather-v2', seeded: true }, ctx).facts.join('\n'), /approaching 11am/);
});

test('changed weather is a controller route for both original and v2 skills', () => {
  const state = {
    seenHeadlines: new Set<string>(),
    lastWeatherCondition: 'clear',
    lastSearchedArtist: null,
    lastAnySegment: 0,
  };
  const caps = [{ kind: 'curiosity-v2' }, { kind: 'weather-v2', toolName: 'skill_weather_v2' }];
  assert.equal(changedWeatherCapability(caps, { weather: { condition: 'rain' } }, state)?.kind, 'weather-v2');
  assert.equal(changedWeatherCapability(caps, { weather: { condition: 'clear' } }, state), null);
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
  assert.equal(evidence.available, true);
  assert.deepEqual(evidence.claims.map((claim) => claim.text), [
    'Anna Meredith described “Dowager” as beginning like a spinster lament.',
  ]);
  assert.deepEqual(evidence.sources.map((source) => source.label), [
    'Anna Meredith: Varmints review: “Dowager” starts as a spinster lament.',
  ]);
});

test('v2 track research receives the same grounding policy', () => {
  assert.equal(groundedSearchEvidence('now-playing-dig-v2', {
    artist: 'Happy Mondays',
    title: 'Angel',
    answer: '',
    sources: ['Happy Mondays - Angel - CD single listing.'],
  }).available, false);
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
  }).available, false);
});

test('a track dig with no exact-track support becomes unavailable', () => {
  assert.deepEqual(groundedSearchEvidence('now-playing-dig', {
    artist: 'Anna Meredith',
    title: 'Dowager',
    answer: '',
    sources: ['The role of women in the science city included several dowagers.'],
  }).available, false);
});

test('artist web search cannot borrow the on-air track as implied evidence', () => {
  const ctx = {
    activeShow: { name: 'Another Day, Another Spin', topic: 'Music and conversation.' },
  };
  assert.equal(personaSegmentContext({ kind: 'web-search', seeded: true }, ctx).includeTrack, false);
  const evidence = groundedSearchEvidence('web-search', {
    artist: 'Kate Bush',
    answer: 'Kate Bush studied piano as a child.',
    sources: ['Kate Bush biography: she studied piano as a child.'],
  });
  assert.equal(evidence.available, true);
  assert.deepEqual(evidence.claims.map((claim) => claim.text), ['Kate Bush studied piano as a child.']);
});

test('artist snippets alone cannot authorise an invented anecdote', () => {
  assert.deepEqual(groundedSearchEvidence('web-search', {
    artist: 'Limp Bizkit',
    answer: '',
    sources: [
      'Limp Bizkit announced for Good Things festival.',
      'Limp Bizkit | NME: latest news and features.',
    ],
  }).available, false);
});
