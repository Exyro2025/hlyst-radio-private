import { tool } from 'ai';
import { z } from 'zod';
import * as subsonic from '../../../../../music/subsonic.js';
import * as library from '../../../../../music/library.js';
import * as embeddings from '../../../../../music/embeddings.js';
import { definePickerTool } from '../defs.js';

export default definePickerTool({
  name: 'searchLibrary',
  build: ({ collect, emptyResult }) => tool({
    description: 'Search the music library. Matches a literal artist name, song title, or real genre (e.g. "jazz", "punjabi") first; if nothing matches it falls back to semantic / vibe search, so descriptive multi-word queries like "punjabi r&b romantic" also work. Returns matching songs.',
    inputSchema: z.object({
      query: z.string().describe('an artist name, song title, genre, or vibe'),
    }),
    execute: async ({ query }) => {
      try {
        let songs = await subsonic.search(query, { songCount: 25 });
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
