// Now-playing dig — a concrete, verifiable detail about the EXACT track on air
// (producer, sample, B-side, chart, backstory), grounded in specialist music
// sources. The broad description is intentional: adapters will be added by
// category, while unsupported categories remain silent rather than guessed.
export const description = 'Research a specific, verifiable detail about the exact track currently on air (producer, sample, B-side, chart, backstory).';

// MusicBrainz needs no operator API key. A provider/network failure is returned
// by the tool fence and receives the scheduler's shorter infrastructure retry.
export const ready = () => true;

export default async function digCurrentTrack(ctx, state, services) {
  const cur = services.nowPlaying();
  const artist = cur?.artist;
  const title = cur?.title;
  if (!artist || !title || /^unknown/i.test(artist) || /^unknown/i.test(title)) return { available: false };
  const trackKey = `${artist} — ${title}`;
  const alreadyDug = trackKey === state.lastDugTrack;
  const evidence = await services.researchTrack(artist, title);
  state.lastDugTrack = trackKey;
  return { ...evidence, alreadyDug };
}
