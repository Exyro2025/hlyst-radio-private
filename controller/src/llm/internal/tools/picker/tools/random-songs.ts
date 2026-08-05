import { tool } from 'ai';
import { z } from 'zod';
import * as subsonic from '../../../../../music/subsonic.js';
import { definePickerTool } from '../defs.js';

export default definePickerTool({
  name: 'randomSongs',
  build: ({ collect }) => tool({
    description: 'A random sample of songs from the library — use to break a predictable run.',
    inputSchema: z.object({}),
    execute: async () => {
      try { return collect(await subsonic.getRandomSongs({ size: 18 })); }
      catch (err) { return { error: (err as Error).message }; }
    },
  }),
});
