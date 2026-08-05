import { tool } from 'ai';
import { z } from 'zod';
import * as subsonic from '../../../../../music/subsonic.js';
import { definePickerTool } from '../defs.js';

export default definePickerTool({
  name: 'topSongsByArtist',
  build: ({ collect, emptyResult }) => tool({
    description: 'Top songs for a named artist — good for staying in an artist\'s orbit without repeating a track.',
    inputSchema: z.object({ artist: z.string() }),
    execute: async ({ artist }) => {
      try {
        const list = await subsonic.getTopSongs(artist, { count: 15 });
        const out = collect(list);
        return out.length ? out : emptyResult(list.length, 'no top-songs data for that artist — choose from your other tool results this round');
      }
      catch (err) { return { error: (err as Error).message }; }
    },
  }),
});
