import { tool } from 'ai';
import { z } from 'zod';
import * as subsonic from '../../../../../music/subsonic.js';
import { definePickerTool } from '../defs.js';

export default definePickerTool({
  name: 'starredSongs',
  build: ({ collect }) => tool({
    description: "The operator's starred / favourite songs — always a safe, on-brand pick.",
    inputSchema: z.object({}),
    execute: async () => {
      try { return collect(await subsonic.getStarred()); }
      catch (err) { return { error: (err as Error).message }; }
    },
  }),
});
