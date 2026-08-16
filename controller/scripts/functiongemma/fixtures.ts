import type { FunctionGemmaScenario, ToolContract } from './contracts.js';

const SEED_ID = 'seed-current-track';

const noArgs = (name: string): ToolContract => ({ name });
const withSongId = (name: string): ToolContract => ({ name, required: ['songId'] });

const done: ToolContract = {
  name: 'done',
  required: ['id', 'reason', 'transition'],
  enums: {
    transition: ['normal', 'blend', 'sweep', 'washout', 'dissolve', 'chop', 'loop', 'null'],
  },
};

const tracksByMood: ToolContract = {
  name: 'tracksByMood',
  required: ['mood'],
  enums: {
    mood: [
      'energetic', 'calm', 'reflective', 'celebratory', 'romantic', 'spiritual',
      'focus', 'workout', 'driving', 'cooking', 'rainy', 'sunny', 'night',
      'morning', 'evening', 'festival', 'cultural',
    ],
    energy: ['low', 'medium', 'high', 'null'],
  },
};

const tracksByEnergy: ToolContract = {
  name: 'tracksByEnergy',
  required: ['energy'],
  enums: { energy: ['low', 'medium', 'high'] },
};

const songsByGenre: ToolContract = {
  name: 'songsByGenre',
  required: ['genre'],
};

const discoveryFallbacks: readonly ToolContract[] = [
  withSongId('tracksLikeThis'),
  withSongId('similarSongs'),
  tracksByMood,
  noArgs('starredSongs'),
  done,
];

/**
 * Held-out fixtures. These are deliberately small and legible so a failed
 * score can be diagnosed by a human. They must never be exported as training
 * examples; training data gets its own scenarios and split.
 */
