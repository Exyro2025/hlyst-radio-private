import { tool } from 'ai';
import { z } from 'zod';
import * as subsonic from '../../../../../music/subsonic.js';
import { definePickerTool } from '../defs.js';

export default definePickerTool({
  name: 'randomSongs',
  build: ({ collect }) => tool({
    description: 'A random sample from the whole library — use deliberately, to break a run that has become predictable. Weakest signal here: unfiltered by mood, genre or flow, so prefer any tool that can answer the actual moment, and pick the track that fits rather than the first one back.',
    inputSchema: z.object({}),
    execute: async () => {
      try { return collect(await subsonic.getRandomSongs({ size: 18 })); }
      catch (err) { return { error: (err as Error).message }; }
    },
  }),
});
