import { createHash } from 'node:crypto';
import { FUNCTIONGEMMA_VALIDATION_SCENARIOS } from './fixtures.js';
import { openAiTool } from './model-runner.js';
import type { ToolContract } from './contracts.js';

const DEVELOPER_MESSAGE = [
  'You are a model that can do function calling with the following functions.',
  'You are the backstage Producer for a live personal radio station.',
  'Use exactly one offered function at each decision point.',
  'Never invent a track id. The current track is a discovery seed, not a valid pick.',
].join(' ');

type Split = 'train' | 'development';

interface TrainingMessage {
  role: 'developer' | 'user' | 'assistant' | 'tool';
  content?: unknown;
  tool_calls?: Array<{
    type: 'function';
    function: { name: string; arguments: Record<string, unknown> };
  }>;
}

export interface FunctionGemmaTrainingExample {
  id: string;
  split: Split;
  family: string;
  messages: TrainingMessage[];
  tools: ReturnType<typeof openAiTool>[];
}

interface ExampleContext {
  split: Split;
  index: number;
  random: () => number;
}

const noArgs = (name: string): ToolContract => ({ name });
const withString = (name: string, key: string): ToolContract => ({ name, required: [key] });

const moodTool: ToolContract = {
  name: 'tracksByMood',
  // Match the live Zod schema exactly. `energy` is required even when no
  // energy filter is wanted; the caller must then send JSON null.
  required: ['mood', 'energy'],
  enums: {
    mood: [
      'energetic', 'calm', 'reflective', 'celebratory', 'romantic', 'spiritual',
      'focus', 'workout', 'driving', 'cooking', 'rainy', 'sunny', 'night',
      'morning', 'evening', 'festival', 'cultural',
    ],
    energy: ['low', 'medium', 'high', null],
  },
};

const energyTool: ToolContract = {
  name: 'tracksByEnergy',
  required: ['energy'],
  enums: { energy: ['low', 'medium', 'high'] },
};

const contracts: Record<string, ToolContract> = {
  showPlaylistTracks: noArgs('showPlaylistTracks'),
  tracksTowardJourney: noArgs('tracksTowardJourney'),
  songsByGenre: withString('songsByGenre', 'genre'),
  searchLibrary: withString('searchLibrary', 'query'),
  tracksByEnergy: energyTool,
  tracksByMood: moodTool,
  deepCuts: noArgs('deepCuts'),
  starredSongs: noArgs('starredSongs'),
  recentlyAdded: noArgs('recentlyAdded'),
  randomSongs: noArgs('randomSongs'),
  tracksLikeThis: withString('tracksLikeThis', 'songId'),
  similarSongs: withString('similarSongs', 'songId'),
  skill_album_anniversary: noArgs('skill_album_anniversary'),
  skill_curiosity: noArgs('skill_curiosity'),
  skill_library_deep_cut: noArgs('skill_library_deep_cut'),
  skill_news: noArgs('skill_news'),
  skill_now_playing_dig: noArgs('skill_now_playing_dig'),
  skill_weather: noArgs('skill_weather'),
  skill_web_search: { name: 'skill_web_search', required: ['query'], enums: { query: [null] } },
  skill_album_anniversary_v2: noArgs('skill_album_anniversary_v2'),
  skill_curiosity_v2: noArgs('skill_curiosity_v2'),
  skill_news_v2: noArgs('skill_news_v2'),
  skill_now_playing_dig_v2: noArgs('skill_now_playing_dig_v2'),
  skill_weather_v2: noArgs('skill_weather_v2'),
  skill_web_search_v2: { name: 'skill_web_search_v2', required: ['query'], enums: { query: [null] } },
};

const routeFamilies = [
  'pinned-playlist', 'pinned-playlist',
  'sonic-journey', 'sonic-journey',
  'named-genre', 'named-genre', 'named-genre',
  'energy', 'energy', 'energy',
  'mood', 'mood', 'mood',
  'deep-cuts', 'deep-cuts',
  'starred',
  'recently-added',
  'semantic-similarity', 'semantic-similarity',
  'server-similarity',
  'library-search',
  'random-fallback',
  'segment-weather',
  'segment-track-research',
  'segment-artist-news',
  'segment-headlines',
  'segment-anniversary',
  'segment-curiosity',
  'segment-library-deep-cut',
] as const;

