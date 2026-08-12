// Keep the execution role and observable call kind together so tests can pin
// the Producer/Persona boundary without loading the playlist builder's data
// sources. The builder has no Persona hand-off: its output remains playlist
// state and operator-facing metadata.
export const PLAYLIST_LLM_ROUTE = Object.freeze({
  kind: 'generateProducerPlaylist',
  role: 'producer',
} as const);
