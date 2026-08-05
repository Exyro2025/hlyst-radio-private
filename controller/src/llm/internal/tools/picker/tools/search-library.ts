import { tool } from 'ai';
import { z } from 'zod';
import * as subsonic from '../../../../../music/subsonic.js';
import * as library from '../../../../../music/library.js';
import * as embeddings from '../../../../../music/embeddings.js';
import { definePickerTool } from '../defs.js';

export default definePickerTool({
  name: 'searchLibrary',
  build: ({ collect, emptyResult }) => tool({
    description: 'Search the library for something NAMED — an artist, a song title, or a real genre word (e.g. "jazz", "punjabi"). Falls back to vibe search when nothing matches literally, so "punjabi r&b romantic" also works. Not for browsing by feel: a mood, an energy or "something like what\'s on now" belongs to tracksByMood, tracksByEnergy and the similarity tools, which read the station\'s own tagging instead of guessing from text.',
    inputSchema: z.object({
      query: z.string().describe('an artist name, song title, genre, or vibe'),
    }),
    execute: async ({ query }) => {
      try {
        // Random page (0/25/50) of the relevance ranking, mirroring
        // routes/request.ts — first-page-only made result 26+ of any query
        // unreachable, so repeated searches for the same broad term always
        // surfaced the same 25 songs. An empty deep page falls back to page 0.
        const songOffset = Math.floor(Math.random() * 3) * 25;
        let songs = await subsonic.search(query, { songCount: 25, songOffset });
        if (songs.length === 0 && songOffset > 0) {
          songs = await subsonic.search(query, { songCount: 25 });
        }
        // A lexical miss is often just a spelling/transliteration variance —
        // resolve the query as an artist and retry with the library's actual
        // spelling ("Sikandar Kahlon" → the tagged "Sikander Kahlon").
        if (songs.length === 0) {
          const artist = await subsonic.resolveArtist(query);
          if (artist) songs = await subsonic.search(artist.name, { songCount: 25 });
        }
        const out = collect(songs);
        if (out.length > 0) return out;
        // Lexical search3 found nothing — fall back to semantic embedding
        // search over the library (same path as searchByLyrics) so vibe
        // queries still return tracks. No-op when embeddings aren't set up.
        if (embeddings.isAvailable()) {
          await library.load();
          const vec = await embeddings.embedQueryText(query.trim(), library.embeddingIndexTextMode());
          if (vec) {
            const sem = collect(library.tracksByVector(vec, 20));
            if (sem.length > 0) return sem;
          }
        }
        return emptyResult(songs.length, 'this search matches literal titles/artists/genres first and the vibe index found nothing — choose from your other tool results this round');
      }
      catch (err) { return { error: (err as Error).message }; }
    },
  }),
});