const recoveryFamilies = [
  'recover-semantic-to-mood',
  'recover-semantic-to-genre',
  'recover-semantic-to-energy',
  'recover-semantic-to-server',
  'recover-semantic-to-starred',
  'recover-server-to-mood',
  'recover-playlist-to-mood',
  'recover-journey-to-mood',
  'recover-journey-to-genre',
] as const;

const splitPools = {
  train: {
    genres: ['post-punk', 'synth-pop', 'soul', 'folk rock', 'trip-hop', 'jazz', 'funk', 'shoegaze', 'ambient', 'disco', 'punk', 'dream pop'],
    artists: ['Glass Harbour', 'Signal Fires', 'Copper Lines', 'June Arcade', 'Low Satellite', 'Paper Cinema', 'Night Assembly', 'Static Gardens'],
    titles: ['Open Windows', 'Faint Signals', 'After the Rain', 'Parallel Lines', 'Northern Rooms', 'Long Division', 'Last Light', 'Slow Current'],
  },
  development: {
    genres: ['krautrock', 'northern soul', 'art rock', 'dub', 'electro', 'garage rock'],
    artists: ['Velvet Transit', 'Amber District', 'Sunday Circuit', 'The Quiet Maps'],
    titles: ['Broken Compass', 'Signal Path', 'Soft Landing', 'Borrowed Weather'],
  },
} as const;

const moods = ['energetic', 'calm', 'reflective', 'celebratory', 'focus', 'driving', 'rainy', 'sunny', 'night', 'morning'] as const;
const energies = ['low', 'medium', 'high'] as const;
const idAlphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)];
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function liveTrackId(random: () => number): string {
  let id = '';
  for (let index = 0; index < 22; index++) id += pick(idAlphabet, random);
  return id;
}

function productionPrompt(
  instruction: string,
  currentTrack: { id: string; title: string; artist: string } | null,
  context: ExampleContext,
): string {
  const pools = splitPools[context.split];
  // Preserve one canonical no-show/no-track fallback without flooding the
  // dataset with identical conversations. Other no-seed examples still carry
  // the active show packet that production commonly has available.
  const show = context.split === 'train' && context.index === 21 ? null : {
    name: pick([
      'Another Day, Another Spin', 'The Scenic Route', 'Lunchtime Rocks',
      'The Evening Signal', 'Good Tunes',
    ], context.random),
    topic: pick([
      'Familiar favourites alongside overlooked album tracks.',
      'A varied musical route with smooth changes of pace.',
      'Prefer discoveries that still belong naturally in the current programme.',
    ], context.random),
    genres: [pick(pools.genres, context.random), pick(pools.genres, context.random)],
    moods: [pick(moods, context.random)],
    energies: [pick(energies, context.random)],
    eras: [pick(['1970-1979', '1980-1989', '1990-1999', '2000-2009', '2010-2019', '2020-2029'], context.random)],
    filtersStrict: context.index % 3 === 0,
    playlistStrict: context.index % 5 === 0,
  };
  return `${instruction}\n\n${JSON.stringify({ currentTrack, show }, null, 2)}`;
}

function call(name: string, args: Record<string, unknown> = {}): TrainingMessage {
  return {
    role: 'assistant',
    tool_calls: [{ type: 'function', function: { name, arguments: args } }],
  };
}

function toolResult(name: string, response: unknown): TrainingMessage {
  return { role: 'tool', content: { name, response } };
}

function offered(names: readonly string[], random: () => number) {
  return shuffle(names, random).map(name => openAiTool(contracts[name]));
}