export const FUNCTIONGEMMA_VALIDATION_SCENARIOS: readonly FunctionGemmaScenario[] = [
  {
    id: 'route.pinned-playlist',
    stage: 'route',
    split: 'validation',
    description: 'The operator explicitly pinned a playlist for this show.',
    prompt: 'A strict show playlist is active. Search that hand-picked source before considering the wider library.',
    tools: [noArgs('showPlaylistTracks'), tracksByMood, noArgs('randomSongs')],
    route: { firstCallOneOf: ['showPlaylistTracks'] },
  },
  {
    id: 'route.sonic-journey',
    stage: 'route',
    split: 'validation',
    description: 'An active journey waypoint outranks ordinary similarity.',
    prompt: 'A sonic journey is active and its current waypoint is ready. Move one step toward it.',
    tools: [noArgs('tracksTowardJourney'), withSongId('tracksLikeThis'), tracksByMood],
    route: { firstCallOneOf: ['tracksTowardJourney'] },
  },
  {
    id: 'route.named-genre',
    stage: 'route',
    split: 'validation',
    description: 'A real genre request should use tag-aware genre discovery.',
    prompt: 'The show brief asks for a Britpop selection. Find tracks carrying that library genre.',
    tools: [songsByGenre, { name: 'searchLibrary', required: ['query'] }, noArgs('randomSongs')],
    route: { firstCallOneOf: ['songsByGenre'], arguments: { genre: 'britpop' } },
  },
  {
    id: 'route.lower-energy',
    stage: 'route',
    split: 'validation',
    description: 'A requested energy move has a dedicated structured tool.',
    prompt: 'The last run was intense. Bring the next selection down to low energy without inventing a mood.',
    tools: [tracksByEnergy, tracksByMood, noArgs('randomSongs')],
    route: { firstCallOneOf: ['tracksByEnergy'], arguments: { energy: 'low' } },
  },
  {
    id: 'route.overlooked-shelves',
    stage: 'route',
    split: 'validation',
    description: 'An explicit deep-catalogue preference should select deepCuts.',
    prompt: 'The show prefers overlooked album tracks and the recent rotation has become familiar. Explore unaired shelves.',
    tools: [noArgs('deepCuts'), noArgs('starredSongs'), noArgs('recentlyAdded')],
    route: { firstCallOneOf: ['deepCuts'] },
  },
  {
    id: 'recover.empty-semantic-index',
    stage: 'recover',
    split: 'validation',
    description: 'An empty similarity result must cause a real strategy change.',
    prompt: `Keep a reflective, low-energy flow from the current track [id: ${SEED_ID}]. Start with the library's semantic similarity, recover through a genuinely different discovery axis if it is empty, then commit only to an id actually surfaced by a tool.`,
    tools: discoveryFallbacks,
    mockResults: {
      tracksLikeThis: {
        tracks: [],
        note: 'The seed is absent from the semantic index. Choose a different discovery tool.',
      },
      similarSongs: {
        tracks: [
          { id: 'reflective-01', title: 'Still Roads', artist: 'Harbour Lights', moods: ['reflective'], energy: 'low' },
          { id: 'reflective-02', title: 'Small Hours', artist: 'North Window', moods: ['reflective'], energy: 'low' },
        ],
      },
      tracksByMood: {
        tracks: [
          { id: 'reflective-01', title: 'Still Roads', artist: 'Harbour Lights', moods: ['reflective'], energy: 'low' },
          { id: 'reflective-02', title: 'Small Hours', artist: 'North Window', moods: ['reflective'], energy: 'low' },
        ],
      },
      starredSongs: {
        tracks: [
          { id: 'safe-favourite-01', title: 'Home Signal', artist: 'Night Service', moods: ['calm'], energy: 'low' },
        ],
      },
    },
    route: { firstCallOneOf: ['tracksLikeThis'], arguments: { songId: SEED_ID } },
    recovery: {
      emptyTool: 'tracksLikeThis',
      nextCallOneOf: ['similarSongs', 'tracksByMood', 'starredSongs'],
    },
    commit: {
      surfacedIds: ['reflective-01', 'reflective-02', 'safe-favourite-01'],
      acceptableIds: ['reflective-01', 'reflective-02', 'safe-favourite-01'],
      preferredIds: ['reflective-01', 'reflective-02'],
    },
  },
  {
    id: 'commit.same-artist-trap',
    stage: 'commit',
    split: 'validation',
    description: 'A grounded choice can still be editorially wrong.',
    prompt: 'The current and previous tracks are both by Northbound. Choose from the surfaced candidates while prioritising artist variety. Candidates: [{"id":"trap-01","artist":"Northbound"},{"id":"trap-02","artist":"Northbound"},{"id":"fresh-01","artist":"Southbank"}].',
    tools: [done],
    commit: {
      surfacedIds: ['trap-01', 'trap-02', 'fresh-01'],
      acceptableIds: ['fresh-01'],
      preferredIds: ['fresh-01'],
      forbiddenIds: ['trap-01', 'trap-02'],
    },
  },
  {
    id: 'commit.quiet-flow',
    stage: 'commit',
    split: 'validation',
    description: 'The selector should distinguish continuity from a jarring jump.',
    prompt: 'On air: intimate acoustic folk, low energy, sparse vocal opening. Candidates: [{"id":"quiet-01","style":"reflective acoustic","bpm":76,"energy":"low"},{"id":"metal-01","style":"alternative metal","bpm":168,"energy":"high"},{"id":"dance-01","style":"club pop","bpm":132,"energy":"high"}]. Preserve the quiet flow.',
    tools: [done],
    commit: {
      surfacedIds: ['quiet-01', 'metal-01', 'dance-01'],
      acceptableIds: ['quiet-01'],
      preferredIds: ['quiet-01'],
      forbiddenIds: ['metal-01', 'dance-01'],
    },
  },
  {
    id: 'commit.show-brief-soft-influence',
    stage: 'commit',
    split: 'validation',
    description: 'Soft show prose should be visible in the final choice.',
    prompt: 'Show brief: prefer overlooked album tracks to obvious singles. Candidates: [{"id":"single-01","status":"famous lead single","rotation":"frequent"},{"id":"album-01","status":"compatible album track","rotation":"never aired"},{"id":"album-02","status":"compatible album track","rotation":"aired once long ago"}].',
    tools: [done],
    commit: {
      surfacedIds: ['single-01', 'album-01', 'album-02'],
      acceptableIds: ['album-01', 'album-02'],
      preferredIds: ['album-01'],
      forbiddenIds: ['single-01'],
    },
  },
];
