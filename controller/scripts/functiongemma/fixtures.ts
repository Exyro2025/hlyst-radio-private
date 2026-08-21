import type { FunctionGemmaScenario, ToolContract } from './contracts.js';

const SEED_ID = 'V7mx9Qb2nL4sR8tK1cWdFz';
const MOOD_SEED_ID = 'p3Hx8Lm5Qa2Vn7Ds4KcR9W';

function productionPrompt(
  instruction: string,
  currentTrack: { id: string; title: string; artist: string } | null,
  show: Record<string, unknown> | null,
): string {
  return `${instruction}\n\n${JSON.stringify({ currentTrack, show }, null, 2)}`;
}

const noArgs = (name: string): ToolContract => ({ name });
const withSongId = (name: string): ToolContract => ({ name, required: ['songId'] });

const done: ToolContract = {
  name: 'done',
  required: ['id', 'reason', 'transition'],
  enums: {
    transition: ['normal', 'blend', 'sweep', 'washout', 'dissolve', 'chop', 'loop', null],
  },
};

const tracksByMood: ToolContract = {
  name: 'tracksByMood',
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

const tracksByEnergy: ToolContract = {
  name: 'tracksByEnergy',
  required: ['energy'],
  enums: { energy: ['low', 'medium', 'high'] },
};

const programmePlan = noArgs('generateProgrammePlan');

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

const segmentTool = (name: string): ToolContract => ({ name });

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
    id: 'route.genre-exact-electro',
    stage: 'route',
    split: 'validation',
    description: 'A canonical genre token must not be expanded into a related word.',
    prompt: productionPrompt(
      'The show needs the exact canonical library genre electro. Use genre-aware discovery with that complete tag; related terms are not interchangeable.',
      { id: 'E2lC7tR4oQ9wN1mK6vP8xD', title: 'Voltage Bloom', artist: 'Phase Array' },
      { name: 'Electronic Noon', topic: 'Precise electronic selections.', genres: ['electro'], moods: [], energies: ['medium'], eras: [], filtersStrict: false, playlistStrict: false },
    ),
    tools: [songsByGenre, { name: 'searchLibrary', required: ['query'] }, noArgs('randomSongs')],
    route: { firstCallOneOf: ['songsByGenre'], arguments: { genre: 'electro' } },
  },
  {
    id: 'route.genre-not-station-mood',
    stage: 'route',
    split: 'validation',
    description: 'A library genre must not be inserted into the closed station mood vocabulary.',
    prompt: productionPrompt(
      'The show needs the exact canonical library genre Art Rock. This is a genre, not a station mood: use the genre tool with the complete tag.',
      { id: 'A7rK3mV9tQ2xL6nB4cD8eF', title: 'Paper Horizon', artist: 'Signal Orchard' },
      { name: 'Afterimage', topic: 'Detailed guitar music.', genres: ['Art Rock'], moods: ['reflective'], energies: ['low'], eras: [], filtersStrict: false, playlistStrict: false },
    ),
    tools: [songsByGenre, tracksByMood, { name: 'searchLibrary', required: ['query'] }],
    route: { firstCallOneOf: ['songsByGenre'], arguments: { genre: 'art rock' } },
  },
  {
    id: 'route.genre-exact-electro-house',
    stage: 'route',
    split: 'validation',
    description: 'A multi-word genre must not be shortened to its parent tag.',
    prompt: productionPrompt(
      'The show needs the exact canonical library genre Electro House. Use genre-aware discovery with the complete two-word tag, not the broader Electro label.',
      { id: 'H4pT8wR2nL6cV1mQ9xD3kF', title: 'Glass Circuit', artist: 'Neon Transit' },
      { name: 'Midnight Current', topic: 'Precise club electronics.', genres: ['Electro House'], moods: ['night'], energies: ['high'], eras: [], filtersStrict: false, playlistStrict: false },
    ),
    tools: [songsByGenre, tracksByMood, { name: 'searchLibrary', required: ['query'] }],
    route: { firstCallOneOf: ['songsByGenre'], arguments: { genre: 'electro house' } },
  },
  {
    id: 'route.genre-exact-northern-soul',
    stage: 'route',
    split: 'validation',
    description: 'A multi-word genre must preserve its modifier rather than collapse to its parent.',
    prompt: productionPrompt(
      'The show needs the exact canonical library genre Northern Soul. Use songsByGenre with the complete tag; Soul alone is a different library genre.',
      { id: 'N8vC2qL5rT1mX7bK4dF9wH', title: 'All Night Signal', artist: 'The Bright Hours' },
      { name: 'Northern Lines', topic: 'Rare dancefloor discoveries.', genres: ['Northern Soul'], moods: ['celebratory'], energies: ['medium'], eras: [], filtersStrict: false, playlistStrict: false },
    ),
    tools: [songsByGenre, tracksByMood, { name: 'searchLibrary', required: ['query'] }],
    route: { firstCallOneOf: ['songsByGenre'], arguments: { genre: 'northern soul' } },
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
    id: 'route.semantic-live-id',
    stage: 'route',
    split: 'validation',
    description: 'Similarity routing must copy a novel production-shaped id, never a training literal.',
    prompt: productionPrompt(
      `Use the library semantic index to find music like the current track [id: ${SEED_ID}]. If that source is unavailable, choose the closest offered similarity source.`,
      { id: SEED_ID, title: 'An Ending (Ascent)', artist: 'Brian Eno' },
      {
        name: 'The Evening Signal', topic: 'Calm discoveries and overlooked catalogue tracks.',
        genres: ['Ambient', 'Electronic'], moods: ['reflective'], energies: ['low'],
        eras: ['1970-1979', '1980-1989'], filtersStrict: false, playlistStrict: false,
      },
    ),
    tools: [withSongId('tracksLikeThis'), withSongId('similarSongs'), tracksByMood, noArgs('randomSongs')],
    route: { firstCallOneOf: ['tracksLikeThis'], arguments: { songId: SEED_ID } },
  },
  {
    id: 'route.mood-null-energy',
    stage: 'route',
    split: 'validation',
    description: 'Mood discovery must include the live schema’s explicit nullable energy key.',
    prompt: productionPrompt(
      'Find a reflective track using structured station tags. No energy restriction was requested.',
      { id: MOOD_SEED_ID, title: 'Low Light', artist: 'Velvet Transit' },
      {
        name: 'The Scenic Route', topic: 'Thoughtful music without forcing the pace.',
        genres: ['Art Rock'], moods: ['reflective'], energies: [], eras: [],
        filtersStrict: false, playlistStrict: false,
      },
    ),
    tools: [tracksByMood, tracksByEnergy, noArgs('randomSongs')],
    route: { firstCallOneOf: ['tracksByMood'], arguments: { mood: 'reflective', energy: null } },
  },
  {
    id: 'route.mood-live-schema',
    stage: 'route',
    split: 'validation',
    description: 'Mood routing must reject plausible-but-unknown keys and use only the live schema.',
    prompt: productionPrompt(
      'Use the structured station mood route for energetic music at high energy. The only valid arguments are mood and energy; do not use type, hormonal, age, or placeholder values.',
      { id: 'G9qL2mN7rT4vX8cB1dF5hJ', title: 'Bright Wire', artist: 'Delta Static' },
      { name: 'Night Drive', topic: 'Forward-moving electronic music.', genres: ['Electronic'], moods: ['energetic'], energies: ['high'], eras: [], filtersStrict: false, playlistStrict: false },
    ),
    tools: [tracksByMood, tracksByEnergy, noArgs('searchLibrary')],
    route: { firstCallOneOf: ['tracksByMood'], arguments: { mood: 'energetic', energy: 'high' } },
  },
  {
    id: 'route.strict-playlist',
    stage: 'route',
    split: 'validation',
    description: 'A strict show playlist remains available and mandatory on every route.',
    prompt: productionPrompt(
      'This show has a strict operator playlist. Select the discovery source inside that playlist; no general-library route is permitted.',
      { id: 'L6nQ1wE8rT3yU9iO2pA5sD', title: 'Pinned Signal', artist: 'Radio Glass' },
      { name: 'Strict Hour', topic: 'Only operator-selected records.', genres: [], moods: [], energies: [], eras: [], filtersStrict: false, playlistStrict: true },
    ),
    tools: [noArgs('showPlaylistTracks'), tracksByMood, noArgs('randomSongs')],
    route: { firstCallOneOf: ['showPlaylistTracks'] },
  },
  {
    id: 'route.preferred-playlist-cooldown',
    stage: 'route',
    split: 'validation',
    description: 'After a preferred playlist route, controller policy removes that source for one turn.',
    prompt: productionPrompt(
      'The preferred playlist supplied the immediately previous route and is cooling down. Continue the calm, low-energy show through another offered discovery axis.',
      { id: 'K4mR7tV2xY9zC1bN5qW8eH', title: 'Second Source', artist: 'Cloud Dial' },
      { name: 'The Scenic Route', topic: 'Gentle variety beyond a preferred playlist.', genres: [], moods: ['calm'], energies: ['low'], eras: [], filtersStrict: false, playlistStrict: false },
    ),
    // Its absence is the controller-owned cooldown.
    tools: [tracksByMood, tracksByEnergy, noArgs('deepCuts')],
    route: { firstCallOneOf: ['tracksByMood'], arguments: { mood: 'calm', energy: 'low' } },
  },
  {
    id: 'programme.route.generate-plan',
    stage: 'route',
    split: 'validation',
    description: 'Programme planning is a bounded Producer operation, separate from selection and speech.',
    prompt: productionPrompt(
      'The one-hour show is starting. Create its backstage episode plan before any music discovery or listener-facing writing.',
      null,
      { name: 'Late Shift', topic: 'Warm nocturnal discoveries.', genres: ['Ambient'], moods: ['night'], energies: ['low'], eras: [], filtersStrict: false, playlistStrict: false },
    ),
    tools: [programmePlan, noArgs('randomSongs'), segmentTool('skill_news_v2')],
    route: { firstCallOneOf: ['generateProgrammePlan'] },
  },
  {
    id: 'segment.route.exact-track-fact',
    stage: 'route',
    split: 'validation',
    description: 'A request for exact-track evidence should use the track researcher.',
    prompt: 'Choose one research function for a between-track segment. Find one sourced production or release detail about the exact track now playing.',
    tools: [segmentTool('skill_now_playing_dig_v2'), segmentTool('skill_web_search_v2'), segmentTool('skill_news_v2')],
    route: { firstCallOneOf: ['skill_now_playing_dig_v2'] },
  },
  {
    id: 'segment.route.artist-news',
    stage: 'route',
    split: 'validation',
    description: 'Recent artist activity should use artist research rather than general headlines.',
    prompt: 'Choose one research function for a between-track segment. Look for genuinely recent news about the artist currently on air.',
    tools: [
      { name: 'skill_web_search_v2', required: ['query'], enums: { query: [null] } },
      segmentTool('skill_now_playing_dig_v2'),
      segmentTool('skill_news_v2'),
    ],
    route: { firstCallOneOf: ['skill_web_search_v2'], arguments: { query: null } },
  },
  {
    id: 'segment.route.album-anniversary',
    stage: 'route',
    split: 'validation',
    description: 'Album anniversary research has its own specialist function.',
    prompt: 'Choose one research function for a between-track segment. Check whether the original studio album currently on air reaches a meaningful anniversary this year.',
    tools: [segmentTool('skill_album_anniversary_v2'), segmentTool('skill_curiosity_v2'), segmentTool('skill_now_playing_dig_v2')],
    route: { firstCallOneOf: ['skill_album_anniversary_v2'] },
  },
  {
    id: 'recover.empty-semantic-index',
    stage: 'recover',
    split: 'validation',
    description: 'An empty similarity result must cause a real strategy change.',
    prompt: productionPrompt(
      `Keep a reflective, low-energy flow from the current track [id: ${SEED_ID}]. Start with the library's semantic similarity, recover through a genuinely different discovery axis if it is empty, then commit only to an id actually surfaced by a tool.`,
      { id: SEED_ID, title: 'An Ending (Ascent)', artist: 'Brian Eno' },
      {
        name: 'The Evening Signal', topic: 'Calm discoveries and overlooked catalogue tracks.',
        genres: ['Ambient'], moods: ['reflective'], energies: ['low'], eras: ['1980-1989'],
        filtersStrict: false, playlistStrict: false,
      },
    ),
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
    id: 'recover.empty-journey-waypoint',
    stage: 'recover',
    split: 'validation',
    description: 'An empty journey waypoint must fall back to structured show criteria.',
    prompt: 'A sonic journey is active inside a reflective, low-energy art-rock show. Try its current waypoint first; if no eligible tracks remain, change to a structured show axis.',
    tools: [noArgs('tracksTowardJourney'), tracksByMood, songsByGenre, noArgs('randomSongs')],
    mockResults: {
      tracksTowardJourney: {
        tracks: [],
        note: 'The active waypoint has no eligible tracks. Do not repeat this tool.',
      },
      tracksByMood: { tracks: [{ id: 'journey-mood-01', title: 'Low Signal', artist: 'Quiet Maps' }] },
      songsByGenre: { tracks: [{ id: 'journey-genre-01', title: 'Slow Geometry', artist: 'Amber District' }] },
    },
    route: { firstCallOneOf: ['tracksTowardJourney'] },
    recovery: {
      emptyTool: 'tracksTowardJourney',
      nextCallOneOf: ['tracksByMood'],
      arguments: { mood: 'reflective', energy: 'low' },
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