function routeExample(family: typeof routeFamilies[number], context: ExampleContext): FunctionGemmaTrainingExample {
  const pools = splitPools[context.split];
  const genre = pick(pools.genres, context.random);
  const artist = pick(pools.artists, context.random);
  const title = pick(pools.titles, context.random);
  const seed = liveTrackId(context.random);
  const mood = pick(moods, context.random);
  const energy = pick(energies, context.random);
  let prompt = '';
  let target = '';
  let args: Record<string, unknown> = {};
  let tools: string[] = [];

  switch (family) {
    case 'pinned-playlist':
      prompt = pick([
        'This programme has an operator-pinned playlist. Begin discovery inside that curated source.',
        'A show playlist is pinned for this hour; honour it before searching the general catalogue.',
        'Use the active hand-curated show playlist as the source for the next selection.',
      ], context.random);
      target = 'showPlaylistTracks';
      tools = ['showPlaylistTracks', 'tracksByMood', 'searchLibrary', 'randomSongs'];
      break;
    case 'sonic-journey':
      prompt = pick([
        'The active sonic journey has a current waypoint. Discover music toward that waypoint.',
        'Continue the configured journey rather than ordinary similarity discovery.',
        'A journey route is active; take the next step along its present waypoint.',
      ], context.random);
      target = 'tracksTowardJourney';
      tools = ['tracksTowardJourney', 'tracksLikeThis', 'tracksByMood', 'randomSongs'];
      break;
    case 'named-genre':
      prompt = `The show needs a track tagged with the library genre ${genre}. Use genre-aware discovery.`;
      target = 'songsByGenre';
      args = { genre };
      tools = ['songsByGenre', 'searchLibrary', 'tracksByMood', 'randomSongs'];
      break;
    case 'energy':
      prompt = `Move the music to ${energy} energy. No mood has been requested.`;
      target = 'tracksByEnergy';
      args = { energy };
      tools = ['tracksByEnergy', 'tracksByMood', 'searchLibrary', 'randomSongs'];
      break;
    case 'mood':
      prompt = `Find a ${mood} track${context.random() > 0.45 ? ` at ${energy} energy` : ''} using structured station tags.`;
      target = 'tracksByMood';
      args = { mood, energy: prompt.includes(' energy') ? energy : null };
      tools = ['tracksByMood', 'tracksByEnergy', 'searchLibrary', 'randomSongs'];
      break;
    case 'deep-cuts':
      prompt = pick([
        'Explore neglected catalogue tracks that have never aired or have been absent for a long time.',
        'The rotation feels familiar. Search the unaired and long-unplayed shelves.',
        'Prefer an overlooked album cut instead of recent additions or established favourites.',
      ], context.random);
      target = 'deepCuts';
      tools = ['deepCuts', 'starredSongs', 'recentlyAdded', 'randomSongs'];
      break;
    case 'starred':
      prompt = 'The operator explicitly wants one of their starred library favourites.';
      target = 'starredSongs';
      tools = ['starredSongs', 'deepCuts', 'recentlyAdded', 'randomSongs'];
      break;
    case 'recently-added':
      prompt = 'Explore music from albums added to the library recently.';
      target = 'recentlyAdded';
      tools = ['recentlyAdded', 'deepCuts', 'starredSongs', 'randomSongs'];
      break;
    case 'semantic-similarity':
      prompt = `Use the library semantic index to find music like the current track [id: ${seed}].`;
      target = 'tracksLikeThis';
      args = { songId: seed };
      tools = ['tracksLikeThis', 'similarSongs', 'tracksByMood', 'randomSongs'];
      break;
    case 'server-similarity':
      prompt = `Use the music server's native related-song service for the current track [id: ${seed}].`;
      target = 'similarSongs';
      args = { songId: seed };
      tools = ['similarSongs', 'tracksLikeThis', 'searchLibrary', 'randomSongs'];
      break;
    case 'library-search':
      prompt = context.random() > 0.5
        ? `Search the library directly for the artist ${artist}.`
        : `Search the library directly for the title ${title}.`;
      target = 'searchLibrary';
      args = { query: prompt.includes('artist') ? artist : title };
      tools = ['searchLibrary', 'songsByGenre', 'tracksByMood', 'randomSongs'];
      break;
    case 'random-fallback':
      prompt = 'No playlist, journey, genre, mood, energy, similarity seed or named search is available. Return a broad library sample.';
      target = 'randomSongs';
      tools = ['randomSongs', 'tracksByMood', 'searchLibrary', 'deepCuts'];
      break;
    case 'segment-weather': {
      const suffix = context.index % 2 ? '_v2' : '';
      prompt = 'Choose one research function for a between-track segment. The weather has changed noticeably since the last bulletin; research the current conditions.';
      target = `skill_weather${suffix}`;
      tools = [target, `skill_news${suffix}`, `skill_curiosity${suffix}`, `skill_now_playing_dig${suffix}`];
      break;
    }
    case 'segment-track-research': {
      const suffix = context.index % 2 ? '_v2' : '';
      prompt = 'Choose one research function for a between-track segment. Find one verifiable production or release detail about the exact track now playing.';
      target = `skill_now_playing_dig${suffix}`;
      tools = [target, `skill_web_search${suffix}`, `skill_news${suffix}`, `skill_weather${suffix}`];
      break;
    }
    case 'segment-artist-news': {
      const suffix = context.index % 2 ? '_v2' : '';
      prompt = 'Choose one research function for a between-track segment. Look for genuinely recent news about the artist currently on air.';
      target = `skill_web_search${suffix}`;
      args = { query: null };
      tools = [target, `skill_now_playing_dig${suffix}`, `skill_news${suffix}`, `skill_weather${suffix}`];
      break;
    }
    case 'segment-headlines': {
      const suffix = context.index % 2 ? '_v2' : '';
      prompt = 'Choose one research function for a between-track segment. Check the configured current-news feed for a fresh general headline.';
      target = `skill_news${suffix}`;
      tools = [target, `skill_web_search${suffix}`, `skill_curiosity${suffix}`, `skill_weather${suffix}`];
      break;
    }
    case 'segment-anniversary': {
      const suffix = context.index % 2 ? '_v2' : '';
      prompt = 'Choose one research function for a between-track segment. Check whether the album currently on air has a meaningful release anniversary this year.';
      target = `skill_album_anniversary${suffix}`;
      tools = [target, `skill_now_playing_dig${suffix}`, `skill_curiosity${suffix}`, `skill_news${suffix}`];
      break;
    }
    case 'segment-curiosity': {
      const suffix = context.index % 2 ? '_v2' : '';
      prompt = 'Choose one research function for a between-track segment. Fetch a fresh historical event tied to today\'s date.';
      target = `skill_curiosity${suffix}`;
      tools = [target, `skill_news${suffix}`, `skill_weather${suffix}`, `skill_album_anniversary${suffix}`];
      break;
    }
    case 'segment-library-deep-cut':
      prompt = 'Choose one research function for a between-track segment. Find a long-unplayed library track by the artist currently on air.';
      target = 'skill_library_deep_cut';
      tools = [target, 'skill_now_playing_dig', 'skill_web_search', 'skill_news'];
      break;
  }

  prompt = productionPrompt(
    prompt,
    family === 'random-fallback' ? null : { id: seed, title, artist },
    context,
  );

  return {
    id: `${context.split}.route.${family}.${context.index}`,
    split: context.split,
    family: `route.${family}`,
    messages: [
      { role: 'developer', content: DEVELOPER_MESSAGE },
      { role: 'user', content: prompt },
      call(target, args),
    ],
    tools: offered(tools, context.random),
  };
}

