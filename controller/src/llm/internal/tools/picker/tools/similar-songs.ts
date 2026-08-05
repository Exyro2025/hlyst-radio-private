import { tool } from 'ai';
import { z } from 'zod';
import * as subsonic from '../../../../../music/subsonic.js';
import { definePickerTool } from '../defs.js';

export default definePickerTool({
  name: 'similarSongs',
  build: ({ collect, emptyResult }) => tool({
    description: 'Find songs similar to a given song id. Pass the currently-playing song id to keep the flow going.',
    inputSchema: z.object({ songId: z.string() }),
    execute: async ({ songId }) => {
      try {
        const list = await subsonic.getSimilarSongs(songId, { count: 20 });
        const out = collect(list);
        return out.length ? out : emptyResult(list.length, 'no similarity data for that track — choose from your other tool results this round');
      }
      catch (err) { return { error: (err as Error).message }; }
    },
  }),
});