function recoveryExample(family: typeof recoveryFamilies[number], context: ExampleContext): FunctionGemmaTrainingExample {
  const pools = splitPools[context.split];
  const seed = liveTrackId(context.random);
  const genre = pick(pools.genres, context.random);
  const artist = pick(pools.artists, context.random);
  const title = pick(pools.titles, context.random);
  const mood = pick(moods, context.random);
  const energy = pick(energies, context.random);
  let prompt = '';
  let first = 'tracksLikeThis';
  let next = '';
  let nextArgs: Record<string, unknown> = {};
  let names: string[] = [];

  switch (family) {
    case 'recover-semantic-to-mood':
      prompt = `Keep a ${mood}, ${energy}-energy flow from [id: ${seed}]. Try semantic similarity first, then change discovery axis if its index has no result.`;
      next = 'tracksByMood';
      nextArgs = { mood, energy };
      names = ['tracksLikeThis', 'similarSongs', 'tracksByMood', 'starredSongs'];
      break;
    case 'recover-semantic-to-genre':
      prompt = `Stay within ${genre} from [id: ${seed}]. Try semantic similarity first; if empty, use the structured genre tags.`;
      next = 'songsByGenre';
      nextArgs = { genre };
      names = ['tracksLikeThis', 'songsByGenre', 'searchLibrary', 'randomSongs'];
      break;
    case 'recover-semantic-to-energy':
      prompt = `Continue from [id: ${seed}] at ${energy} energy. Try semantic similarity first and use the dedicated energy axis if it is empty.`;
      next = 'tracksByEnergy';
      nextArgs = { energy };
      names = ['tracksLikeThis', 'tracksByEnergy', 'tracksByMood', 'randomSongs'];
      break;
    case 'recover-semantic-to-server':
      prompt = `Find a related track from [id: ${seed}]. Start with the semantic index and fall back to the music server's related-song service if absent.`;
      next = 'similarSongs';
      nextArgs = { songId: seed };
      names = ['tracksLikeThis', 'similarSongs', 'tracksByMood', 'randomSongs'];
      break;
    case 'recover-semantic-to-starred':
      prompt = `Use [id: ${seed}] as a similarity seed. If the semantic index is empty, recover with an operator-starred safe choice.`;
      next = 'starredSongs';
      names = ['tracksLikeThis', 'similarSongs', 'starredSongs', 'randomSongs'];
      break;
    case 'recover-server-to-mood':
      prompt = `Ask the music server for songs related to [id: ${seed}], then switch to ${mood} tags if that service returns nothing.`;
      first = 'similarSongs';
      next = 'tracksByMood';
      nextArgs = { mood, energy: null };
      names = ['similarSongs', 'tracksLikeThis', 'tracksByMood', 'randomSongs'];
      break;
    case 'recover-playlist-to-mood':
      prompt = `Start with the active show playlist. If every pinned track is filtered out, recover through the ${mood} mood axis.`;
      first = 'showPlaylistTracks';
      next = 'tracksByMood';
      nextArgs = { mood, energy: null };
      names = ['showPlaylistTracks', 'tracksByMood', 'deepCuts', 'randomSongs'];
      break;
    case 'recover-journey-to-mood':
      prompt = `Continue the active sonic journey while preserving the show's ${mood}, ${energy}-energy character. If the current waypoint returns no eligible tracks, change to the structured show mood.`;
      first = 'tracksTowardJourney';
      next = 'tracksByMood';
      nextArgs = { mood, energy };
      names = ['tracksTowardJourney', 'tracksByMood', 'songsByGenre', 'randomSongs'];
      break;
    case 'recover-journey-to-genre':
      prompt = `Continue the active sonic journey inside a ${genre} show. If the current waypoint returns no eligible tracks, recover through the show's structured genre rather than repeating the journey search.`;
      first = 'tracksTowardJourney';
      next = 'songsByGenre';
      nextArgs = { genre };
      names = ['tracksTowardJourney', 'songsByGenre', 'tracksByMood', 'randomSongs'];
      break;
  }

  prompt = productionPrompt(prompt, { id: seed, title, artist }, context);

  const firstArgs = first === 'showPlaylistTracks' || first === 'tracksTowardJourney' ? {} : { songId: seed };
  return {
    id: `${context.split}.recover.${family}.${context.index}`,
    split: context.split,
    family: `recover.${family}`,
    messages: [
      { role: 'developer', content: DEVELOPER_MESSAGE },
      { role: 'user', content: prompt },
      call(first, firstArgs),
      toolResult(first, {
        tracks: [],
        note: first === 'showPlaylistTracks'
          ? 'All pinned tracks were filtered out. Choose a genuinely different discovery tool.'
          : first === 'tracksTowardJourney'
            ? 'The active journey waypoint returned no eligible tracks. Use the show mood or genre instead; do not repeat this tool.'
            : 'No candidates were found. Change discovery strategy rather than repeating this tool.',
      }),
      call(next, nextArgs),
    ],
    tools: offered(names, context.random),
  };
}

function fingerprint(example: FunctionGemmaTrainingExample): string {
  return createHash('sha256').update(JSON.stringify(example.messages)).digest('hex');
}

export function generateTrainingExamples(
  split: Split,
  count: number,
  seed = split === 'train' ? 0x5B7A1E : 0xD3A10,
): FunctionGemmaTrainingExample[] {
  if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');
  const random = mulberry32(seed);
  const routeCount = Math.round(count * 0.72);
  const examples: FunctionGemmaTrainingExample[] = [];
  for (let index = 0; index < count; index++) {
    const context = { split, index, random };
    examples.push(index < routeCount
      ? routeExample(routeFamilies[index % routeFamilies.length], context)
      : recoveryExample(recoveryFamilies[(index - routeCount) % recoveryFamilies.length], context));
  }
  return shuffle(examples, random);
}

export function validateTrainingSets(
  train: readonly FunctionGemmaTrainingExample[],
  development: readonly FunctionGemmaTrainingExample[],
): { families: Record<string, number>; fingerprints: { train: string; development: string } } {
  const violations: string[] = [];
  const all = [...train, ...development];
  const ids = new Set<string>();
  const trackIds = new Set<string>();
  const messageFingerprints = new Map<string, string>();
  const validationPrompts = new Set(FUNCTIONGEMMA_VALIDATION_SCENARIOS.map(item => item.prompt));
  const bannedValidationLiterals = [
    'seed-current-track', 'V7mx9Qb2nL4sR8tK1cWdFz', 'p3Hx8Lm5Qa2Vn7Ds4KcR9W',
    'reflective-01', 'reflective-02', 'safe-favourite-01',
    'trap-01', 'trap-02', 'fresh-01', 'quiet-01', 'metal-01', 'dance-01',
    'single-01', 'album-01', 'album-02', 'Northbound', 'Southbank', 'Britpop',
  ];
  const families: Record<string, number> = {};

  for (const example of all) {
    if (ids.has(example.id)) violations.push(`duplicate id: ${example.id}`);
    ids.add(example.id);
    families[example.family] = (families[example.family] ?? 0) + 1;
    const user = example.messages.find(message => message.role === 'user')?.content;
    if (typeof user !== 'string') violations.push(`${example.id}: missing user prompt`);
    if (typeof user === 'string' && validationPrompts.has(user)) violations.push(`${example.id}: copied validation prompt`);
    let currentTrackId: string | undefined;
    if (typeof user === 'string') {
      const jsonStart = user.indexOf('\n\n{');
      try {
        const context = JSON.parse(user.slice(jsonStart + 2));
        currentTrackId = context?.currentTrack?.id;
      } catch {
        violations.push(`${example.id}: malformed production context`);
      }
    }
    if (example.family === 'route.random-fallback' && currentTrackId == null) {
      // This mirrors the live no-seed path.
    } else if (typeof currentTrackId !== 'string' || !/^[A-Za-z0-9]{22}$/.test(currentTrackId)) {
      violations.push(`${example.id}: current track id is not production-shaped`);
    } else if (trackIds.has(currentTrackId)) {
      violations.push(`${example.id}: repeated current track id ${currentTrackId}`);
    } else {
      trackIds.add(currentTrackId);
    }
    const serialised = JSON.stringify(example);
    for (const literal of bannedValidationLiterals) {
      if (serialised.includes(literal)) violations.push(`${example.id}: leaked validation literal ${literal}`);
    }
    const toolNames = new Set(example.tools.map(tool => tool.function.name));
    const assistantCalls = example.messages
      .filter(message => message.role === 'assistant')
      .flatMap(message => message.tool_calls ?? []);
    if (!assistantCalls.length) violations.push(`${example.id}: missing assistant tool call`);
    for (const assistantCall of assistantCalls) {
      const name = assistantCall.function.name;
      if (!toolNames.has(name)) {
        violations.push(`${example.id}: target tool not offered: ${name}`);
      }
      const contract = contracts[name];
      const args = assistantCall.function.arguments;
      for (const key of contract?.required ?? []) {
        if (!(key in args)) violations.push(`${example.id}: ${name} missing required argument ${key}`);
      }
      for (const [key, allowed] of Object.entries(contract?.enums ?? {})) {
        if (key in args && !allowed.includes(args[key] as never)) {
          violations.push(`${example.id}: ${name} has invalid ${key}`);
        }
      }
      if ((name === 'tracksLikeThis' || name === 'similarSongs') && args.songId !== currentTrackId) {
        violations.push(`${example.id}: ${name} did not copy the current track id`);
      }
    }
    const hash = fingerprint(example);
    const previousSplit = messageFingerprints.get(hash);
    if (previousSplit) {
      violations.push(`${example.id}: duplicate conversation (first seen in ${previousSplit})`);
    }
    messageFingerprints.set(hash, example.split);
  }

  if (violations.length) throw new Error(`invalid FunctionGemma dataset:\n${violations.slice(0, 25).join('\n')}`);
  const hashSet = (items: readonly FunctionGemmaTrainingExample[]) => createHash('sha256')
    .update(items.map(item => JSON.stringify(item)).join('\n'))
    .digest('hex');
  return {
    families: Object.fromEntries(Object.entries(families).sort(([left], [right]) => left.localeCompare(right))),
    fingerprints: { train: hashSet(train), development: hashSet(development) },
  };
}
